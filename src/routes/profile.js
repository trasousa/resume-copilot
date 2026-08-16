import { Hono } from "hono";
import * as db from "../lib/db.js";

const router = new Hono();

router.get("/", async (c) => c.json(await db.getProfile(c.env.DB)));

router.put("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await db.saveProfile(c.env.DB, body));
});

export default router;
