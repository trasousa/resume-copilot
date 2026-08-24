// src/routes/account.js
//
// Account deletion. Scoped to the caller by construction: `store` is this
// user's own Durable Object, so wiping every table in it reaches exactly
// their data and nobody else's. (Before the agent cutover this genuinely
// did wipe the whole deployment -- there was one shared D1 with no owner
// column to scope to.)
//
// R2 objects are not in that store, so they're deleted explicitly below.

import { Hono } from "hono";
import { deleteOriginal } from "../lib/r2.js";

const router = new Hono();

router.delete("/", async (c) => {
  const { confirm } = await c.req.json().catch(() => ({}));
  if (confirm !== "DELETE")
    return c.json({ error: 'Send {"confirm":"DELETE"} to confirm this irreversible action.' }, 400);

  const cvs = await c.var.store.listCvs();
  await c.var.store.deleteAllData();

  if (c.env.ORIGINALS) {
    // listCvs() (unlike the route-layer summarize() in cvs.js) already
    // returns the raw row shape including originalKey, so no per-CV re-fetch
    // is needed here.
    for (const cv of cvs) {
      if (cv.originalKey) await deleteOriginal(c.env.ORIGINALS, cv.originalKey).catch(() => {});
    }
  }

  return c.body(null, 204);
});

export default router;
