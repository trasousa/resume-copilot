import { Router } from "express";
import { db } from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runWebSearchTask } from "../lib/anthropic.js";

const router = Router();

router.post("/search", async (req, res, next) => {
  try {
    const { cvId, city, region, country, remote, minComp, notes } = req.body;
    await db.read();
    const cv = db.data.cvs.find((c) => c.id === cvId) || db.data.cvs.find((c) => c.isMaster);
    if (!cv) return res.status(400).json({ error: "No CV available. Upload or set a master CV first." });

    if (!remote && !city && !region && !country) {
      return res.status(400).json({ error: "Provide a location, or set remote=true." });
    }

    const skillPrompt = buildSkillPrompt(SKILL_ROUTES.jobSearch);
    const system = `You are a job-search copilot with live web search access. Follow the skill guidance below precisely. Only report postings you actually found via search, with real URLs from the results -- never invent a company, listing, or link.\n\n${skillPrompt}`;

    const locationLine = remote
      ? `Remote (${[city, region, country].filter(Boolean).join(", ") || "any location"})`
      : [city, region, country].filter(Boolean).join(", ");

    const prompt = `Candidate's CV:\n"""\n${cv.content}\n"""\n\nSearch for open job postings that fit this candidate, favoring higher compensation among good fits.\nTarget location: ${locationLine}\n${minComp ? `Minimum target compensation: ${minComp}\n` : ""}${notes ? `Additional preferences from the candidate: ${notes}\n` : ""}\nReturn the ranked shortlist per the skill's output format as readable markdown.\n\nThen, ALSO output the same shortlist as a JSON array (same jobs, same order) inside a fenced block starting with \`\`\`JOBS and ending with \`\`\`, where each item is exactly: {"title": string, "company": string, "location": string, "url": string, "compEstimate": string, "fitNote": string}. The "url" must be a real URL from your search results -- omit a job from the JSON entirely rather than inventing a URL.`;

    const location = { city, region, country };
    const { text, sources } = await runWebSearchTask({ system, prompt, location, maxTokens: 4096 });

    res.json({ text, sources });
  } catch (err) {
    next(err);
  }
});

export default router;
