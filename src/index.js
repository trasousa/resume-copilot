// Worker entry point.
//
// One Worker serves both halves: static assets from public/ via the `assets`
// binding, and the API below. That's Cloudflare's current shape for a
// full-stack app (it's what superseded Pages + Functions) and it means one
// deploy, one origin, and no CORS between frontend and API.

import { Hono } from "hono";

import { listSkills } from "./lib/skills.js";
import { requireAuth, currentUser } from "./lib/auth.js";

import cvsRouter from "./routes/cvs.js";
import applicationsRouter from "./routes/applications.js";
import documentsRouter from "./routes/documents.js";
import jobsearchRouter from "./routes/jobsearch.js";
import tailorRouter from "./routes/tailor.js";

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
app.route("/api/tailor", tailorRouter);

app.get("/api/skills", (c) => c.json(listSkills()));

app.get("/api/health", (c) => {
  const provider = (c.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const isGemini = provider === "gemini";
  return c.json({
    ok: true,
    provider,
    hasApiKey: isGemini ? !!c.env.GOOGLE_API_KEY : !!c.env.ANTHROPIC_API_KEY,
    apiKeyName: isGemini ? "GOOGLE_API_KEY" : "ANTHROPIC_API_KEY",
    model: isGemini
      ? c.env.GEMINI_MODEL || "gemini-2.5-flash"
      : c.env.ANTHROPIC_MODEL || "claude-opus-5",
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

export default app;
