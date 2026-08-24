import { Hono } from "hono";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runTask } from "../lib/llm.js";

const router = new Hono();

// Maps a document type to the skill(s) that produce it plus a task
// instruction. Single routing table for generated content -- add an entry here
// and a button in public/js/application.js to expose a new one.
//
// The last three were dead in the Express version: their skills sat in
// SKILL_ROUTES with nothing reaching them, so all 24 skills are now live.
const DOC_TYPES = {
  coverLetter: {
    skills: SKILL_ROUTES.coverLetter,
    instruction:
      "Write a complete, ready-to-send cover letter for this specific role and company.",
  },
  coldEmail: {
    skills: SKILL_ROUTES.coldEmail,
    instruction:
      "Write a short, specific cold outreach email to a hiring manager or founder at this company about this role.",
  },
  interviewPrep: {
    skills: SKILL_ROUTES.interviewPrep,
    instruction:
      "Generate interview prep: likely questions for this role, STAR-format stories drawn from the CV, and talking points.",
  },
  salaryNegotiation: {
    skills: SKILL_ROUTES.salaryNegotiation,
    instruction:
      "Build a salary negotiation brief for this role: market rate context, target range, and negotiation/counter-offer scripts.",
  },
  applicationForm: {
    skills: SKILL_ROUTES.applicationForm,
    instruction:
      "Draft answers to common job-application form fields (why this company, why this role, greatest strength, etc.) tailored to this posting.",
  },
  referenceList: {
    skills: SKILL_ROUTES.referenceList,
    instruction:
      "Format a professional reference list page ready to send alongside this application.",
  },
  offerComparison: {
    skills: SKILL_ROUTES.offerComparison,
    instruction:
      "Build an offer comparison brief for this role: total compensation breakdown, how to weigh it against other live offers, and what to clarify before deciding.",
  },
  linkedin: {
    skills: SKILL_ROUTES.linkedin,
    instruction:
      "Suggest LinkedIn profile changes that would improve visibility for roles like this one: headline, about section, and skills to surface.",
  },
  portfolioCaseStudy: {
    skills: SKILL_ROUTES.portfolioCaseStudy,
    instruction:
      "Turn the most relevant experience on this CV into a detailed portfolio case study aimed at this role.",
  },
};

const TONE_INSTRUCTIONS = {
  professional: "Use a polished, professional tone.",
  casual: "Use a warm, casual, conversational tone -- still competent, just less formal.",
  confident: "Use a confident, assertive tone that leads with impact and results.",
  referral: "Write as if referred by a mutual contact -- open by naming that connection as the reason you're reaching out.",
};

export const DOC_TYPE_KEYS = Object.keys(DOC_TYPES);

router.get("/", async (c) =>
  c.json(await c.var.store.listDocuments(c.req.param("id")))
);

router.post("/", async (c) => {
  const applicationId = c.req.param("id");
  const { type, extraNotes, tone } = await c.req.json();

  const docType = DOC_TYPES[type];
  if (!docType) return c.json({ error: `Unknown document type "${type}"` }, 400);

  const app = await c.var.store.getApplication(applicationId);
  if (!app) return c.json({ error: "Application not found" }, 404);

  const cv = await c.var.store.resolveCv(app.cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const stable =
    `You are a job-application copilot. Follow the skill guidance below ` +
    `precisely, and never fabricate facts, dates, or achievements that aren't ` +
    `in the candidate's CV.\n\n` +
    buildSkillPrompt(docType.skills);

  const prompt =
    `Task: ${docType.instruction}\n\n` +
    `Company: ${app.company}\nRole: ${app.role}\n` +
    `Location: ${app.location || "n/a"}\n\n` +
    `Job posting:\n"""\n${app.jobPostText || "(not provided)"}\n"""\n\n` +
    `Candidate's CV:\n"""\n${cv.content}\n"""\n` +
    (extraNotes ? `\nAdditional context from the candidate: ${extraNotes}` : "") +
    (TONE_INSTRUCTIONS[tone] ? `\n${TONE_INSTRUCTIONS[tone]}` : "");

  const { text } = await runTask({ env: c.env, store: c.var.store, stable, prompt, maxTokens: 8000 });

  const doc = await c.var.store.createDocument({
    id: crypto.randomUUID(),
    applicationId,
    type,
    content: text,
    createdAt: new Date().toISOString(),
  });
  return c.json(doc, 201);
});

router.delete("/:docId", async (c) => {
  await c.var.store.deleteDocument(c.req.param("docId"));
  return c.body(null, 204);
});

export default router;
