import { Hono } from "hono";
import { fetchJobPostText } from "../lib/jobpost.js";

const router = new Hono();

router.post("/fetch", async (c) => {
  const { url } = await c.req.json().catch(() => ({}));
  if (!url?.trim()) return c.json({ error: "url is required" }, 400);

  const text = await fetchJobPostText(url.trim());
  return c.json({ text });
});

export default router;
