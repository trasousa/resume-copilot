import { Hono } from "hono";
import * as db from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runWebSearchTask } from "../lib/llm.js";
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
  const { cvId, city, region, country, remote, minComp, notes } =
    await c.req.json();

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  if (!remote && !city && !region && !country)
    return c.json({ error: "Provide a location, or set remote=true." }, 400);

  const stable =
    `You are a job-search copilot with live web search access. Follow the skill ` +
    `guidance below precisely. Only report postings you actually found via ` +
    `search, with real URLs from the results -- never invent a company, ` +
    `listing, or link.\n\n` +
    buildSkillPrompt(SKILL_ROUTES.jobSearch);

  const locationLine = remote
    ? `Remote (${[city, region, country].filter(Boolean).join(", ") || "any location"})`
    : [city, region, country].filter(Boolean).join(", ");

  const prompt =
    `Candidate's CV:\n"""\n${cv.content}\n"""\n\n` +
    `Search for open job postings that fit this candidate, favoring higher ` +
    `compensation among good fits.\nTarget location: ${locationLine}\n` +
    (minComp ? `Minimum target compensation: ${minComp}\n` : "") +
    (notes ? `Additional preferences from the candidate: ${notes}\n` : "") +
    `\nReturn the ranked shortlist per the skill's output format as readable ` +
    `markdown.\n\nThen, ALSO output the same shortlist as a JSON array (same ` +
    `jobs, same order) inside a fenced block starting with \`\`\`JOBS and ending ` +
    `with \`\`\`, where each item is exactly: {"title": string, "company": string, ` +
    `"location": string, "url": string, "compEstimate": string, "matchScore": ` +
    `number, "fitNote": string}. Each item must also include "matchScore": an integer 0-100 ` +
    `estimating how well this posting fits the candidate's CV (skills, ` +
    `seniority, domain overlap) -- the same scale used elsewhere for match ` +
    `scoring. The "url" must be a real URL from your search results -- omit a ` +
    `job from the JSON entirely rather than inventing a URL.`;

  const [{ text, sources }, atsResult] = await Promise.all([
    runWebSearchTask({ env: c.env, stable, prompt, location: { city, region, country } }),
    runApifyAtsSearch({
      apiToken: c.env.APIFY_API_TOKEN,
      watchlist: parseWatchlist(c.env),
    }),
  ]);

  // Merge the ATS-sourced jobs into the same JOBS block the frontend
  // already parses, deduplicated by URL so a job both sources happen to
  // find isn't shown twice.
  const jobsMatch = text.match(/```JOBS\n([\s\S]*?)\n```/);
  let webJobs = [];
  if (jobsMatch) {
    try { webJobs = JSON.parse(jobsMatch[1]); } catch { webJobs = []; }
  }
  const seenUrls = new Set(webJobs.map((j) => j.url));
  const mergedJobs = [...webJobs, ...atsResult.jobs.filter((j) => !seenUrls.has(j.url))];
  const mergedText = jobsMatch
    ? text.replace(jobsMatch[0], "```JOBS\n" + JSON.stringify(mergedJobs, null, 2) + "\n```")
    : text;

  return c.json({ text: mergedText, sources, atsError: atsResult.error });
});

export default router;
