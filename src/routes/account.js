// src/routes/account.js
//
// Account deletion. See db.js's deleteAllData for why this wipes
// everything rather than scoping to "one user's rows" -- there is no
// per-user row to scope to in this app's current data model.

import { Hono } from "hono";
import * as db from "../lib/db.js";
import { deleteOriginal } from "../lib/r2.js";

const router = new Hono();

router.delete("/", async (c) => {
  const { confirm } = await c.req.json().catch(() => ({}));
  if (confirm !== "DELETE")
    return c.json({ error: 'Send {"confirm":"DELETE"} to confirm this irreversible action.' }, 400);

  const cvs = await db.listCvs(c.env.DB);
  await db.deleteAllData(c.env.DB);

  if (c.env.ORIGINALS) {
    // db.listCvs() (unlike the route-layer summarize() in cvs.js) already
    // returns the raw row shape including originalKey, so no per-CV re-fetch
    // is needed here.
    for (const cv of cvs) {
      if (cv.originalKey) await deleteOriginal(c.env.ORIGINALS, cv.originalKey).catch(() => {});
    }
  }

  return c.body(null, 204);
});

export default router;
