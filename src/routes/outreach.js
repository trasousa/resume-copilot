// src/routes/outreach.js
//
// Generates a cover letter or cold email from just a target role/company and
// a tone, without requiring a tracked application first -- backs the
// Outreach Studio, which the design lets a user open straight from the
// Tailor tab to draft something before (or without ever) creating an
// application for it.

import { Hono } from "hono";
import * as db from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runTask } from "../lib/llm.js";

const router = new Hono();

const KIND_SKILLS = {
  coverLetter: SKILL_ROUTES.coverLetter,
  coldEmail: SKILL_ROUTES.coldEmail,
};

const TONE_INSTRUCTIONS = {
  professional: "Use a polished, professional tone.",
  casual: "Use a warm, casual, conversational tone -- still competent, just less formal.",
  confident: "Use a confident, assertive tone that leads with impact and results.",
  referral: "Write as if referred by a mutual contact -- open by naming that connection as the reason you're reaching out.",
};

router.post("/generate", async (c) => {
  const { type, targetRoleCompany, tone, cvId } = await c.req.json();

  const skills = KIND_SKILLS[type];
  if (!skills) return c.json({ error: `Unknown outreach type "${type}"` }, 400);
  if (!targetRoleCompany?.trim())
    return c.json({ error: "targetRoleCompany is required" }, 400);

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const stable =
    `You are a job-application copilot. Follow the skill guidance below ` +
    `precisely, and never fabricate facts, dates, or achievements that aren't ` +
    `in the candidate's CV.\n\n` +
    buildSkillPrompt(skills);

  const instruction =
    type === "coverLetter"
      ? "Write a complete, ready-to-send cover letter for this specific role and company."
      : "Write a short, specific cold outreach email to a hiring manager or founder at this company about this role.";

  const prompt =
    `Task: ${instruction}\n\n` +
    `Target role / company: ${targetRoleCompany}\n\n` +
    `Candidate's CV:\n"""\n${cv.content}\n"""\n` +
    (TONE_INSTRUCTIONS[tone] ? `\n${TONE_INSTRUCTIONS[tone]}` : "");

  const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 8000 });
  return c.json({ content: text });
});

export default router;
