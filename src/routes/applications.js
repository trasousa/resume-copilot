import { Hono } from "hono";
import * as db from "../lib/db.js";
import { STAGES } from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES, FLAVOR_SKILLS } from "../lib/skills.js";
import { runTask } from "../lib/anthropic.js";
import { cvTextToDocxBuffer, docxFilename } from "../lib/docxOut.js";

const router = new Hono();

router.get("/", async (c) => c.json(await db.listApplications(c.env.DB)));

router.get("/:id", async (c) => {
  const app = await db.getApplication(c.env.DB, c.req.param("id"));
  if (!app) return c.json({ error: "Application not found" }, 404);
  return c.json({ ...app, documents: await db.listDocuments(c.env.DB, app.id) });
});

router.post("/", async (c) => {
  const b = await c.req.json();
  if (!b.company || !b.role)
    return c.json({ error: "company and role are required" }, 400);

  const now = new Date().toISOString();
  const app = await db.createApplication(c.env.DB, {
    id: crypto.randomUUID(),
    company: b.company,
    role: b.role,
    location: b.location || "",
    link: b.link || "",
    source: b.source || "manual",
    jobPostText: b.jobPostText || "",
    cvId: b.cvId || null,
    stage: STAGES.includes(b.stage) ? b.stage : "saved",
    stageEnteredAt: now,
    appliedAt: null,
    compEstimate: b.compEstimate || "",
    notes: "",
    createdAt: now,
    updatedAt: now,
  });
  return c.json(app, 201);
});

router.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const app = await db.getApplication(c.env.DB, id);
  if (!app) return c.json({ error: "Application not found" }, 404);

  const b = await c.req.json();
  if (b.stage !== undefined && !STAGES.includes(b.stage))
    return c.json({ error: "invalid stage" }, 400);

  // Only send through fields that actually changed, so a no-op PATCH doesn't
  // reset stage_entered_at.
  const patch = {};
  for (const k of ["notes", "link", "location", "compEstimate", "cvId", "jobPostText"])
    if (b[k] !== undefined) patch[k] = b[k];
  if (b.stage !== undefined && b.stage !== app.stage) patch.stage = b.stage;

  return c.json(await db.updateApplication(c.env.DB, id, patch));
});

router.delete("/:id", async (c) => {
  await db.deleteApplication(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});

router.post("/:id/tailor", async (c) => {
  const id = c.req.param("id");
  const { flavor, cvId } = await c.req.json().catch(() => ({}));

  const app = await db.getApplication(c.env.DB, id);
  if (!app) return c.json({ error: "Application not found" }, 404);
  if (!app.jobPostText?.trim())
    return c.json({ error: "This application has no job post text saved yet." }, 400);

  const baseCv = await db.resolveCv(c.env.DB, cvId || app.cvId);
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
    `Target job posting:\n"""\n${app.jobPostText}\n"""\n\n` +
    `Do two things, clearly separated with headings:\n` +
    `1. "## Match Analysis" -- match score out of 100, key overlaps, key gaps, ` +
    `and what to emphasize.\n` +
    `2. "## Tailored CV" -- the full tailored CV text, inside a fenced block ` +
    `that starts with \`\`\`CV and ends with \`\`\`.`;

  const { text } = await runTask({ env: c.env, stable, prompt });
  const tailoredText = text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;

  let newCv = null;
  if (tailoredText) {
    newCv = await db.createCv(c.env.DB, {
      id: crypto.randomUUID(),
      label: `${app.company} - ${app.role}`,
      content: tailoredText,
      isMaster: false,
      parentId: baseCv.id,
      createdAt: new Date().toISOString(),
    });
    // Scoped UPDATE -- can't clobber edits made while the model was running.
    await db.updateApplication(c.env.DB, id, { cvId: newCv.id });
  }

  return c.json({ analysis: text, tailoredCv: newCv });
});

router.get("/:id/tailored/download", async (c) => {
  const app = await db.getApplication(c.env.DB, c.req.param("id"));
  if (!app?.cvId)
    return c.json({ error: "No tailored CV for this application yet" }, 404);

  const cv = await db.getCv(c.env.DB, app.cvId);
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const buffer = await cvTextToDocxBuffer(cv.content);
  return c.body(buffer, 200, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${docxFilename(cv.label, cv.id)}"`,
  });
});

export default router;
