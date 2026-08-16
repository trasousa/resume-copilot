// Per-user agent: one Durable Object instance per authenticated user,
// addressed by email (see src/lib/auth.js resolveIdentity and
// src/index.js). This file is intentionally minimal -- it proves the
// routing/auth/observability plumbing works before any real CV/tailoring
// logic moves here (see docs/superpowers/specs/2026-08-16-resume-agent-core-design.md
// for the full sub-project sequence).

import { Agent, callable } from "agents";

export class ResumeAgent extends Agent {
  initialState = { email: null, createdAt: null };

  onStart() {
    if (!this.state.email) {
      // First time this instance is ever accessed. The email that routed
      // here is set explicitly by the caller via setEmail() immediately
      // after creation -- see src/index.js.
    }
  }

  /** Called once, immediately after the first request routes to a new
   * instance -- see src/index.js. Not a constructor param because Durable
   * Object instances are looked up by name, not constructed with args. */
  @callable()
  setEmail(email) {
    if (!this.state.email) {
      this.setState({ email, createdAt: new Date().toISOString() });
    }
    return this.state;
  }

  @callable()
  ping() {
    return { ...this.state, calledAt: new Date().toISOString() };
  }

  /** Plain HTTP path for curl-based verification -- real clients (sub-project
   * 6) will use the @callable() RPC methods above over WebSocket instead. */
  async onRequest(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ping")) {
      return Response.json(this.ping());
    }
    return new Response("Not found", { status: 404 });
  }
}

export default ResumeAgent;
