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
