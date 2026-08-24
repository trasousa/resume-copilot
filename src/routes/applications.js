import { Hono } from "hono";
import { STAGES } from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES, FLAVOR_SKILLS } from "../lib/skills.js";
import { runTask } from "../lib/llm.js";
import { cvTextToDocxBuffer, docxFilename } from "../lib/docxOut.js";

const router = new Hono();

// The tailoring prompt asks the model for "## Match Analysis" containing a
// score out of 100 in prose (e.g. "Match score: 85/100" or "Match Score: 85%").
// This is a best-effort scrape of that number for the dashboard/detail-view
// badges -- if the model phrases it differently, matchScore stays null and
// the UI simply doesn't show a badge, it never blocks tailoring itself.
function parseMatchScore(analysisText) {
  const m = analysisText.match(/match\s*score[:\s]*[^\d]{0,10}(\d{1,3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

router.get("/", async (c) => c.json(await c.var.store.listApplications()));

router.get("/stats", async (c) => c.json(await c.var.store.getApplicationStats()));

router.get("/activity-heatmap", async (c) => c.json(await c.var.store.getActivityHeatmap()));

router.get("/:id/activity", async (c) => {
  const app = await c.var.store.getApplication(c.req.param("id"));
  if (!app) return c.json({ error: "Application not found" }, 404);
  return c.json(await c.var.store.listActivity(app.id));
});

router.post("/:id/activity", async (c) => {
  const id = c.req.param("id");
  const app = await c.var.store.getApplication(id);
  if (!app) return c.json({ error: "Application not found" }, 404);

  const { title, detail, occurredAt } = await c.req.json();
  if (!title?.trim()) return c.json({ error: "title is required" }, 400);

  const now = new Date().toISOString();
  const ev = await c.var.store.addActivity({
    id: crypto.randomUUID(),
    applicationId: id,
    type: "reminder",
    title: title.trim(),
    detail: detail || "",
    occurredAt: occurredAt || now,
    createdAt: now,
  });
  return c.json(ev, 201);
});

router.get("/:id", async (c) => {
  const app = await c.var.store.getApplication(c.req.param("id"));
  if (!app) return c.json({ error: "Application not found" }, 404);
  return c.json({ ...app, documents: await c.var.store.listDocuments(app.id) });
});

router.post("/", async (c) => {
  const b = await c.req.json();
  if (!b.company || !b.role)
    return c.json({ error: "company and role are required" }, 400);

  // Agent SQLite enforces the cv_id foreign key that D1 quietly ignored
  // (verified: the same insert succeeds on D1 and raises SQLITE_CONSTRAINT
  // in a Durable Object). A client sending a stale or foreign cvId used to
  // store a dangling reference; without this check it would now be an
  // opaque 500 instead of a clear rejection.
  if (b.cvId && !(await c.var.store.getCv(b.cvId)))
    return c.json({ error: "That CV no longer exists." }, 400);

  const now = new Date().toISOString();
  const app = await c.var.store.createApplication({
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
  await c.var.store.addActivity({
    id: crypto.randomUUID(),
    applicationId: app.id,
    type: "created",
    title: "Application created",
    detail: b.source === "job-search" ? "Started from Job Search" : "Added manually",
    occurredAt: now,
    createdAt: now,
  });
  return c.json(app, 201);
});

router.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const app = await c.var.store.getApplication(id);
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

  const updated = await c.var.store.updateApplication(id, patch);
  if (patch.stage !== undefined) {
    const now2 = new Date().toISOString();
    await c.var.store.addActivity({
      id: crypto.randomUUID(),
      applicationId: id,
      type: "stage_change",
      title: `Moved to ${patch.stage[0].toUpperCase()}${patch.stage.slice(1)}`,
      detail: "",
      occurredAt: now2,
      createdAt: now2,
    });
  }
  return c.json(updated);
});

router.delete("/:id", async (c) => {
  await c.var.store.deleteApplication(c.req.param("id"));
  return c.body(null, 204);
});

router.post("/:id/tailor", async (c) => {
  const id = c.req.param("id");
  const { flavor, cvId } = await c.req.json().catch(() => ({}));

  const app = await c.var.store.getApplication(id);
  if (!app) return c.json({ error: "Application not found" }, 404);
  if (!app.jobPostText?.trim())
    return c.json({ error: "This application has no job post text saved yet." }, 400);

  const baseCv = await c.var.store.resolveCv(cvId || app.cvId);
  if (!baseCv)
    return c.json({ error: "No CV found. Upload or set a master CV first." }, 400);

  const stable =
    `You are a resume-tailoring copilot. Follow the skills below precisely, and ` +
    `never fabricate experience the candidate doesn't have -- only reorder, ` +
    `reframe, and emphasize what's true. Do not use emojis anywhere in your ` +
    `response.\n\n` +
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
    `that starts with \`\`\`CV and ends with \`\`\`.\n\n` +
    `Then output a fenced block starting with \`\`\`KEYWORDS and ending with ` +
    `\`\`\` containing a JSON array of 5-12 short exact phrases (copied verbatim ` +
    `from the Tailored CV text) that most directly reflect the job posting's ` +
    `requirements -- these get highlighted in the UI.`;

  const { text } = await runTask({ env: c.env, store: c.var.store, stable, prompt });
  const tailoredText = text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;
  const matchScore = parseMatchScore(text);

  let newCv = null;
  if (tailoredText) {
    newCv = await c.var.store.createCv({
      id: crypto.randomUUID(),
      label: `${app.company} - ${app.role}`,
      content: tailoredText,
      isMaster: false,
      parentId: baseCv.id,
      createdAt: new Date().toISOString(),
    });
    // Scoped UPDATE -- can't clobber edits made while the model was running.
    await c.var.store.updateApplication(id, { cvId: newCv.id, matchScore });
  }

  if (!newCv && matchScore != null) {
    // No structured CV came back, but a score did -- still worth recording.
    await c.var.store.updateApplication(id, { matchScore });
  }
  const tailoredAt = new Date().toISOString();
  await c.var.store.addActivity({
    id: crypto.randomUUID(),
    applicationId: id,
    type: "tailored",
    title: "Materials tailored",
    detail: matchScore != null ? `Match score ${matchScore}%` : "",
    occurredAt: tailoredAt,
    createdAt: tailoredAt,
  });

  return c.json({
    analysis: text,
    tailoredCv: newCv,
    keywords: (() => {
      try { return JSON.parse(text.match(/```KEYWORDS\n([\s\S]*?)\n```/)?.[1] || "[]"); }
      catch { return []; }
    })(),
  });
});

router.get("/:id/tailored/download", async (c) => {
  const app = await c.var.store.getApplication(c.req.param("id"));
  if (!app?.cvId)
    return c.json({ error: "No tailored CV for this application yet" }, 404);

  const cv = await c.var.store.getCv(app.cvId);
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const buffer = await cvTextToDocxBuffer(cv.content);
  return c.body(buffer, 200, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${docxFilename(cv.label, cv.id)}"`,
  });
});

export default router;
