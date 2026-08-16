// src/routes/templates.js
//
// CRUD for Outreach Studio's "Saved Templates" -- cover-letter/cold-email
// drafts kept independent of any single application (see schema.sql's
// `templates` table for why this isn't just another `documents` row).

import { Hono } from "hono";
import * as db from "../lib/db.js";

const router = new Hono();

router.get("/", async (c) => c.json(await db.listTemplates(c.env.DB)));

router.post("/", async (c) => {
  const { kind, label, tone, targetRoleCompany, content } = await c.req.json();
  if (kind !== "coverLetter" && kind !== "coldEmail")
    return c.json({ error: 'kind must be "coverLetter" or "coldEmail"' }, 400);
  if (!label?.trim()) return c.json({ error: "label is required" }, 400);
  if (!content?.trim()) return c.json({ error: "content is required" }, 400);

  const template = await db.createTemplate(c.env.DB, {
    id: crypto.randomUUID(),
    kind,
    label: label.trim(),
    tone: tone || "professional",
    targetRoleCompany: targetRoleCompany || "",
    content,
    createdAt: new Date().toISOString(),
  });
  return c.json(template, 201);
});

router.post("/:id/use", async (c) => {
  const template = await db.getTemplate(c.env.DB, c.req.param("id"));
  if (!template) return c.json({ error: "Template not found" }, 404);
  return c.json(await db.touchTemplate(c.env.DB, template.id));
});

router.delete("/:id", async (c) => {
  await db.deleteTemplate(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});

export default router;
