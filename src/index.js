// Worker entry point.
//
// One Worker serves both halves: static assets from public/ via the `assets`
// binding, and the API below. That's Cloudflare's current shape for a
// full-stack app (it's what superseded Pages + Functions) and it means one
// deploy, one origin, and no CORS between frontend and API.

import { Hono } from "hono";

import { listSkills } from "./lib/skills.js";
import { requireAuth, currentUser, resolveIdentity } from "./lib/auth.js";
import { ResumeAgent } from "./agents/resume-agent.js";
import { getAgentByName } from "agents";
import { subscribe } from "agents/observability";

import cvsRouter from "./routes/cvs.js";
import applicationsRouter from "./routes/applications.js";
import documentsRouter from "./routes/documents.js";
import jobsearchRouter from "./routes/jobsearch.js";
import jobpostRouter from "./routes/jobpost.js";
import tailorRouter from "./routes/tailor.js";
import profileRouter from "./routes/profile.js";
import outreachRouter from "./routes/outreach.js";
import templatesRouter from "./routes/templates.js";
import accountRouter from "./routes/account.js";

const app = new Hono();

// No CORS middleware, deliberately. The frontend is served from this same
// Worker, so it never needs one -- and the Express version's `cors()` sent
// `Access-Control-Allow-Origin: *` with no auth behind it, which let any page
// in the user's browser read the whole CV store.

// Every /api/* route requires a valid Cloudflare Access JWT (see
// lib/auth.js). There's no bypass list here and no login/logout routes of
// this app's own -- signing in and out is entirely Access's hosted UI
// (/cdn-cgi/access/logout, intercepted by Access before it ever reaches this
// Worker) and your Zero Trust policy.
app.use("/api/*", requireAuth());

app.get("/api/auth/me", async (c) =>
  c.json({ email: (await currentUser(c))?.email || null })
);

// --- api --------------------------------------------------------------------

app.route("/api/cvs", cvsRouter);
// Mounted before the bare /api/applications route so the more specific path
// matches first.
app.route("/api/applications/:id/documents", documentsRouter);
app.route("/api/applications", applicationsRouter);
app.route("/api/jobsearch", jobsearchRouter);
app.route("/api/jobpost", jobpostRouter);
app.route("/api/tailor", tailorRouter);
app.route("/api/profile", profileRouter);
app.route("/api/outreach", outreachRouter);
app.route("/api/templates", templatesRouter);
app.route("/api/account", accountRouter);

app.get("/api/skills", (c) => c.json(listSkills()));

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    model: c.env.WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash",
    chatModel: c.env.WORKERS_AI_CHAT_MODEL || c.env.WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash",
    authRequired: c.env.SKIP_AUTH !== "1",
  });
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? c.json({ error: "Not found" }, 404)
    : c.env.ASSETS.fetch(c.req.raw)
);

app.onError((err, c) => {
  console.error(err);
  return c.json(
    { error: err.message || "Internal server error" },
    err.status || 500
  );
});

export { ResumeAgent };

// Structured agent events (RPC calls, state changes, lifecycle) logged via
// console -- captured by Workers Logs (already enabled in wrangler.jsonc,
// included on the Free plan) with zero extra infrastructure. No Tail Worker
// involved: those need the Workers Paid plan, so this account uses this
// console-based path exclusively.
// subscribe() takes the bare channel key ("lifecycle", not "agents:lifecycle")
// and prepends "agents:" itself internally -- passing the prefixed form here
// previously subscribed to the never-published "agents:agents:lifecycle" and
// silently produced zero output.
for (const channel of ["lifecycle", "rpc", "state"]) {
  subscribe(channel, (event) => console.log(JSON.stringify({ channel, ...event })));
}

// Requests under /agents/resume-agent are NOT handled by Hono -- the agent
// instance is always derived from verified identity, server-side, never
// from the URL. (The Agents SDK's default routeAgentRequest() takes the
// instance name from the URL, which would let an authenticated user reach
// another user's agent by typing their email into the path -- see
// docs/superpowers/specs/2026-08-16-resume-agent-core-design.md.)
async function handleAgentRequest(request, env) {
  try {
    const user = await resolveIdentity(request, env);
    if (!user) return Response.json({ error: "Not authenticated." }, { status: 401 });

    // Keyed by `sub`, not `email`: `sub` is stable across an email change at
    // the identity provider, `email` is not -- see src/lib/auth.js and the
    // Access JWT docs. Keying by email would silently orphan a user's
    // agent (and, once sub-project 2 lands, their CVs/applications) the
    // moment their email changes.
    const agent = await getAgentByName(env.RESUME_AGENT, user.sub);
    // First access to a fresh instance has no state yet -- stamp identity
    // once. Cheap no-op on every subsequent call (setIdentity no-ops if
    // already set).
    await agent.setIdentity(user.email, user.sub);
    return agent.fetch(request);
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: err.status || 500 }
    );
  }
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
