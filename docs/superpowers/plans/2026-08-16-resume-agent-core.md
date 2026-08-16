# ResumeAgent Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a per-user `ResumeAgent` Durable Object, routed from verified Cloudflare Access identity (never a client-supplied URL segment), with one trivial callable method proven end-to-end and Tail Worker observability wired.

**Architecture:** `src/index.js`'s default export becomes a thin wrapper: requests under `/agents/resume-agent` are identity-checked first (reusing the existing Access JWT verification, extended with a local-dev escape hatch), then handed to `getAgentByName(env.RESUME_AGENT, email)` -- everything else still goes to the existing Hono `app`, untouched. A separate Tail Worker (`tail-worker/`) receives `agents:*` diagnostics events in production with zero code in the agent itself.

**Tech Stack:** Cloudflare Workers, Durable Objects (SQLite-backed), the `agents` npm package, Hono (existing), `jose` (existing, for JWT verification).

**Spec:** `docs/superpowers/specs/2026-08-16-resume-agent-core-design.md`

## Global Constraints

- No data migration in this plan -- D1 (`cvs`, `applications`, `documents`, `chat_messages`, `profile`) stays exactly as-is. That's sub-project 2.
- No frontend changes in this plan -- all five existing pages keep working exactly as today. That's sub-project 6.
- The agent instance name is **always** derived server-side from the verified identity. A client-supplied instance name in a URL must never be trusted or used for routing.
- `SKIP_AUTH=1` (wrangler dev only, `.dev.vars`) must continue to work exactly as it does today for every existing `/api/*` route.
- Nothing in `d1_databases`, `r2_buckets`, `assets`, or the `CF_ACCESS_*` vars in `wrangler.jsonc` is removed or altered.

---

### Task 1: Refactor auth verification to work outside Hono, add local multi-identity testing

**Files:**
- Modify: `src/lib/auth.js`

**Interfaces:**
- Produces: `resolveIdentity(request: Request, env: Env): Promise<{ email: string } | null>` -- the function Task 3's raw Worker-level routing uses. Also used internally by `requireAuth()`/`currentUser()` so Hono's behavior is unchanged.

Today, `verifyAccessJwt(c)` reads the JWT header via Hono's `c.req.header()` and only runs inside Hono middleware. The new agent routing in `src/index.js` runs *before* Hono ever sees the request, so it needs a version that works from a raw `Request` object. This task also adds a local-only way to test multiple identities: `wrangler dev` traffic never carries a real Access JWT (Access can't front localhost), so `SKIP_AUTH=1` currently bypasses auth checks entirely with no identity at all -- that's fine for the existing REST routes, but the per-user Agent routing needs *some* identity to route by, even locally. An `X-Dev-User` header (SKIP_AUTH mode only) fills that gap.

- [ ] **Step 1: Read the current file to confirm line numbers before editing**

Run: `sed -n '45,104p' src/lib/auth.js`

Confirm it matches what's quoted below (guards against drift since this was last touched).

- [ ] **Step 2: Replace the verification + auth-export section**

Replace lines 45-104 of `src/lib/auth.js` (from `import { createRemoteJWKSet, jwtVerify } from "jose";` to the end of the file) with:

```javascript
import { createRemoteJWKSet, jwtVerify } from "jose";

const HEADER = "Cf-Access-Jwt-Assertion";

// createRemoteJWKSet caches the fetched keys (and handles rotation) across
// calls on its own -- caching the JWKSet itself per warm isolate just avoids
// re-registering it on every request.
let jwks = null;
let jwksTeamDomain = null;

function jwksFor(env) {
  if (!jwks || jwksTeamDomain !== env.CF_ACCESS_TEAM_DOMAIN) {
    jwks = createRemoteJWKSet(
      new URL(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
    );
    jwksTeamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  }
  return jwks;
}

async function verifyAccessJwt(request, env) {
  const { CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD } = env;
  if (!CF_ACCESS_TEAM_DOMAIN || !CF_ACCESS_AUD) return null;

  const token = request.headers.get(HEADER);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwksFor(env), {
      issuer: `https://${CF_ACCESS_TEAM_DOMAIN}`,
      audience: CF_ACCESS_AUD,
    });
    return { email: String(payload.email || "").toLowerCase() };
  } catch {
    // Expired, wrong audience, bad signature, wrong issuer -- all the same
    // outcome from the caller's side: not authenticated.
    return null;
  }
}

/**
 * Resolves the authenticated identity from a raw Request -- used both by
 * the Hono middleware below and by the Agent routing in src/index.js, which
 * runs before Hono and has no Hono context to read a header from.
 *
 * In SKIP_AUTH mode (wrangler dev only -- Access never reaches localhost),
 * identity comes from an X-Dev-User header instead of a real JWT, defaulting
 * to "dev@local" if absent. This is what lets the per-user Agent routing be
 * exercised locally with multiple distinct identities (send different
 * X-Dev-User values) without needing a real Access session.
 */
export async function resolveIdentity(request, env) {
  if (env.SKIP_AUTH === "1") {
    const devUser = request.headers.get("X-Dev-User") || "dev@local";
    return { email: devUser.toLowerCase() };
  }
  return verifyAccessJwt(request, env);
}

export function requireAuth() {
  return async (c, next) => {
    const user = await resolveIdentity(c.req.raw, c.env);
    if (!user) return c.json({ error: "Not authenticated." }, 401);

    c.set("user", user);
    return next();
  };
}

/** Best-effort: who's signed in, or null. Used by /api/auth/me. */
export async function currentUser(c) {
  return c.get("user") || (await resolveIdentity(c.req.raw, c.env));
}
```

- [ ] **Step 3: Verify existing behavior is unchanged**

Run: `node --check src/lib/auth.js` -- expect no output (syntax OK).

Start the dev server and confirm the existing SKIP_AUTH flow still works exactly as before:

Run: `npm run dev &` then, once `Ready on http://localhost:8787` appears:
```bash
curl -s http://localhost:8787/api/health
```
Expected: `{"ok":true,...}` (200) -- unchanged from before this refactor, since `.dev.vars` still has `SKIP_AUTH=1`.

Run:
```bash
curl -s http://localhost:8787/api/auth/me
```
Expected: `{"email":"dev@local"}` -- this is a deliberate, harmless change from before (previously returned `{"email":null}` under SKIP_AUTH). Note it in the commit message.

Stop the dev server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.js
git commit -m "$(cat <<'EOF'
Extract request-level Access identity resolution for Agent routing

verifyAccessJwt only worked inside Hono middleware (read the JWT
header via c.req.header()). The upcoming per-user Agent routing runs
before Hono ever sees the request, so it needs a version that works
from a raw Request. Also adds an X-Dev-User header escape hatch under
SKIP_AUTH so multiple identities can be exercised locally -- Access
never reaches localhost, so there's no other way to test per-user
routing without deploying.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add the `agents` package, Durable Object binding, and a minimal `ResumeAgent` skeleton

**Files:**
- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Create: `src/agents/resume-agent.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task is independent scaffolding).
- Produces: `ResumeAgent` class (default export from `src/agents/resume-agent.js`), with a `@callable() ping()` method and an `onRequest(request)` HTTP handler at subpath `/ping` -- both return the same JSON shape `{ email, createdAt, calledAt }`. Task 3 imports and re-exports this class, and routes requests to it.

- [ ] **Step 1: Install the `agents` package**

Run: `npm install agents`

- [ ] **Step 2: Add Durable Object + AI bindings to `wrangler.jsonc`**

Add these two top-level keys to `wrangler.jsonc`, after the existing `"r2_buckets"` array and before the `"vars"` block (the vars comment currently sits right after `r2_buckets` -- insert before it):

```jsonc
  // Per-user agent state (Durable Object, SQLite-backed). One instance per
  // authenticated user, addressed by email -- see src/lib/auth.js
  // (resolveIdentity) and src/index.js for how the instance name is
  // derived server-side, never from a client-supplied URL.
  "durable_objects": {
    "bindings": [{ "name": "RESUME_AGENT", "class_name": "ResumeAgent" }]
  },
  // Never edit an existing migration entry -- add a new tag for future
  // agent classes or storage changes.
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ResumeAgent"] }],

  // Workers AI -- see docs/superpowers/specs/2026-08-16-resume-agent-core-design.md
  // for why (glm-4.7-flash via AI Gateway, replacing Anthropic/Gemini). Not
  // used by this skeleton yet -- wired here so later sub-projects don't need
  // another wrangler.jsonc change.
  "ai": { "binding": "AI" },

```

- [ ] **Step 3: Create the `ResumeAgent` skeleton**

Create `src/agents/resume-agent.js`:

```javascript
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
```

- [ ] **Step 4: Verify the config and class load without error**

Run: `node --check src/agents/resume-agent.js` -- expect no output.

Run: `npx wrangler types` -- expect it to complete without error and regenerate `worker-configuration.d.ts` (confirms `wrangler.jsonc` is valid and the DO binding is recognized).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json wrangler.jsonc src/agents/resume-agent.js
git commit -m "$(cat <<'EOF'
Add ResumeAgent skeleton: per-user Durable Object, AI binding

Minimal on purpose -- initialState, a setEmail() used once at
first-access to stamp identity, and a ping() callable/HTTP endpoint
to prove the routing (Task 3) end to end. Real CV/tailoring logic
moves here in later sub-projects, not this one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Route `/agents/resume-agent` to the correct per-user instance

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `resolveIdentity(request, env)` from Task 1 (`src/lib/auth.js`); `ResumeAgent` from Task 2 (`src/agents/resume-agent.js`).
- Produces: `GET /agents/resume-agent/ping` (and any other subpath) -- reachable only with a valid identity, always routed to that identity's own instance.

- [ ] **Step 1: Modify `src/index.js`**

Replace the file's final two lines (`export default app;`) with the following, and add the two new imports near the top alongside the existing ones:

```javascript
import { ResumeAgent } from "./agents/resume-agent.js";
import { getAgentByName } from "agents";
import { resolveIdentity } from "./lib/auth.js";
```

(Add these three lines directly after the existing `import { requireAuth, currentUser } from "./lib/auth.js";` line.)

Then replace `export default app;` at the end of the file with:

```javascript
export { ResumeAgent };

// Requests under /agents/resume-agent are NOT handled by Hono -- the agent
// instance is always derived from verified identity, server-side, never
// from the URL. (The Agents SDK's default routeAgentRequest() takes the
// instance name from the URL, which would let an authenticated user reach
// another user's agent by typing their email into the path -- see
// docs/superpowers/specs/2026-08-16-resume-agent-core-design.md.)
async function handleAgentRequest(request, env) {
  const user = await resolveIdentity(request, env);
  if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const agent = await getAgentByName(env.RESUME_AGENT, user.email);
  // First access to a fresh instance has no state yet -- stamp identity
  // once. Cheap no-op on every subsequent call (setEmail no-ops if already set).
  await agent.setEmail(user.email);
  return agent.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/agents/resume-agent" || url.pathname.startsWith("/agents/resume-agent/")) {
      return handleAgentRequest(request, env);
    }
    return app.fetch(request, env, ctx);
  },
};
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/index.js` -- expect no output.

- [ ] **Step 3: Verify end-to-end locally, including the auth failure path**

Start the dev server: `npm run dev &` and wait for `Ready on http://localhost:8787`.

First, prove the 401 path actually rejects unauthenticated requests -- `SKIP_AUTH=1` makes `resolveIdentity` always succeed locally, so this has to be tested with it temporarily off, exercising the real `verifyAccessJwt` path (this mirrors the same temporarily-disable-SKIP_AUTH technique already used earlier in this project for testing the Access-adjacent auth flow):

```bash
cp .dev.vars /tmp/dev_vars_backup
grep -v '^SKIP_AUTH=' .dev.vars > /tmp/dev_vars_noauth && mv /tmp/dev_vars_noauth .dev.vars
npm run dev &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/agents/resume-agent/ping
```
Expected: `401` -- no `Cf-Access-Jwt-Assertion` header is present (Access can't reach localhost), so `verifyAccessJwt` correctly returns null and the handler rejects before ever calling `getAgentByName`.

```bash
kill %1
cp /tmp/dev_vars_backup .dev.vars
rm /tmp/dev_vars_backup
```

Restore confirmed -- `.dev.vars` is back to exactly its original state (`SKIP_AUTH=1` present again) before continuing.

Now start the dev server again with `SKIP_AUTH=1` restored and verify **routing to the correct per-user instance**:

```bash
npm run dev &
sleep 6
curl -s http://localhost:8787/agents/resume-agent/ping -H "X-Dev-User: alice@example.com"
```
Expected: `{"email":"alice@example.com","createdAt":"...","calledAt":"..."}`

```bash
curl -s http://localhost:8787/agents/resume-agent/ping -H "X-Dev-User: bob@example.com"
```
Expected: `{"email":"bob@example.com","createdAt":"...","calledAt":"..."}` -- a **different** `createdAt` than alice's response, proving these are two distinct Durable Object instances, not shared state.

```bash
curl -s http://localhost:8787/agents/resume-agent/ping -H "X-Dev-User: alice@example.com"
```
Expected: the **same** `createdAt` as alice's first call (not a new one) -- proving state persists across requests to the same instance.

Confirm nothing else broke:
```bash
curl -s http://localhost:8787/api/cvs
```
Expected: the existing CV list response (200), unchanged -- proves the Hono app still handles every non-agent path exactly as before.

Stop the dev server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "$(cat <<'EOF'
Route /agents/resume-agent to the caller's own per-user instance

Verified end-to-end locally: two different X-Dev-User identities land
on two distinct Durable Object instances with isolated, persisted
state, and every existing /api/* route is untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tail Worker for observability

**Files:**
- Create: `tail-worker/wrangler.jsonc`
- Create: `tail-worker/index.js`
- Modify: `wrangler.jsonc` (root)
- Modify: `package.json` (add a deploy script)

**Interfaces:**
- Consumes: nothing from earlier tasks directly -- this is infrastructure that observes the main Worker in production.
- Produces: a deployable, independent Worker (`resume-copilot-tail`) with a `tail()` handler; a `tail_consumers` entry on the root Worker pointing at it.

This only works in production (Access, and real deployed Durable Objects) -- there is no local-dev equivalent, matching how `SKIP_AUTH` already documents that Access itself can't be exercised locally.

- [ ] **Step 1: Create the Tail Worker**

Create `tail-worker/index.js`:

```javascript
// Receives forwarded diagnostics-channel events from the main Worker's
// ResumeAgent (agents:lifecycle, agents:rpc, agents:state, ...) with zero
// subscription code needed in the agent itself -- Cloudflare forwards them
// automatically to any Worker listed in the producer's tail_consumers.
// See docs/superpowers/specs/2026-08-16-resume-agent-core-design.md.
export default {
  async tail(events) {
    for (const event of events) {
      for (const msg of event.diagnosticsChannelEvents || []) {
        console.log(JSON.stringify({
          timestamp: msg.timestamp,
          channel: msg.channel,
          message: msg.message,
        }));
      }
    }
  },
};
```

Create `tail-worker/wrangler.jsonc`:

```jsonc
{
  "$schema": "../node_modules/wrangler/config-schema.json",
  "name": "resume-copilot-tail",
  "main": "index.js",
  "compatibility_date": "2026-08-01"
}
```

- [ ] **Step 2: Wire the root Worker to send events to it**

Add this key to the root `wrangler.jsonc`, alongside the other top-level keys (after `"observability": { "enabled": true },`):

```jsonc
  // Forwards agents:* diagnostics-channel events (RPC calls, state changes,
  // lifecycle) to the Tail Worker in tail-worker/ -- production only, no
  // local-dev equivalent. See tail-worker/index.js.
  "tail_consumers": [{ "service": "resume-copilot-tail" }],
```

- [ ] **Step 3: Add a deploy script for the Tail Worker**

Add this line to `package.json`'s `"scripts"` block, next to the existing `"deploy"` entry:

```json
    "deploy:tail": "cd tail-worker && wrangler deploy",
```

- [ ] **Step 4: Verify config validity**

Run: `node --check tail-worker/index.js` -- expect no output.

Run (from `tail-worker/`): `cd tail-worker && npx wrangler deploy --dry-run --outdir /tmp/tail-dryrun && cd ..` -- expect it to complete without error (confirms `tail-worker/wrangler.jsonc` is valid on its own).

Run (from the project root): `npx wrangler deploy --dry-run --outdir /tmp/main-dryrun` -- expect the bindings table to include the `RESUME_AGENT` Durable Object and no error about `tail_consumers` referencing an unknown service (the reference is by name only; the dry run doesn't require the tail worker to already be deployed).

- [ ] **Step 5: Commit**

```bash
git add tail-worker/ wrangler.jsonc package.json
git commit -m "$(cat <<'EOF'
Add Tail Worker for ResumeAgent observability

Separate deployable Worker (npm run deploy:tail) that receives every
agents:* diagnostics-channel event forwarded automatically in
production -- no subscription code needed in the agent itself. This
is the "trace all the calls and interactions" requirement from the
design spec. Production-only; there's no local-dev equivalent
(matches how Access itself can't be exercised locally either).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Deploy and verify in production

**Files:** none (deployment + manual verification only)

**Interfaces:** none -- this task closes out the sub-project by proving everything from Tasks 1-4 works against real Cloudflare Access, not just `SKIP_AUTH`.

- [ ] **Step 1: Deploy the Tail Worker first**

Run: `npm run deploy:tail`

Expected: successful deploy, prints the `resume-copilot-tail` Worker URL (not used directly -- it only receives forwarded events).

- [ ] **Step 2: Deploy the main Worker**

Run: `npm run deploy`

Expected: successful deploy to `resume.btopencloud.com`, bindings table includes `env.RESUME_AGENT` and `env.AI`.

- [ ] **Step 3: Verify via Access-authenticated browser session**

In a browser, sign in at `https://resume.btopencloud.com` as usual (Access intercepts, same as every existing page). Once signed in, the browser holds a valid `CF_Authorization` cookie that Access attaches to same-origin requests -- open the browser's dev tools console on that page and run:

```javascript
fetch("/agents/resume-agent/ping").then(r => r.json()).then(console.log)
```

Expected: `{ email: "<your Access-verified email>", createdAt: "...", calledAt: "..." }`.

- [ ] **Step 4: Verify the Tail Worker sees it**

Run: `npx wrangler tail resume-copilot --format pretty`, then repeat the `fetch("/agents/resume-agent/ping")` call from Step 3 in the browser.

Expected: log lines showing `agents:lifecycle` (instance start/connect) and `agents:rpc` (the `setEmail`/`ping` calls) events for your email, appearing within a few seconds.

Stop the tail: `Ctrl+C`.

- [ ] **Step 5: Confirm no regression on existing pages**

Click through all five existing pages (Tracker, CV Store, Tailor, Job Search, an Application detail page) as a final smoke test -- confirm every one still loads and works exactly as before this sub-project (they don't touch the Agent at all yet, so this should be a non-event, but it's the cheapest possible check that nothing in `src/index.js` broke the existing Hono routing).

No commit for this task -- it's verification of what Tasks 1-4 already committed.
