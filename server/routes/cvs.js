import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db } from "../lib/db.js";
import { extractText } from "../lib/parse.js";
import { cvTextToDocxBuffer } from "../lib/docxOut.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runChat } from "../lib/anthropic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
const upload = multer({ dest: uploadsDir });

const router = Router();

function summarize(cv) {
  return {
    id: cv.id,
    label: cv.label,
    isMaster: cv.isMaster,
    parentId: cv.parentId || null,
    createdAt: cv.createdAt,
    snippet: cv.content.slice(0, 160).replace(/\s+/g, " "),
  };
}

router.get("/", async (_req, res) => {
  await db.read();
  res.json(db.data.cvs.map(summarize).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

router.get("/:id", async (req, res) => {
  await db.read();
  const cv = db.data.cvs.find((c) => c.id === req.params.id);
  if (!cv) return res.status(404).json({ error: "CV not found" });
  res.json(cv);
});

router.post("/", async (req, res) => {
  const { label, content, isMaster } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: "content is required" });
  await db.read();
  const cv = {
    id: uuid(),
    label: label || "Untitled CV",
    content,
    isMaster: !!isMaster,
    parentId: null,
    createdAt: new Date().toISOString(),
  };
  if (cv.isMaster) db.data.cvs.forEach((c) => (c.isMaster = false));
  db.data.cvs.push(cv);
  await db.write();
  res.status(201).json(cv);
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const content = await extractText(req.file.path, req.file.originalname);
    await fs.unlink(req.file.path).catch(() => {});
    await db.read();
    const cv = {
      id: uuid(),
      label: req.body.label || req.file.originalname.replace(/\.[^.]+$/, ""),
      content,
      isMaster: req.body.isMaster === "true" && db.data.cvs.length === 0,
      parentId: null,
      sourceFile: req.file.originalname,
      createdAt: new Date().toISOString(),
    };
    db.data.cvs.push(cv);
    await db.write();
    res.status(201).json(cv);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/master", async (req, res) => {
  await db.read();
  const cv = db.data.cvs.find((c) => c.id === req.params.id);
  if (!cv) return res.status(404).json({ error: "CV not found" });
  db.data.cvs.forEach((c) => (c.isMaster = c.id === cv.id));
  await db.write();
  res.json(cv);
});

router.delete("/:id", async (req, res) => {
  await db.read();
  db.data.cvs = db.data.cvs.filter((c) => c.id !== req.params.id);
  db.data.chats = db.data.chats.filter((c) => c.cvId !== req.params.id);
  await db.write();
  res.status(204).end();
});

router.get("/:id/download", async (req, res, next) => {
  try {
    await db.read();
    const cv = db.data.cvs.find((c) => c.id === req.params.id);
    if (!cv) return res.status(404).json({ error: "CV not found" });
    const buffer = await cvTextToDocxBuffer(cv.content);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${cv.label.replace(/[^a-z0-9-_ ]/gi, "")}.docx"`
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// --- Interactive "optimize without a job post" chat -----------------------
// The model can ask clarifying questions turn by turn. When it has a revised
// CV to propose, it wraps the full text in a ```CV fenced block; the client
// shows a diff/preview and lets the user accept it as a new version.

function extractCvBlock(text) {
  const match = text.match(/```CV\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

router.get("/:id/chat", async (req, res) => {
  await db.read();
  const chat = db.data.chats.find((c) => c.cvId === req.params.id);
  res.json(chat?.messages || []);
});

router.post("/:id/chat", async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "message is required" });

    await db.read();
    const cv = db.data.cvs.find((c) => c.id === req.params.id);
    if (!cv) return res.status(404).json({ error: "CV not found" });

    let chat = db.data.chats.find((c) => c.cvId === cv.id);
    if (!chat) {
      chat = { id: uuid(), cvId: cv.id, messages: [] };
      db.data.chats.push(chat);
    }
    chat.messages.push({ role: "user", content: message, createdAt: new Date().toISOString() });

    const skillPrompt = buildSkillPrompt(SKILL_ROUTES.optimizeNoJobPost);
    const system = `You are a resume-optimization copilot. Apply the following skills' guidance faithfully. This is an INTERACTIVE session: ask short, specific clarifying questions when you need more information (e.g. a missing metric, unclear scope, what to emphasize) rather than guessing. Only propose a full rewritten CV once you have enough to do it well, or if the user explicitly says to just do your best. When you do propose a full revised CV, output the ENTIRE updated CV text (not just the changed part) inside a fenced block that starts with \`\`\`CV and ends with \`\`\`, and briefly explain the key changes before the block.\n\nCurrent CV:\n"""\n${cv.content}\n"""\n\n${skillPrompt}`;

    const history = chat.messages.map((m) => ({ role: m.role, content: m.content }));
    const reply = await runChat({ system, messages: history, maxTokens: 3000 });

    chat.messages.push({ role: "assistant", content: reply, createdAt: new Date().toISOString() });
    await db.write();

    const proposedCv = extractCvBlock(reply);
    res.json({ reply, proposedCv });
  } catch (err) {
    next(err);
  }
});

// Accept a proposed CV from the chat as a new version.
router.post("/:id/chat/accept", async (req, res) => {
  const { content, label } = req.body;
  if (!content) return res.status(400).json({ error: "content is required" });
  await db.read();
  const parent = db.data.cvs.find((c) => c.id === req.params.id);
  if (!parent) return res.status(404).json({ error: "CV not found" });
  const cv = {
    id: uuid(),
    label: label || `${parent.label} (revised)`,
    content,
    isMaster: false,
    parentId: parent.id,
    createdAt: new Date().toISOString(),
  };
  db.data.cvs.push(cv);
  await db.write();
  res.status(201).json(cv);
});

export default router;
