import { Hono } from "hono";
import * as db from "../lib/db.js";
import { runTask } from "../lib/llm.js";
import { runApifyAtsSearch } from "../lib/apify.js";

const router = new Hono();

// APIFY_WATCHLIST is a JSON array of {"url","company"} objects -- which
// companies' ATS career pages to scrape. A personal curation list, kept in
// an env var (not hardcoded) so it's editable per-deployment. Malformed or
// unset -> empty list -> the ATS source silently contributes nothing.
function parseWatchlist(env) {
  try {
    const parsed = JSON.parse(env.APIFY_WATCHLIST || "[]");
    return Array.isArray(parsed) ? parsed.filter((w) => w?.url && w?.company) : [];
  } catch {
    return [];
  }
}

router.post("/search", async (c) => {
  const { cvId, city, region, country, remote, minComp, notes } = await c.req.json();

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const watchlist = parseWatchlist(c.env);
  if (!watchlist.length) {
    return c.json({
      text: "No companies configured to search yet. Add at least one to APIFY_WATCHLIST to see results here.",
      jobs: [],
      atsError: null,
    });
  }

  const ats = await runApifyAtsSearch({ apiToken: c.env.APIFY_API_TOKEN, watchlist });
  if (ats.error) {
    return c.json({ text: "", jobs: [], atsError: ats.error });
  }
  if (!ats.jobs.length) {
    return c.json({ text: "No open roles found at your watchlisted companies right now.", jobs: [], atsError: null });
  }

  // Rank the real, scraped listings against the candidate's CV -- this is
  // a plain LLM call (no search capability needed), which Workers AI
  // handles fine; it's live web search specifically that Workers AI lacks.
  const stable =
    `You are a job-matching assistant. You will be given a candidate's CV ` +
    `and a list of real, already-found job postings. Rank them by fit for ` +
    `this candidate and explain briefly why. Never invent postings or ` +
    `details not present in the list you were given. Do not use emojis.`;

  const locationLine = remote
    ? `Remote (${[city, region, country].filter(Boolean).join(", ") || "any location"})`
    : [city, region, country].filter(Boolean).join(", ");

  const prompt =
    `Candidate's CV:\n"""\n${cv.content}\n"""\n\n` +
    `Target location: ${locationLine || "any"}\n` +
    (minComp ? `Minimum target compensation: ${minComp}\n` : "") +
    (notes ? `Additional preferences: ${notes}\n` : "") +
    `\nJob postings found:\n${JSON.stringify(ats.jobs, null, 2)}\n\n` +
    `Return two things:\n` +
    `1. A short markdown summary (2-4 sentences) of the overall fit of this batch.\n` +
    `2. A fenced block starting with \`\`\`RANKED and ending with \`\`\` containing ` +
    `a JSON array, same jobs, reordered best-fit-first, each with an added ` +
    `"matchScore" (integer 0-100) and "fitNote" (one sentence) field.`;

  const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 4000 });

  let rankedJobs = ats.jobs;
  const rankedMatch = text.match(/```RANKED\n([\s\S]*?)\n```/);
  if (rankedMatch) {
    try {
      const parsed = JSON.parse(rankedMatch[1]);
      if (Array.isArray(parsed)) rankedJobs = parsed;
    } catch {
      // Fall through to the unranked (but still real) job list.
    }
  }

  const summary = text.replace(/```RANKED\n[\s\S]*?\n```/, "").trim();
  return c.json({ text: summary, jobs: rankedJobs, atsError: null });
});

export default router;
