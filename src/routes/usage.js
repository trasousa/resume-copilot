// src/routes/usage.js
//
// Read-only readout of the daily AI token cap enforced in src/lib/llm.js, so
// the frontend nav can show a "how much budget is left today" indicator
// instead of users only finding out when a 429 hits mid-task.

import { Hono } from "hono";
import * as db from "../lib/db.js";
import { DAILY_TOKEN_CAP } from "../lib/llm.js";

const router = new Hono();

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC -- matches llm.js's own cap window
}

router.get("/", async (c) => {
  const day = today();
  const used = await db.getTokenUsage(c.env.DB, day);
  return c.json({ used, cap: DAILY_TOKEN_CAP, day });
});

export default router;
