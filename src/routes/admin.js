// src/routes/admin.js
//
// One operation, run once per deployment: adopt the pre-multi-tenant D1 rows
// into the owner's per-user agent. See decision D3 in
// docs/superpowers/plans/2026-08-24-agent-data-migration.md.
//
// This is deliberately a manual, identity-pinned admin action rather than an
// auto-claim on first request. Everything in D1 today belongs to whoever set
// this deployment up, but nothing in the *data* says so -- so an automatic
// "first caller wins" rule would hand the entire archive to whichever member
// of the Access policy happened to load the app first, permanently and
// silently. Naming the owner up front (LEGACY_OWNER_SUB in wrangler.jsonc)
// costs one config line and removes the race.

import { Hono } from "hono";

const router = new Hono();

// Durable Object RPC strips custom Error properties, so the agent reports
// outcomes as returned tags rather than throwing status-carrying errors (see
// the note at the top of src/agents/resume-agent.js). Translating them to
// HTTP is this layer's job.
const ERROR_STATUS = {
  "no-identity": 500, // middleware should have stamped it -- a bug, not user input
};

router.post("/import-legacy", async (c) => {
  const owner = c.env.LEGACY_OWNER_SUB;
  const user = c.get("user");

  // Fails closed on an unset var. An empty LEGACY_OWNER_SUB must never mean
  // "anyone", and must never mean "match anyone whose sub is also empty" --
  // hence the explicit emptiness check before the comparison.
  if (!owner || user.sub !== owner) {
    return c.json({ error: "Not authorized to import legacy data." }, 403);
  }

  const { dryRun } = await c.req.json().catch(() => ({}));
  const result = await c.var.store.importLegacyD1({ dryRun: dryRun === true });

  if (result.error) {
    return c.json({ error: result.error }, ERROR_STATUS[result.error] ?? 500);
  }
  // `skipped` is a success, not a failure: both the already-imported and the
  // claimed-by-other outcomes are the guard working as designed, and the
  // caller needs to see which one it was.
  return c.json(result);
});

export default router;
