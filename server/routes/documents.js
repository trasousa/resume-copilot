import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runTask } from "../lib/anthropic.js";

const router = Router({ mergeParams: true });

// Maps a document "type" the frontend asks for to the skill(s) that produce
// it, and a short task instruction layered on top of the skill's own
// guidance. Add an entry here (and to skills/) any time a new document type
// is needed -- this is the app's single routing table for generated content.
const DOC_TYPES = {
  coverLetter: {
    skills: SKILL_ROUTES.coverLetter,
    instruction: "Write a complete, ready-to-send cover letter for this specific role and company.",
  },
  coldEmail: {
    skills: SKILL_ROUTES.coldEmail,
    instruction: "Write a short, specific cold outreach email to a hiring manager or founder at this company about this role.",
  },
  interviewPrep: {
    skills: SKILL_ROUTES.interviewPrep,
    instruction: "Generate interview prep: likely questions for this role, STAR-format stories drawn from the CV, and talking points.",
  },
  salaryNegotiation: {
    skills: SKILL_ROUTES.salaryNegotiation,
    instruction: "Build a salary negotiation brief for this role: market rate context, target range, and negotiation/counter-offer scripts.",
  },
  applicationForm: {
    skills: SKILL_ROUTES.applicationForm,
    instruction: "Draft answers to common job-application form fields (why this company, why this role, greatest strength, etc.) tailored to this posting.",
  },
  referenceList: {
    skills: SKILL_ROUTES.referenceList,
    instruction: "Format a professional reference list page ready to send alongside this application.",
  },
};

router.get("/", async (req, res) => {
  await db.read();
  res.json(db.data.documents.filter((d) => d.applicationId === req.params.id));
});

router.post("/", async (req, res, next) => {
  try {
    const { type, extraNotes } = req.body;
    const docType = DOC_TYPES[type];
    if (!docType) return res.status(400).json({ error: `Unknown document type "${type}"` });

    await db.read();
    const app = db.data.applications.find((a) => a.id === req.params.id);
    if (!app) return res.status(404).json({ error: "Application not found" });

    const cv = db.data.cvs.find((c) => c.id === app.cvId) || db.data.cvs.find((c) => c.isMaster);
    if (!cv) return res.status(400).json({ error: "No CV available. Upload or set a master CV first." });

    const skillPrompt = buildSkillPrompt(docType.skills);
    const system = `You are a job-application copilot. Follow the skill guidance below precisely, and never fabricate facts, dates, or achievements that aren't in the candidate's CV.\n\n${skillPrompt}`;
    const prompt = `Task: ${docType.instruction}\n\nCompany: ${app.company}\nRole: ${app.role}\nLocation: ${app.location || "n/a"}\n\nJob posting:\n"""\n${app.jobPostText || "(not provided)"}\n"""\n\nCandidate's CV:\n"""\n${cv.content}\n"""\n${extraNotes ? `\nAdditional context from the candidate: ${extraNotes}` : ""}`;

    const content = await runTask({ system, prompt, maxTokens: 3000 });

    const document = {
      id: uuid(),
      applicationId: app.id,
      type,
      content,
      createdAt: new Date().toISOString(),
    };
    db.data.documents.push(document);
    await db.write();
    res.status(201).json(document);
  } catch (err) {
    next(err);
  }
});

router.delete("/:docId", async (req, res) => {
  await db.read();
  db.data.documents = db.data.documents.filter((d) => d.id !== req.params.docId);
  await db.write();
  res.status(204).end();
});

export default router;
export { DOC_TYPES };
