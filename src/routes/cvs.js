import { Hono } from "hono";
import { extractText } from "../lib/parse.js";
import { putOriginal, deleteOriginal } from "../lib/r2.js";
import { cvTextToDocxBuffer, docxFilename } from "../lib/docxOut.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runChatStream, runTask } from "../lib/llm.js";

const router = new Hono();

const summarize = (cv) => ({
  id: cv.id,
  label: cv.label,
  isMaster: cv.isMaster,
  parentId: cv.parentId || null,
  createdAt: cv.createdAt,
  snippet: cv.content.slice(0, 160).replace(/\s+/g, " "),
  hasOriginal: !!cv.originalKey,
});

router.get("/", async (c) =>
  c.json((await c.var.store.listCvs()).map(summarize))
);

router.get("/:id", async (c) => {
  const cv = await c.var.store.getCv(c.req.param("id"));
  return cv ? c.json(cv) : c.json({ error: "CV not found" }, 404);
});

router.post("/", async (c) => {
  const { label, content, isMaster } = await c.req.json();
  if (!content?.trim()) return c.json({ error: "content is required" }, 400);

  const cv = await c.var.store.createCv({
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

  // File.arrayBuffer() reads the blob's underlying data fresh each call (it's
  // not a single-use stream), so the same buffer can go to both extraction
  // and R2 without re-reading the multipart body.
  const buffer = await file.arrayBuffer();

  // Throws on unsupported type or oversize; nothing is written anywhere first,
  // so there's no temp file to leak on the failure path.
  const content = await extractText(buffer, file.name);

  const id = crypto.randomUUID();

  // Keep the original bytes if R2 is configured -- extractText() only keeps
  // plain text, so without this the original formatting is gone for good the
  // moment the upload completes. Optional: the app still works without it.
  let originalKey = null;
  if (c.env.ORIGINALS) {
    originalKey = await putOriginal(c.env.ORIGINALS, c.get("user").sub, id, file.name, file.type, buffer);
  }

  const cv = await c.var.store.createCv({
    id,
    label: form.get("label") || file.name.replace(/\.[^.]+$/, ""),
    content,
    // Honour the flag the client actually sends, instead of silently ignoring
    // it on every upload after the first.
    isMaster: form.get("isMaster") === "true",
    parentId: null,
    sourceFile: file.name,
    originalKey,
    originalFilename: originalKey ? file.name : null,
    createdAt: new Date().toISOString(),
  });
  return c.json(cv, 201);
});

router.post("/:id/parse", async (c) => {
  const id = c.req.param("id");
  const cv = await c.var.store.getCv(id);
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const stable =
    `You extract structured data from resumes. Return ONLY the requested ` +
    `JSON -- no commentary, no markdown fencing outside the one code block ` +
    `asked for. Never invent information that isn't in the source text; use ` +
    `an empty string or empty array for anything you can't find.`;

  const prompt =
    `Resume text:\n"""\n${cv.content}\n"""\n\n` +
    `Extract this exact JSON shape, inside a fenced block starting with ` +
    `\`\`\`JSON and ending with \`\`\`:\n` +
    `{"name": string, "title": string, "email": string, "phone": string, ` +
    `"location": string, "links": string[], "summary": string, ` +
    `"experience": [{"role": string, "company": string, "dates": string, ` +
    `"bullets": string[]}], "education": [{"degree": string, "school": ` +
    `string, "dates": string}], "skills": string[]}`;

  const { text } = await runTask({ env: c.env, store: c.var.store, stable, prompt, maxTokens: 4000 });

  let parsedJson;
  try {
    parsedJson = JSON.parse(text.match(/```JSON\n([\s\S]*?)\n```/)?.[1] || "{}");
  } catch {
    parsedJson = null;
  }
  if (!parsedJson) return c.json({ error: "Couldn't parse the resume into structured fields. Try again, or continue without it." }, 502);

  await c.var.store.updateCvParsedJson(id, parsedJson);
  return c.json({ ...cv, parsedJson });
});

router.patch("/:id/master", async (c) => {
  const id = c.req.param("id");
  if (!(await c.var.store.getCv(id)))
    return c.json({ error: "CV not found" }, 404);
  return c.json(await c.var.store.setMasterCv(id));
});

router.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const cv = await c.var.store.getCv(id);
  if (cv?.originalKey && c.env.ORIGINALS) {
    await deleteOriginal(c.env.ORIGINALS, cv.originalKey).catch(() => {});
  }
  await c.var.store.deleteCv(id);
  return c.body(null, 204);
});

router.get("/:id/download", async (c) => {
  const cv = await c.var.store.getCv(c.req.param("id"));
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const buffer = await cvTextToDocxBuffer(cv.content);
  return c.body(buffer, 200, {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${docxFilename(cv.label, cv.id)}"`,
  });
});

router.get("/:id/original", async (c) => {
  const cv = await c.var.store.getCv(c.req.param("id"));
  if (!cv?.originalKey)
    return c.json({ error: "No original file stored for this CV." }, 404);
  if (!c.env.ORIGINALS)
    return c.json({ error: "Original file storage is not configured." }, 500);

  const obj = await c.env.ORIGINALS.get(cv.originalKey);
  if (!obj) return c.json({ error: "Original file is missing from storage." }, 404);

  return c.body(obj.body, 200, {
    "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${cv.originalFilename || "original"}"`,
  });
});

// --- Interactive "optimize without a job post" chat -------------------------

const extractCvBlock = (text) =>
  text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;

router.get("/:id/chat", async (c) =>
  c.json(await c.var.store.listChatMessages(c.req.param("id")))
);

router.post("/:id/chat", async (c) => {
  const cvId = c.req.param("id");
  const { message } = await c.req.json();
  if (!message?.trim()) return c.json({ error: "message is required" }, 400);

  const cv = await c.var.store.getCv(cvId);
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const now = new Date().toISOString();
  await c.var.store.addChatMessage({
    id: crypto.randomUUID(),
    cvId,
    role: "user",
    content: message,
    createdAt: now,
  });

  const history = (await c.var.store.listChatMessages(cvId)).map((m) => ({
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
    store: c.var.store,
    stable,
    volatile: `Current CV:\n"""\n${cv.content}\n"""`,
    messages: history,
    onDone: async (reply) => {
      await c.var.store.addChatMessage({
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

  const parent = await c.var.store.getCv(c.req.param("id"));
  if (!parent) return c.json({ error: "CV not found" }, 404);

  const cv = await c.var.store.createCv({
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
