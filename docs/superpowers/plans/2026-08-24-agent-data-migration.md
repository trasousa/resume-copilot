# Implementation Plan — Sub-project 2: Move per-user data into the ResumeAgent Durable Object

(Reviewed and approved 2026-08-24. Authored by the planning agent; execution
follows the PR sequence below. Companion spec:
`docs/superpowers/specs/2026-08-16-resume-agent-core-design.md`.)

## Overview

Today every `/api/*` route reaches one globally-shared D1 database via
`c.env.DB`. Cloudflare Access is the only thing keeping it single-tenant.
This plan moves the seven per-user tables (`cvs`, `applications`,
`documents`, `activity_events`, `templates`, `chat_messages`, `profile`)
plus `token_usage` into each user's `ResumeAgent` Durable Object's SQLite,
keeps `geocode_cache` in D1 as a deliberately shared resource, and preserves
the existing route/frontend contract exactly.

The shape of the change is deliberately **boring**: `src/lib/db.js` keeps
its SQL and its row-to-object mapping verbatim. It already takes a D1-ish
handle as its first argument, so we give it a different handle — a ~60-line
D1-shaped shim over `this.ctx.storage.sql` living inside the DO — and expose
each `db.js` function as a one-line RPC method on the agent. Routes change
from `db.listCvs(c.env.DB)` to `c.var.store.listCvs()`. That's the whole
architecture.

Five landable PRs. The app stays working single-user throughout; the read
path only flips in PR3, after the legacy import (PR2) has been built and can
be exercised.

## Decision log

### D1 — How does db.js's D1 API map onto Agent SQLite?

**Chosen: a D1-shaped shim (`prepare/bind/first/all/run/batch`) implemented
over `this.ctx.storage.sql`, injected into the *unchanged* `db.js`
functions.**

`Agent.sql` is a **synchronous tagged template** and cannot express
`db.js`'s dynamically-built SQL (`updateApplication` assembles its `SET`
clause at runtime). The underlying `this.ctx.storage.sql` (`AgentContext =
DurableObjectState`, so this is standard `SqlStorage`) takes a raw string
plus positional bindings — a near-exact match for `prepare(sql).bind()`.

```js
// src/agents/sql-shim.js
class Stmt {
  constructor(sql, query, values = []) { this.sql = sql; this.query = query; this.values = values; }
  bind(...values) { return new Stmt(this.sql, this.query, values); }
  #exec() { return this.sql.exec(this.query, ...this.values).toArray(); }
  async first(col) {
    const row = this.#exec()[0] ?? null;
    return col == null ? row : row?.[col] ?? null;
  }
  async all() { return { results: this.#exec(), success: true }; }
  async run() { this.#exec(); return { success: true }; }
}

export function d1Shim(sqlStorage) {
  return {
    prepare: (query) => new Stmt(sqlStorage, query),
    // D1 batch() is implicitly transactional; transactionSync() is the DO
    // equivalent. Its closure must be synchronous -- sql.exec() is, so the
    // statements run inline rather than via Stmt's async wrappers.
    async batch(stmts) {
      return sqlStorage.transactionSync(() =>
        stmts.map((s) => ({ results: s.sql.exec(s.query, ...s.values).toArray(), success: true }))
      );
    },
    // Escape hatch for the migration importer (PR2), which needs FK deferral.
    raw: sqlStorage,
  };
}
```

Why not rewrite `db.js` onto the tagged template: ~23 statements, all of the
row-mapping logic, and the one dynamic-SQL function would all have to be
rewritten and re-verified against a repo with no test framework. Mechanical
re-pointing keeps the diff auditable.

**Atomicity.** `db.batch()` is used in exactly three places — `createCv`
(demote-then-insert master), `setMasterCv`, `deleteAllData`. All three map
cleanly to `ctx.storage.transactionSync()`, which is *stronger* than D1's
`batch()` (real synchronous SQLite transaction in a single-threaded DO). No
other call site needs multi-statement atomicity.

**Schema DDL & migrations.** DDL runs inside the DO as a JS module:

- New `src/agents/schema.js` exports `USER_SCHEMA_VERSIONS`: an ordered
  array of arrays of DDL statements. v1 = the seven per-user tables +
  `token_usage` + indexes, copied verbatim from `schema.sql` minus
  `geocode_cache`.
- New `ResumeAgent#ensureSchema()` called from `onStart()` (every DO wake —
  must be idempotent). Version tracking via a `schema_meta(key, value)`
  table rather than `PRAGMA user_version` (pragma availability uncertain).
  Wrap in `transactionSync`.
- `src/agents/schema.js` becomes the single source of truth for per-user
  DDL; `schema.sql` shrinks (PR5) to `geocode_cache` + `legacy_claim`. This
  also permanently fixes the `ALTER TABLE` footgun — future column adds are
  a new version entry.

**`geocode_cache` stays in D1.** Not user data; one shared cache serves
Nominatim's policy better than N per-user copies. The `DB` binding does NOT
go away; routes hold both `c.env.DB` (geocode only) and `c.var.store`.

**`token_usage` moves into the agent** — the 100k/day cap becomes per-user.
`DAILY_TOKEN_CAP` stays exported from `src/lib/llm.js`.

### D2 — The request-flow bridge

**Chosen: Hono middleware resolves identity → `getAgentByName` → attaches
the DO stub as `c.var.store`; routes call operation-level RPC methods
mirroring `db.js` function names 1:1.**

```js
// src/lib/store.js
import { getAgentByName } from "agents";

// Per-isolate memo: setIdentity() is a no-op after the first call, so paying
// a round trip for it on every request is waste on a warm isolate.
const stamped = new Set();

export function withStore() {
  return async (c, next) => {
    const user = c.get("user");            // set by requireAuth()
    const store = await getAgentByName(c.env.RESUME_AGENT, user.sub);
    if (!stamped.has(user.sub)) {
      await store.setIdentity(user.email, user.sub);
      stamped.add(user.sub);
    }
    c.set("store", store);
    return next();
  };
}
```

Mounted in `src/index.js` immediately after `app.use("/api/*", requireAuth())`.

**Chattiness:** RPC count per request equals today's `db.*` call count (1
for most routes, worst ~6). Intra-colo DO RPC is single-digit ms against
LLM calls measured in tens of seconds. Not worth optimizing.

**Rejected A — per-query RPC** (`store.exec(sql, params)`): same or worse
round trips, loses atomicity, generic SQL surface on the DO for no benefit.

**Rejected B — proxy whole operations into the agent** (LLM call inside the
DO): a DO processes one request at a time — a 30–90s LLM call would block
every other request from that user. Generation-as-agent-methods is
sub-project 3 and needs its own concurrency design. **No LLM call moves
into the DO in this step.**

**Streaming routes** (`cvs.js` chat `onDone`, `jobsearch.js` inside
`ReadableStream.start()`) now issue DO RPC after the response begins. The
stub stays valid while the stream is open — highest-risk part of the
cutover; explicit curl verification in PR3.

**Error semantics caveat:** custom properties like `err.status` do NOT
survive DO RPC serialization. Harmless today (nothing in `db.js` throws
status-carrying errors); a landmine for sub-project 3 — record as a comment
on the agent class.

### D3 — Migrating the owner's existing D1 data

**Chosen: explicit, admin-gated, idempotent import route, guarded by both a
D1 claim row and a DO-storage marker.** (Auto-claim on first request is
unacceptable: a mis-timed request from any other Access-policy member would
permanently own the legacy data.)

1. New `LEGACY_OWNER_SUB` var in `wrangler.jsonc` (identifier, not a
   credential). `/api/auth/me` extended to echo `sub`.
2. New D1 table:
   ```sql
   CREATE TABLE IF NOT EXISTS legacy_claim (
     id             TEXT PRIMARY KEY DEFAULT 'default',
     claimed_by_sub TEXT NOT NULL,
     claimed_at     TEXT NOT NULL
   );
   ```
3. `POST /api/admin/import-legacy` (`src/routes/admin.js`): 403 unless
   `user.sub === env.LEGACY_OWNER_SUB` (403 if the var is empty — fail
   closed); accepts `{ dryRun }`; forwards to
   `c.var.store.importLegacyD1({ dryRun })`.
4. `ResumeAgent#importLegacyD1` runs inside the DO (`this.env.DB` is
   available there — one RPC, no row-shipping):
   - `legacyImportedAt` in DO storage set → `{ skipped: "already-imported" }`.
   - Claim via `INSERT ... ON CONFLICT(id) DO NOTHING` then read winner; not
     us → `{ skipped: "claimed-by-other" }`.
   - `dryRun` → per-table counts only.
   - `SELECT *` each D1 table, `INSERT OR IGNORE` into DO SQLite (ids
     preserved so all references stay valid), one `transactionSync`.
   - **Insert order:** `cvs` with `parent_id` forced NULL, second-pass
     `UPDATE` to restore `parent_id` (self-reference + FK enforcement, D7);
     then applications → documents → activity_events → templates →
     chat_messages → profile; then only today's `token_usage` row (no fresh
     budget from importing).
   - Set `legacyImportedAt`; return `{ imported: {...counts} }`.

Idempotent three ways: DO marker, D1 claim row, `INSERT OR IGNORE` on
preserved keys. **D1 rows are not deleted by the import** — archive stays;
dropping is a deliberate later manual act (PR5 documents the command).

**Interaction with account deletion:** `deleteAllData` must NOT clear
`legacyImportedAt`, or a later import call would resurrect data the user
explicitly deleted.

### D4 — R2 key layout

**Chosen: prefix new keys `u/{sanitized-sub}/{cvId}/{filename}`; leave
existing keys untouched.** Correctness doesn't require it (`original_key` is
always read from the user's own row, never from the request; CV ids are
UUIDs) but prefixing buys per-user enumeration for deletion sweeps.
`userPrefix(sub)` sanitizes `[^a-zA-Z0-9._-]` → `_` (dev subs are emails).
**Migration: none** — old and new keys coexist; deletion deletes each row's
explicit `originalKey` (old) then sweeps the user prefix (new + orphans).

### D5 — Per-user account deletion

`ResumeAgent#deleteAllData()` runs the existing `db.deleteAllData` against
the DO shim — scoped by construction — returning `{ cvIds, originalKeys }`;
the route deletes exactly those R2 objects plus the prefix sweep.
**Rejected `Agent#destroy()`**: SDK docs say it may not return cleanly
(fire-and-forget isolate abort), and it would wipe `identity` +
`legacyImportedAt`. Explicit DELETEs in `transactionSync` match today's
semantics.

### D6 — What stays put

`geocode.js` (D1), `skills.js`, `parse.js`, `docxOut.js`, all job-source
clients, `workersai.js`, the entire `public/` frontend. No API shape changes.

### D7 — Foreign keys behave differently in DO SQLite than in D1

D1 does not enforce FK constraints by default; DO SQLite does. Same DDL,
different runtime behavior:
- `DELETE FROM cvs` now cascades `chat_messages` and nulls
  `applications.cv_id` (per existing `ON DELETE` clauses) — new behavior,
  arguably the original intent.
- Inserting an application with a nonexistent `cv_id` now **fails** instead
  of storing a dangling id. `POST /api/applications` passes `b.cvId || null`
  unvalidated → would 500. **Mitigation (PR3):** existence check → 400, and
  exercise both scenarios in verification.
- `deleteAllData`'s children-before-parents order is already correct.

## PR breakdown

### PR 1 — Agent-side data layer (dormant; zero request-path change)
~450 lines added. Risk: low.
- **new** `src/agents/sql-shim.js` (per D1).
- **new** `src/agents/schema.js` (`USER_SCHEMA_VERSIONS`; never edit a
  shipped version array, append).
- **modify** `src/agents/resume-agent.js`: lazy `#d1` from
  `d1Shim(this.ctx.storage.sql)`; `onStart()` → `#ensureSchema()`
  (schema_meta versioning, transactionSync, idempotent); the facade — one-
  line methods delegating to unchanged `db.js` for all 33 functions
  (`listCvs` … `deleteAllData`), NOT `@callable()` (server-side RPC only;
  no collisions with SDK surface); temporary `GET
  /agents/resume-agent/selftest` returning `{ schemaVersion, counts }`
  (removed in PR5).
- **Verify:** lint/build; selftest as `X-Dev-User: a@local` and `b@local` →
  independent zero counts; ping regression; dev-server restart → selftest
  again (idempotent ensureSchema).

### PR 2 — Legacy D1 → agent import (dormant)
~200 lines. Risk: medium (owner's real data) but additive/reversible.
- `schema.sql` += `legacy_claim`; `wrangler.jsonc` += `LEGACY_OWNER_SUB: ""`;
  `resume-agent.js` += `importLegacyD1` (D3); **new** `src/routes/admin.js`;
  `src/index.js` mounts `/api/admin` with `withStore()` on `/api/admin/*`
  only for now; `/api/auth/me` echoes `sub`.
- **Verify (local):** seed via current UI; dryRun counts match D1; real run
  → selftest counts match; re-run → `already-imported`, no duplication;
  wrong identity → 403; third-identity claim → `claimed-by-other`.
- **Production:** deploy, dryRun, eyeball counts vs
  `wrangler d1 execute --remote`, run for real — **before PR3 deploys.**

### PR 3 — Cutover: routes read/write the agent (the flip)
Large but mechanical (~80 call sites, 10 route files + llm.js). Risk:
highest.
- **new** `src/lib/store.js` (`withStore()`); mount after `requireAuth()`.
- All route files: `db.X(c.env.DB, ...)` → `c.var.store.X(...)`
  (`applications.js` keeps `import { STAGES }`); `jobsearch.js` keeps
  `geocodeLocations(c.env.DB, ...)`.
- `llm.js`: `assertUnderCap`/`recordUsage` take `store`; `runTask`/
  `runChatStream` gain `store` param; update all 8 call sites.
- `usage.js` → `c.var.store.getTokenUsage(day)`; per-user comment.
- `applications.js`: `cvId` existence check (D7).
- `db.js` header comment updated.
- **Verify:** imported data visible as owner identity; empty for second
  identity (**the multi-tenancy proof**); full write-path exercise (master
  demotion via transactionSync, applied_at set-once, docs, reminders);
  streaming: chat SSE + persistence via onDone, search SSE all events +
  geocode still D1; per-user `/api/usage` independence; D7 FK scenarios
  (CV delete with children → app survives with null cvId; bogus cvId → 400);
  full frontend browse.
- **Rollback:** revert the PR — D1 still holds every row.

### PR 4 — Per-user account deletion + R2 prefixing
~80 lines. Risk: low but destructive — verify locally first.
- `r2.js`: `userPrefix`, `putOriginal(bucket, sub, cvId, ...)`; `cvs.js`
  passes sub; `db.js` `deleteAllData` also returns `originalKeys` + comment
  rewrite; `account.js`: agent deleteAllData + explicit key deletes + prefix
  sweep (paginate `truncated`/`cursor`) + comment rewrite; agent comment: do
  not clear `legacyImportedAt`.
- **Verify:** two identities; delete one → other untouched, R2 originals
  gone/kept respectively; deleted user can immediately recreate; import
  after delete → `already-imported`.

### PR 5 — Cleanup and documentation
- Remove selftest; trim `schema.sql` to `geocode_cache` + `legacy_claim`;
  fix `db:reset:local` (geocode-only) + README note (per-user reset =
  `DELETE /api/account`); README deploy gains `LEGACY_OWNER_SUB` + import
  step; completion note in docs/superpowers/specs recording decisions
  (especially D2's no-LLM-in-DO constraint for sub-project 3). **Not here:**
  dropping legacy D1 tables — README documents the manual command for later.

## Hazards (summary)

1. D1 vs DO-SQLite FK enforcement (D7) — most likely regression.
2. `updateApplication` dynamic SET forces the raw-exec shim path.
3. SSE routes RPC-after-response-start — verify explicitly.
4. DO is single-threaded per user — never move 30–90s LLM calls into it.
5. `err.status` doesn't survive DO RPC.
6. `schema.sql` ↔ `agents/schema.js` drift unless PR5 lands.
7. `db:init`/`db:reset:local` silently create ghost tables post-cutover.
8. Stale "no per-user data model" comments in `account.js`/`db.js` must go.
9. No tests — the two-identity curl check is the proof; don't skip it.
10. DO SQLite limits: 10 GB/instance, ~2 MB per value — note, not guard.

## API assertions

Verified against `agents@0.20.1` typings + workers-types: `Agent.sql` is a
synchronous tagged template; `AgentContext = DurableObjectState` (so
`ctx.storage.sql` is standard `SqlStorage`, `transactionSync` exists);
`getAgentByName` returns a `DurableObjectStub`; `onStart` runs on every
wake; `destroy()` may not return cleanly.

**Uncertain — implementer must confirm against current Cloudflare docs:**
exact `SqlStorage.exec` cursor API (`.toArray()`/`.one()`/draining rules);
FK enforcement default in DO SQLite + whether `PRAGMA defer_foreign_keys`
works inside `transactionSync`; whether `PRAGMA user_version` is allowed;
SQLite date functions (`date('now','-365 days')` in `getActivityHeatmap` —
would fail quietly as an empty heatmap); whether the SDK reserves table
names beyond `cf_agents_*` and whether its constructor-time schema setup
races our `onStart` DDL; per-value size limit; DO RPC argument size limits
for full-CV payloads.
