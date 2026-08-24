// Per-user agent: one Durable Object instance per authenticated user,
// addressed by the Access JWT's `sub` claim (stable across email changes --
// see src/lib/auth.js resolveIdentity and src/index.js). This file is
// intentionally minimal -- it proves the routing/auth/observability
// plumbing works before any real CV/tailoring logic moves here (see
// docs/superpowers/specs/2026-08-16-resume-agent-core-design.md for the
// full sub-project sequence).
//
// Trust boundary, load-bearing for sub-project 2 onward: the Agents SDK
// accepts a `cf_agent_state_update` WebSocket message from any non-readonly
// connection and applies it to `state` wholesale. An authenticated user can
// therefore overwrite their own agent's synced `state` with anything. The
// instance boundary still holds (they can only touch their own instance),
// but that means `state` -- including `email` below -- must never be
// treated as a verified identity record or used as an authorization input.
// The one thing that actually establishes identity is which instance a
// request was routed to (src/index.js's server-derived `sub`), never
// anything read back out of `state` afterward. If a real ownership check is
// ever needed, it belongs in DO storage outside the synced state object, or
// behind an `onStateChanged` validation -- not assumed from `state.email`.

// Two constraints that shape everything added to this class from here on:
//
//   * A Durable Object handles one request at a time. Short SQL queries
//     crossing the RPC boundary are fine; a 30-90s LLM call moved in here
//     would block every other request from that same user, including the
//     usage poll and the job-search stream. Generation stays in the Worker
//     (sub-project 3 needs its own concurrency design first).
//   * Custom Error properties do NOT survive DO RPC serialization -- an
//     `err.status` thrown in here arrives in the Worker as a plain message.
//     Nothing below throws status-carrying errors; keep it that way, or
//     translate at the call site.

import { Agent, callable } from "agents";
import * as db from "../lib/db.js";
import { d1Shim } from "./sql-shim.js";
import { USER_SCHEMA_VERSIONS, SCHEMA_META_DDL } from "./schema.js";

const SCHEMA_VERSION_KEY = "user_schema_version";

export class ResumeAgent extends Agent {
  initialState = { sub: null, email: null, createdAt: null };

  #store = null;

  /** db.js's handle: this instance's own SQLite dressed as a D1 database.
   * Every data method below goes through it, which is what makes per-user
   * isolation structural rather than a query convention -- there is no
   * user column to forget, because there are no other users' rows here. */
  get #db() {
    if (!this.#store) this.#store = d1Shim(this.ctx.storage.sql, this.ctx.storage);
    return this.#store;
  }

  /** Runs on every wake, so it must stay idempotent and cheap: after the
   * first call it's a single indexed read of schema_meta. */
  onStart() {
    const sql = this.ctx.storage.sql;
    sql.exec(SCHEMA_META_DDL);

    const row = sql
      .exec("SELECT value FROM schema_meta WHERE key = ?", SCHEMA_VERSION_KEY)
      .toArray()[0];
    const applied = row ? Number(row.value) : 0;
    if (applied >= USER_SCHEMA_VERSIONS.length) return;

    this.ctx.storage.transactionSync(() => {
      for (let v = applied; v < USER_SCHEMA_VERSIONS.length; v++) {
        for (const statement of USER_SCHEMA_VERSIONS[v]) sql.exec(statement);
      }
      sql.exec(
        "INSERT INTO schema_meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        SCHEMA_VERSION_KEY,
        String(USER_SCHEMA_VERSIONS.length)
      );
    });
  }

  /** Called once, immediately after the first request routes to a new
   * instance -- see src/index.js. Not a constructor param because Durable
   * Object instances are looked up by name, not constructed with args.
   * Deliberately NOT @callable(): this is a server-side stamping call, not
   * a client operation -- @callable() puts a method on the client-facing
   * WebSocket RPC surface, which identity-stamping has no business being
   * on. DO RPC already exposes every public method to server-side callers
   * like getAgentByName(...).setIdentity(...) regardless. */
  async setIdentity(email, sub) {
    if (!this.state.sub) {
      const identity = { email, sub, createdAt: new Date().toISOString() };
      // DO storage is the authoritative copy -- synced `state` is
      // client-writable (see the trust-boundary note above), so identity
      // must live somewhere a WebSocket peer can't reach.
      await this.ctx.storage.put("identity", identity);
      this.setState(identity);
    }
    return this.state;
  }

  /** Enforces the trust boundary documented above instead of merely noting
   * it: any client state update that tampers with the identity fields gets
   * them restored from the storage copy. Everything else in `state` stays
   * client-writable by design. */
  async onStateUpdate(state, source) {
    if (source === "server") return;
    const identity = await this.ctx.storage.get("identity");
    if (!identity) return;
    if (
      state?.sub !== identity.sub ||
      state?.email !== identity.email ||
      state?.createdAt !== identity.createdAt
    ) {
      this.setState({ ...state, ...identity });
    }
  }

  @callable()
  ping() {
    return { ...this.state, calledAt: new Date().toISOString() };
  }

  // --- data layer ------------------------------------------------------
  //
  // One method per src/lib/db.js function, same name, same arguments minus
  // the leading handle. Routes will call these over DO RPC instead of
  // touching D1 (see the plan's decision D2); until that cutover lands
  // nothing calls them, which is deliberate -- this half ships dormant so
  // the flip is a separate, revertable change.
  //
  // Deliberately NOT @callable(): these are server-side RPC only. Making
  // them callable would put the whole data layer on the client-facing
  // WebSocket surface, where the SDK's own state-update trust boundary
  // (see above) means anything reachable is attacker-reachable.

  listCvs() { return db.listCvs(this.#db); }
  getCv(id) { return db.getCv(this.#db, id); }
  getMasterCv() { return db.getMasterCv(this.#db); }
  resolveCv(id) { return db.resolveCv(this.#db, id); }
  createCv(cv) { return db.createCv(this.#db, cv); }
  updateCvParsedJson(id, parsedJson) { return db.updateCvParsedJson(this.#db, id, parsedJson); }
  setMasterCv(id) { return db.setMasterCv(this.#db, id); }
  deleteCv(id) { return db.deleteCv(this.#db, id); }
  countCvs() { return db.countCvs(this.#db); }

  listApplications() { return db.listApplications(this.#db); }
  getApplication(id) { return db.getApplication(this.#db, id); }
  createApplication(app) { return db.createApplication(this.#db, app); }
  updateApplication(id, patch) { return db.updateApplication(this.#db, id, patch); }
  deleteApplication(id) { return db.deleteApplication(this.#db, id); }
  getApplicationStats() { return db.getApplicationStats(this.#db); }
  getActivityHeatmap() { return db.getActivityHeatmap(this.#db); }

  listDocuments(applicationId) { return db.listDocuments(this.#db, applicationId); }
  createDocument(doc) { return db.createDocument(this.#db, doc); }
  deleteDocument(id) { return db.deleteDocument(this.#db, id); }

  listActivity(applicationId) { return db.listActivity(this.#db, applicationId); }
  addActivity(event) { return db.addActivity(this.#db, event); }

  listTemplates() { return db.listTemplates(this.#db); }
  getTemplate(id) { return db.getTemplate(this.#db, id); }
  createTemplate(template) { return db.createTemplate(this.#db, template); }
  touchTemplate(id) { return db.touchTemplate(this.#db, id); }
  deleteTemplate(id) { return db.deleteTemplate(this.#db, id); }

  listChatMessages(cvId) { return db.listChatMessages(this.#db, cvId); }
  addChatMessage(message) { return db.addChatMessage(this.#db, message); }

  getProfile() { return db.getProfile(this.#db); }
  saveProfile(profile) { return db.saveProfile(this.#db, profile); }

  getTokenUsage(day) { return db.getTokenUsage(this.#db, day); }
  addTokenUsage(day, tokens) { return db.addTokenUsage(this.#db, day, tokens); }

  deleteAllData() { return db.deleteAllData(this.#db); }

  // --- legacy import ---------------------------------------------------
  //
  // See docs/superpowers/plans/2026-08-24-agent-data-migration.md decision
  // D3. Everything before multi-tenancy lived in one shared D1 database;
  // this copies those rows into the owner's agent exactly once.
  //
  // Runs inside the DO on purpose: `this.env.DB` is bound here too, so the
  // whole copy is one RPC with no rows crossing the boundary.

  /** Column lists are explicit rather than derived from the source rows so a
   * legacy D1 table that drifted from schema.sql (the `match_score` ALTER
   * TABLE footgun documented there) still imports -- an absent column reads
   * back as undefined and lands as NULL instead of producing a malformed
   * INSERT. Order matters: parents before children, because DO SQLite
   * *enforces* the foreign keys D1 ignores (D7, confirmed empirically).
   *
   * That same asymmetry means the legacy rows can contain references D1
   * happily stored but SQLite will reject -- a document whose application
   * was deleted, an application pointing at a long-gone CV. `fk` says what
   * to do with those: `nullable` ones import with the reference cleared
   * (matching the column's own ON DELETE SET NULL), the rest are dropped,
   * because a NOT NULL reference to a row that doesn't exist isn't data
   * worth carrying over. Either way one bad row must not abort the import. */
  static #IMPORT_TABLES = [
    { table: "cvs", columns: ["id", "label", "content", "is_master", "parent_id", "source_file", "original_key", "original_filename", "parsed_json", "created_at"] },
    { table: "applications", columns: ["id", "company", "role", "location", "link", "source", "job_post_text", "cv_id", "stage", "stage_entered_at", "applied_at", "comp_estimate", "match_score", "notes", "created_at", "updated_at"], fk: { column: "cv_id", parent: "cvs", nullable: true } },
    { table: "documents", columns: ["id", "application_id", "type", "content", "created_at"], fk: { column: "application_id", parent: "applications" } },
    { table: "activity_events", columns: ["id", "application_id", "type", "title", "detail", "occurred_at", "created_at"], fk: { column: "application_id", parent: "applications" } },
    { table: "templates", columns: ["id", "kind", "label", "tone", "target_role_company", "content", "created_at", "last_used_at"] },
    { table: "chat_messages", columns: ["id", "cv_id", "role", "content", "created_at"], fk: { column: "cv_id", parent: "cvs" } },
    { table: "profile", columns: ["id", "city", "region", "country", "remote", "min_comp", "notes", "target_role", "updated_at"] },
    // Only today's row, and only ever today's: importing the full history
    // would either hand this user a fresh budget or retroactively spend one.
    { table: "token_usage", columns: ["day", "tokens"] },
  ];

  /**
   * Copies the pre-multi-tenant D1 rows into this instance. Idempotent three
   * ways -- a DO-storage marker, a D1 claim row, and INSERT OR IGNORE on
   * preserved primary keys -- and never deletes anything from D1.
   *
   * Returns a plain result object instead of throwing, deliberately: DO RPC
   * drops custom Error properties (see the note at the top of this file), so
   * a thrown `err.status` would reach the route as an opaque 500. The route
   * maps these tags to HTTP codes -- see src/routes/admin.js.
   */
  async importLegacyD1({ dryRun = false } = {}) {
    const identity = await this.ctx.storage.get("identity");
    const sub = identity?.sub;
    // Nothing to claim with. Can't happen through the route (the middleware
    // stamps identity first), so treat it as a bug, not a user error.
    if (!sub) return { error: "no-identity" };

    if (await this.ctx.storage.get("legacyImportedAt")) {
      return { skipped: "already-imported" };
    }

    const now = new Date().toISOString();
    // Insert-then-read rather than read-then-insert: the read alone races,
    // the conditional insert can't. Whoever's row survives the ON CONFLICT
    // is the owner, including when that's a previous call of our own.
    await this.env.DB.prepare(
      `INSERT INTO legacy_claim (id, claimed_by_sub, claimed_at) VALUES ('default', ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
      .bind(sub, now)
      .run();
    const claim = await this.env.DB.prepare(
      "SELECT claimed_by_sub FROM legacy_claim WHERE id = 'default'"
    ).first();
    if (claim?.claimed_by_sub !== sub) return { skipped: "claimed-by-other" };

    const today = now.slice(0, 10); // YYYY-MM-DD, UTC -- matches llm.js's cap window
    const source = {};
    for (const { table } of ResumeAgent.#IMPORT_TABLES) {
      const isUsage = table === "token_usage";
      const { results } = await this.env.DB.prepare(
        isUsage ? "SELECT * FROM token_usage WHERE day = ?" : `SELECT * FROM ${table}`
      )
        .bind(...(isUsage ? [today] : []))
        .all();
      source[table] = results;
    }

    const counts = Object.fromEntries(
      Object.entries(source).map(([table, rows]) => [table, rows.length])
    );
    if (dryRun) return { dryRun: true, counts };

    const sql = this.ctx.storage.sql;
    const ids = (table) => new Set(source[table].map((r) => r.id));
    const dropped = {};
    const inserted = {};

    this.ctx.storage.transactionSync(() => {
      for (const { table, columns, fk } of ResumeAgent.#IMPORT_TABLES) {
        const parentIds = fk ? ids(fk.parent) : null;
        // Counted as a before/after delta rather than from the cursor:
        // SqlStorageCursor.rowsWritten is a billing-style metric that counts
        // index entries too, so a single insert into an indexed table
        // reports as several "rows written".
        const rowCount = () => sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
        const before = rowCount();

        for (let row of source[table]) {
          if (fk && !parentIds.has(row[fk.column])) {
            if (!fk.nullable) {
              dropped[table] = (dropped[table] || 0) + 1;
              continue;
            }
            row = { ...row, [fk.column]: null };
          }

          // Only name the columns this legacy row actually has. A D1 table
          // that predates a column (production's `profile` has no
          // `target_role`; the `match_score` ALTER TABLE has the same shape)
          // yields rows missing it -- naming it anyway would bind NULL, and
          // NULL into a NOT NULL DEFAULT '' column is a constraint violation
          // that INSERT OR IGNORE then swallows, silently dropping the row.
          // Omitting it lets SQLite apply the column's own DEFAULT instead.
          const present = columns.filter((col) => row[col] !== undefined);
          // ids are preserved, never regenerated: every cv_id/application_id
          // reference in the other tables (and every R2 original_key) points
          // at them, so renumbering would silently orphan the lot.
          const values = present.map((col) =>
            // cvs.parent_id references cvs(id), so a child inserted before
            // its parent would fail the FK check. Forcing NULL on the way in
            // and restoring it in the second pass below sidesteps the
            // ordering problem entirely -- no PRAGMA, no deferred
            // constraints.
            table === "cvs" && col === "parent_id" ? null : row[col] ?? null
          );
          sql.exec(
            `INSERT OR IGNORE INTO ${table} (${present.join(", ")}) ` +
              `VALUES (${present.map(() => "?").join(", ")})`,
            ...values
          );
        }

        inserted[table] = rowCount() - before;

        if (table === "cvs") {
          const present = ids("cvs");
          for (const row of source.cvs) {
            // A parent_id pointing at a CV that no longer exists stays NULL:
            // the constraint would reject it, and NULL is what the column's
            // own ON DELETE SET NULL would have produced anyway.
            if (!row.parent_id || !present.has(row.parent_id)) continue;
            // Guarded on parent_id IS NULL so this only ever fills in the
            // blanks this same import just left, never overwrites a value
            // the live app wrote.
            sql.exec(
              "UPDATE cvs SET parent_id = ? WHERE id = ? AND parent_id IS NULL",
              row.parent_id,
              row.id
            );
          }
        }
      }
    });

    // Marker last: written only once the transaction committed, so a failure
    // anywhere above leaves the import re-runnable (the claim row is already
    // ours, and INSERT OR IGNORE makes the retry safe).
    await this.ctx.storage.put("legacyImportedAt", now);
    // `imported` counts rows SQLite actually wrote, not rows read out of D1:
    // INSERT OR IGNORE swallows constraint violations, so reporting the
    // source counts here would turn silent data loss into a success message.
    // `found` keeps the source side visible so a mismatch is obvious.
    const missing = Object.fromEntries(
      Object.entries(counts)
        .map(([table, n]) => [table, n - (inserted[table] ?? 0) - (dropped[table] ?? 0)])
        .filter(([, n]) => n > 0)
    );
    return { imported: inserted, found: counts, dropped, missing, importedAt: now };
  }

  /** Temporary: proves the schema applied and that two identities get two
   * genuinely separate stores. Removed once the cutover is verified (PR5
   * of the migration plan). */
  #selftest() {
    const counts = {};
    for (const table of ["cvs", "applications", "documents", "activity_events", "templates", "chat_messages", "profile", "token_usage"]) {
      counts[table] = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
    }
    const row = this.ctx.storage.sql
      .exec("SELECT value FROM schema_meta WHERE key = ?", SCHEMA_VERSION_KEY)
      .toArray()[0];
    return { sub: this.state.sub, schemaVersion: row ? Number(row.value) : 0, counts };
  }

  /** Plain HTTP path for curl-based verification -- real clients (sub-project
   * 6) will use the @callable() RPC methods above over WebSocket instead. */
  async onRequest(request) {
    const url = new URL(request.url);
    // Exact match -- our custom routing (src/index.js) never strips a
    // prefix, so the full path always arrives here unchanged.
    if (url.pathname === "/agents/resume-agent/ping") {
      return Response.json(this.ping());
    }
    if (url.pathname === "/agents/resume-agent/selftest") {
      return Response.json(this.#selftest());
    }
    return new Response("Not found", { status: 404 });
  }
}

export default ResumeAgent;
