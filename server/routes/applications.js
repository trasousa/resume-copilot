import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runTask } from "../lib/anthropic.js";
import { cvTextToDocxBuffer } from "../lib/docxOut.js";

const router = Router();

export const STAGES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];

router.get("/", async (_req, res) => {
  await db.read();
  res.json([...db.data.applications].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

router.get("/:id", async (req, res) => {
  await db.read();
  const app = db.data.applications.find((a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });
  const documents = db.data.documents.filter((d) => d.applicationId === app.id);
  res.json({ ...app, documents });
});

router.post("/", async (req, res) => {
  const { company, role, location, link, source, jobPostText, cvId, stage, compEstimate } = req.body;
  if (!company || !role) return res.status(400).json({ error: "company and role are required" });
  await db.read();
  const now = new Date().toISOString();
  const app = {
    id: uuid(),
    company,
    role,
    location: location || "",
    link: link || "",
    source: source || "manual",
    jobPostText: jobPostText || "",
    cvId: cvId || null,
    stage: STAGES.includes(stage) ? stage : "saved",
    stageEnteredAt: now,
    appliedAt: null,
    compEstimate: compEstimate || "",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  db.data.applications.push(app);
  await db.write();
  res.status(201).json(app);
});

router.patch("/:id", async (req, res) => {
  await db.read();
  const app = db.data.applications.find((a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });

  const { stage, notes, link, location, compEstimate, cvId, jobPostText } = req.body;
  if (stage && stage !== app.stage) {
    if (!STAGES.includes(stage)) return res.status(400).json({ error: "invalid stage" });
    app.stage = stage;
    app.stageEnteredAt = new Date().toISOString();
    if (stage === "applied" && !app.appliedAt) app.appliedAt = app.stageEnteredAt;
  }
  if (notes !== undefined) app.notes = notes;
  if (link !== undefined) app.link = link;
  if (location !== undefined) app.location = location;
  if (compEstimate !== undefined) app.compEstimate = compEstimate;
  if (cvId !== undefined) app.cvId = cvId;
  if (jobPostText !== undefined) app.jobPostText = jobPostText;
  app.updatedAt = new Date().toISOString();

  await db.write();
  res.json(app);
});

router.delete("/:id", async (req, res) => {
  await db.read();
  db.data.applications = db.data.applications.filter((a) => a.id !== req.params.id);
  db.data.documents = db.data.documents.filter((d) => d.applicationId !== req.params.id);
  await db.write();
  res.status(204).end();
});

// Which extra, role-flavor skill to layer on top of the core tailoring
// skills, chosen by the caller (frontend offers a dropdown; defaults to
// none, i.e. just the general tailoring skills).
const FLAVOR_SKILLS = {
  tech: SKILL_ROUTES.tailorTech,
  executive: SKILL_ROUTES.tailorExecutive,
  academic: SKILL_ROUTES.tailorAcademic,
  creative: SKILL_ROUTES.tailorCreative,
  careerChange: SKILL_ROUTES.tailorCareerChange,
};

router.post("/:id/tailor", async (req, res, next) => {
  try {
    const { flavor } = req.body;
    await db.read();
    const app = db.data.applications.find((a) => a.id === req.params.id);
    if (!app) return res.status(404).json({ error: "Application not found" });
    if (!app.jobPostText || !app.jobPostText.trim())
      return res.status(400).json({ error: "This application has no job post text saved yet." });

    const baseCv = db.data.cvs.find((c) => c.id === (req.body.cvId || app.cvId)) || db.data.cvs.find((c) => c.isMaster);
    if (!baseCv) return res.status(400).json({ error: "No CV found. Upload or set a master CV first." });

    const skillNames = [...SKILL_ROUTES.tailorToJobPost, ...(FLAVOR_SKILLS[flavor] || [])];
    const skillPrompt = buildSkillPrompt(skillNames);

    const system = `You are a resume-tailoring copilot. Follow the skills below precisely, and never fabricate experience the candidate doesn't have -- only reorder, reframe, and emphasize what's true.\n\n${skillPrompt}`;

    const prompt = `Candidate's current CV:\n"""\n${baseCv.content}\n"""\n\nTarget job posting:\n"""\n${app.jobPostText}\n"""\n\nDo two things, clearly separated with headings:\n1. "## Match Analysis" -- match score out of 100, key overlaps, key gaps, and what to emphasize (from job-description-analyzer).\n2. "## Tailored CV" -- the full tailored CV text, inside a fenced block that starts with \`\`\`CV and ends with \`\`\`.`;

    const reply = await runTask({ system, prompt, maxTokens: 4096 });
    const cvMatch = reply.match(/```CV\n([\s\S]*?)\n```/);
    const tailoredText = cvMatch ? cvMatch[1].trim() : null;

    let newCv = null;
    if (tailoredText) {
      newCv = {
        id: crypto.randomUUID(),
        label: `${app.company} - ${app.role}`,
        content: tailoredText,
        isMaster: false,
        parentId: baseCv.id,
        createdAt: new Date().toISOString(),
      };
      db.data.cvs.push(newCv);
      app.cvId = newCv.id;
      app.updatedAt = new Date().toISOString();
      await db.write();
    }

    res.json({ analysis: reply, tailoredCv: newCv });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/tailored/download", async (req, res, next) => {
  try {
    await db.read();
    const app = db.data.applications.find((a) => a.id === req.params.id);
    if (!app || !app.cvId) return res.status(404).json({ error: "No tailored CV for this application yet" });
    const cv = db.data.cvs.find((c) => c.id === app.cvId);
    if (!cv) return res.status(404).json({ error: "CV not found" });
    const buffer = await cvTextToDocxBuffer(cv.content);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${cv.label.replace(/[^a-z0-9-_ ]/gi, "")}.docx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
