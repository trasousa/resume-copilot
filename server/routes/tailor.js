import { Router } from "express";
import { db } from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runTask } from "../lib/anthropic.js";

const router = Router();

const FLAVOR_SKILLS = {
  tech: SKILL_ROUTES.tailorTech,
  executive: SKILL_ROUTES.tailorExecutive,
  academic: SKILL_ROUTES.tailorAcademic,
  creative: SKILL_ROUTES.tailorCreative,
  careerChange: SKILL_ROUTES.tailorCareerChange,
};

// Standalone quick-tailor tool: paste a job post against any stored CV
// without first creating a tracked application. Useful for a fast "how well
// do I match this?" check. If the result looks good, the frontend offers to
// promote it into a tracked application via POST /api/applications.
router.post("/quick", async (req, res, next) => {
  try {
    const { cvId, jobPostText, flavor } = req.body;
    if (!jobPostText || !jobPostText.trim()) return res.status(400).json({ error: "jobPostText is required" });

    await db.read();
    const baseCv = db.data.cvs.find((c) => c.id === cvId) || db.data.cvs.find((c) => c.isMaster);
    if (!baseCv) return res.status(400).json({ error: "No CV found. Upload or set a master CV first." });

    const skillNames = [...SKILL_ROUTES.tailorToJobPost, ...(FLAVOR_SKILLS[flavor] || [])];
    const skillPrompt = buildSkillPrompt(skillNames);
    const system = `You are a resume-tailoring copilot. Follow the skills below precisely, and never fabricate experience the candidate doesn't have -- only reorder, reframe, and emphasize what's true.\n\n${skillPrompt}`;
    const prompt = `Candidate's current CV:\n"""\n${baseCv.content}\n"""\n\nTarget job posting:\n"""\n${jobPostText}\n"""\n\nDo two things, clearly separated with headings:\n1. "## Match Analysis" -- match score out of 100, key overlaps, key gaps, and what to emphasize.\n2. "## Tailored CV" -- the full tailored CV text, inside a fenced block that starts with \`\`\`CV and ends with \`\`\`.`;

    const reply = await runTask({ system, prompt, maxTokens: 4096 });
    const cvMatch = reply.match(/```CV\n([\s\S]*?)\n```/);
    const tailoredText = cvMatch ? cvMatch[1].trim() : null;

    res.json({ analysis: reply, tailoredText, baseCvId: baseCv.id });
  } catch (err) {
    next(err);
  }
});

// Persist a quick-tailor result as a saved CV version (called after the user
// reviews the result and wants to keep it).
router.post("/quick/save", async (req, res) => {
  const { baseCvId, content, label } = req.body;
  if (!content) return res.status(400).json({ error: "content is required" });
  await db.read();
  const parent = db.data.cvs.find((c) => c.id === baseCvId);
  const cv = {
    id: crypto.randomUUID(),
    label: label || "Tailored CV",
    content,
    isMaster: false,
    parentId: parent?.id || null,
    createdAt: new Date().toISOString(),
  };
  db.data.cvs.push(cv);
  await db.write();
  res.status(201).json(cv);
});

export default router;
