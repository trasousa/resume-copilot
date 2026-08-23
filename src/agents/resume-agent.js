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

import { Agent, callable } from "agents";

export class ResumeAgent extends Agent {
  initialState = { sub: null, email: null, createdAt: null };

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

  /** Plain HTTP path for curl-based verification -- real clients (sub-project
   * 6) will use the @callable() RPC methods above over WebSocket instead. */
  async onRequest(request) {
    const url = new URL(request.url);
    // Exact match -- our custom routing (src/index.js) never strips a
    // prefix, so the full path always arrives here unchanged.
    if (url.pathname === "/agents/resume-agent/ping") {
      return Response.json(this.ping());
    }
    return new Response("Not found", { status: 404 });
  }
}

export default ResumeAgent;
