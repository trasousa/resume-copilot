# ResumeAgent core: Durable Object skeleton, per-user routing, observability

## Context

This app currently makes stateless one-shot LLM calls from Hono routes, with
skill markdown injected as a system prompt per request (`src/lib/anthropic.js`,
`src/lib/gemini.js`, dispatched via `src/lib/llm.js`). Three separate problems
converged on the same fix:

1. **Job Search is broken.** It depends on Gemini's `googleSearch` grounding
   tool, which has zero quota on a free-tier (no billing) API key — confirmed
   by direct testing against the live API (immediate 429 the instant the tool
   is attached, even as the first call of a session).
2. **The app is meant to be multi-user**, but nothing in the data model
   supports that — `cvs`, `applications`, `profile`, etc. are single global
   pools with no per-user separation.
3. **Interactions with the model are unconstrained.** CV tailoring, cover
   letters, and the CV-improvement flow are all free-text prompt assembly
   rather than controlled, parameterized calls — there's no consistent way to
   trace what an interaction actually did.

Investigating a fix for (1) led to Cloudflare's Agents SDK, which turns out to
solve all three at once: `agents/browser`'s `browser_search`/`browser_execute`
tools do real live web search independent of any model's built-in grounding
(confirmed via Cloudflare's docs — Workers AI models are notably absent from
the provider list AI Gateway proxies native search for); a Durable-Object-backed
`Agent` per user gives multi-tenancy structurally, for free, as a side effect
of the instance boundary; and `@callable()` RPC methods with typed parameters
are a natural fit for "controlled interactions" in place of raw prompt
strings.

Given the size of a full agent-native rebuild (data migration off D1, a
frontend rewrite onto the Agents client SDK, browser-tool-based job search,
etc.), this is being built as a sequence of sub-projects, each with its own
design:

1. **Core Agent + auth** (this document) — skeleton, routing, observability.
2. Data migration — `cvs`/`applications`/`documents`/`chat_messages`/`profile`
   move from D1 into each user's Agent SQLite storage.
3. Generation as controlled agent methods — tailoring, cover letters,
   interview prep, etc. as typed `@callable()` methods.
4. CV improvement restructured — replaces the current free-text chat with a
   parameter-driven interaction.
5. Job Search via Browser Rendering — `browser_search`/`browser_execute`,
   no LLM grounding dependency.
6. Frontend on the Agents client SDK — replacing `fetch()`-based pages with
   agent RPC (open question: whether this forces a React/build-step onto the
   currently zero-build vanilla JS frontend, or whether the framework-agnostic
   `AgentClient` avoids that — resolved in that sub-project's own brainstorm).
7. Observability consumption — where Tail Worker events actually get
   reviewed day to day.

Model choice (settled, applies across all sub-projects): **Workers AI only**,
`@cf/zai-org/glm-4.7-flash` by default ($0.06/$0.40 per M tokens, 131K
context, free-tier eligible), called through **AI Gateway** rather than the
raw `env.AI` binding so every call gets per-request logging/analytics for
free alongside the Agent's own observability. Anthropic and Gemini are
dropped entirely — no more `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`, no
multi-vendor abstraction in `lib/llm.js`. "Swappable" means swapping which
`@cf/...` model id is configured, not swapping vendors.

## Architecture

One `ResumeAgent` class (`src/agents/resume-agent.js`) extending
`Agent<Env, State>`, backed by a Durable Object. **One instance per user** —
the DO instance boundary is the multi-tenancy boundary, so no separate
`users` table is needed to get per-user data isolation; it falls out of the
Agents SDK's own routing model.

For this skeleton, state is minimal:

```typescript
type State = { email: string; createdAt: string };
```

Real CV/application/profile data arrives in sub-project 2 — this sub-project
proves the plumbing (auth → correct instance → RPC → observable), not the
data model.

## Auth and routing (security-critical)

Cloudflare Access continues to protect the whole domain at the edge exactly
as today — unchanged. The change is inside the Worker: a request must **never
let the client choose which agent instance it reaches**. The Agents SDK's
default `routeAgentRequest()` pattern (`/agents/{name}/{instance}`) takes the
instance name from the URL, which would let an authenticated User A type User
B's email into the URL and reach User B's agent. That's not acceptable.

Instead: a custom `fetch` handler verifies the Access JWT first (reusing
`verifyAccessJwt` from `src/lib/auth.js`), extracts the email, and calls
`getAgentByName(env.RESUME_AGENT, email)` directly — the **server** decides
the instance from verified identity, always. Any instance name that might
appear in a client-supplied URL is ignored. This applies identically to the
WebSocket upgrade request used for agent RPC — Access intercepts it at the
edge the same as any other request to the protected domain, so no separate
WebSocket auth mechanism is needed, only the same JWT verification already in
place, run before agent lookup instead of after.

## Configuration

`wrangler.jsonc` additions (nothing existing is removed in this sub-project):

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "RESUME_AGENT", "class_name": "ResumeAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ResumeAgent"] }],
  "ai": { "binding": "AI" }
}
```

`d1_databases`, `r2_buckets`, `assets`, and the `CF_ACCESS_*` vars are
untouched — D1 migration is sub-project 2, frontend/asset changes are
sub-project 6. The `agents` npm package is a new dependency.

## Observability

A Tail Worker attached to this Worker, subscribed to the `agents:*`
diagnostics-channel events (`agents:lifecycle`, `agents:rpc`, `agents:state`
at minimum), logging structured events. Viewable immediately via
`wrangler tail` and the dashboard's Workers Logs — no new infrastructure for
this sub-project. A queryable D1 audit table is a reasonable later upgrade
(sub-project 7's concern), not needed to prove the skeleton works.

## Verification

1. One trivial `@callable()` method, e.g. `ping()` returning
   `{ ...this.state, calledAt: new Date().toISOString() }`.
2. Authenticate as two different test identities (two different Access
   policy emails, or `SKIP_AUTH` swapped for two fake JWTs in a local test
   harness) and confirm each reaches a distinct agent instance with isolated
   state — proves the routing fix actually prevents cross-user access, not
   just that routing works at all.
3. Confirm an unauthenticated request (no valid Access JWT) is rejected
   before ever reaching `getAgentByName` — the fail-closed behavior from
   today's `requireAuth()` must carry over exactly.
4. `wrangler tail` (or the dashboard) shows `agents:lifecycle` on first
   connect and `agents:rpc` for the `ping()` call, per instance.
