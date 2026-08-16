import { Hono } from "hono";
import * as db from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES, FLAVOR_SKILLS } from "../lib/skills.js";
import { runTask } from "../lib/llm.js";

const router = new Hono();

// Standalone quick-tailor: paste a job post against any stored CV without
// first creating a tracked application. If the result looks good the frontend
// offers to promote it into one.
router.post("/quick", async (c) => {
  const { cvId, jobPostText, flavor } = await c.req.json();
  if (!jobPostText?.trim())
    return c.json({ error: "jobPostText is required" }, 400);

  const baseCv = await db.resolveCv(c.env.DB, cvId);
  if (!baseCv)
    return c.json({ error: "No CV found. Upload or set a master CV first." }, 400);

  const stable =
    `You are a resume-tailoring copilot. Follow the skills below precisely, and ` +
    `never fabricate experience the candidate doesn't have -- only reorder, ` +
    `reframe, and emphasize what's true.\n\n` +
    buildSkillPrompt([
      ...SKILL_ROUTES.tailorToJobPost,
      ...(FLAVOR_SKILLS[flavor] || []),
    ]);

  const prompt =
    `Candidate's current CV:\n"""\n${baseCv.content}\n"""\n\n` +
    `Target job posting:\n"""\n${jobPostText}\n"""\n\n` +
    `Do two things, clearly separated with headings:\n` +
    `1. "## Match Analysis" -- match score out of 100, key overlaps, key gaps, ` +
    `and what to emphasize.\n` +
    `2. "## Tailored CV" -- the full tailored CV text, inside a fenced block ` +
    `that starts with \`\`\`CV and ends with \`\`\`.\n\n` +
    `Then output a fenced block starting with \`\`\`KEYWORDS and ending with ` +
    `\`\`\` containing a JSON array of 5-12 short exact phrases (copied verbatim ` +
    `from the Tailored CV text) that most directly reflect the job posting's ` +
    `requirements -- these get highlighted in the UI.`;

  const { text } = await runTask({ env: c.env, stable, prompt });

  return c.json({
    analysis: text,
    tailoredText: text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null,
    keywords: (() => {
      try { return JSON.parse(text.match(/```KEYWORDS\n([\s\S]*?)\n```/)?.[1] || "[]"); }
      catch { return []; }
    })(),
    baseCvId: baseCv.id,
  });
});

router.post("/quick/save", async (c) => {
  const { baseCvId, content, label } = await c.req.json();
  if (!content) return c.json({ error: "content is required" }, 400);

  const parent = baseCvId ? await db.getCv(c.env.DB, baseCvId) : null;

  const cv = await db.createCv(c.env.DB, {
    id: crypto.randomUUID(),
    label: label || "Tailored CV",
    content,
    isMaster: false,
    parentId: parent?.id || null,
    createdAt: new Date().toISOString(),
  });
  return c.json(cv, 201);
});

export default router;
