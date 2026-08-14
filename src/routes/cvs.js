import { Hono } from "hono";
import * as db from "../lib/db.js";
import { extractText } from "../lib/parse.js";
import { cvTextToDocxBuffer, docxFilename } from "../lib/docxOut.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runChatStream } from "../lib/anthropic.js";

const router = new Hono();

const summarize = (cv) => ({
  id: cv.id,
  label: cv.label,
  isMaster: cv.isMaster,
  parentId: cv.parentId || null,
  createdAt: cv.createdAt,
  snippet: cv.content.slice(0, 160).replace(/\s+/g, " "),
});

router.get("/", async (c) =>
  c.json((await db.listCvs(c.env.DB)).map(summarize))
);

router.get("/:id", async (c) => {
  const cv = await db.getCv(c.env.DB, c.req.param("id"));
  return cv ? c.json(cv) : c.json({ error: "CV not found" }, 404);
});

router.post("/", async (c) => {
  const { label, content, isMaster } = await c.req.json();
  if (!content?.trim()) return c.json({ error: "content is required" }, 400);

  const cv = await db.createCv(c.env.DB, {
    id: crypto.randomUUID(),
    label: label || "Untitled CV",
    content,
    isMaster: !!isMaster,
    parentId: null,
    createdAt: new Date().toISOString(),
  });
  return c.json(cv, 201);
});

router.post("/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string")
    return c.json({ error: "file is required" }, 400);

  // Throws on unsupported type or oversize; nothing is written anywhere first,
  // so there's no temp file to leak on the failure path.
  const content = await extractText(await file.arrayBuffer(), file.name);

  const cv = await db.createCv(c.env.DB, {
    id: crypto.randomUUID(),
    label: form.get("label") || file.name.replace(/\.[^.]+$/, ""),
    content,
    // Honour the flag the client actually sends, instead of silently ignoring
    // it on every upload after the first.
    isMaster: form.get("isMaster") === "true",
    parentId: null,
    sourceFile: file.name,
    createdAt: new Date().toISOString(),
  });
  return c.json(cv, 201);
});

router.patch("/:id/master", async (c) => {
  const id = c.req.param("id");
  if (!(await db.getCv(c.env.DB, id)))
    return c.json({ error: "CV not found" }, 404);
  return c.json(await db.setMasterCv(c.env.DB, id));
});

router.delete("/:id", async (c) => {
  await db.deleteCv(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});

router.get("/:id/download", async (c) => {
  const cv = await db.getCv(c.env.DB, c.req.param("id"));
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const buffer = await cvTextToDocxBuffer(cv.content);
  return c.body(buffer, 200, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${docxFilename(cv.label, cv.id)}"`,
  });
});

// --- Interactive "optimize without a job post" chat -------------------------

const extractCvBlock = (text) =>
  text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;

router.get("/:id/chat", async (c) =>
  c.json(await db.listChatMessages(c.env.DB, c.req.param("id")))
);

router.post("/:id/chat", async (c) => {
  const cvId = c.req.param("id");
  const { message } = await c.req.json();
  if (!message?.trim()) return c.json({ error: "message is required" }, 400);

  const cv = await db.getCv(c.env.DB, cvId);
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const now = new Date().toISOString();
  await db.addChatMessage(c.env.DB, {
    id: crypto.randomUUID(),
    cvId,
    role: "user",
    content: message,
    createdAt: now,
  });

  const history = (await db.listChatMessages(c.env.DB, cvId)).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Split matters: `stable` is byte-identical every turn and gets the cache
  // breakpoint; the CV goes after it. Putting the CV first (as the Express
  // version did) would invalidate the cache on every request.
  const stable =
    `You are a resume-optimization copilot. Apply the following skills' guidance ` +
    `faithfully. This is an INTERACTIVE session: ask short, specific clarifying ` +
    `questions when you need more information rather than guessing. Only propose ` +
    `a full rewritten CV once you have enough to do it well, or if the user says ` +
    `to just do your best. When you propose one, output the ENTIRE updated CV ` +
    `inside a fenced block starting with \`\`\`CV and ending with \`\`\`, and briefly ` +
    `explain the key changes before the block.\n\n` +
    buildSkillPrompt(SKILL_ROUTES.optimizeNoJobPost);

  const stream = runChatStream({
    env: c.env,
    stable,
    volatile: `Current CV:\n"""\n${cv.content}\n"""`,
    messages: history,
    onDone: async (reply) => {
      await db.addChatMessage(c.env.DB, {
        id: crypto.randomUUID(),
        cvId,
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

router.post("/:id/chat/accept", async (c) => {
  const { content, label } = await c.req.json();
  if (!content) return c.json({ error: "content is required" }, 400);

  const parent = await db.getCv(c.env.DB, c.req.param("id"));
  if (!parent) return c.json({ error: "CV not found" }, 404);

  const cv = await db.createCv(c.env.DB, {
    id: crypto.randomUUID(),
    label: label || `${parent.label} (revised)`,
    content,
    isMaster: false,
    parentId: parent.id,
    createdAt: new Date().toISOString(),
  });
  return c.json(cv, 201);
});

export { extractCvBlock };
export default router;
