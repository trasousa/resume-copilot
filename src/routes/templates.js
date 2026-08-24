// src/routes/templates.js
//
// CRUD for Outreach Studio's "Saved Templates" -- cover-letter/cold-email
// drafts kept independent of any single application (see schema.sql's
// `templates` table for why this isn't just another `documents` row).

import { Hono } from "hono";

const router = new Hono();

router.get("/", async (c) => c.json(await c.var.store.listTemplates()));

router.post("/", async (c) => {
  const { kind, label, tone, targetRoleCompany, content } = await c.req.json();
  if (kind !== "coverLetter" && kind !== "coldEmail")
    return c.json({ error: 'kind must be "coverLetter" or "coldEmail"' }, 400);
  if (!label?.trim()) return c.json({ error: "label is required" }, 400);
  if (!content?.trim()) return c.json({ error: "content is required" }, 400);

  const template = await c.var.store.createTemplate({
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
  const template = await c.var.store.getTemplate(c.req.param("id"));
  if (!template) return c.json({ error: "Template not found" }, 404);
  return c.json(await c.var.store.touchTemplate(template.id));
});

router.delete("/:id", async (c) => {
  await c.var.store.deleteTemplate(c.req.param("id"));
  return c.body(null, 204);
});

export default router;
