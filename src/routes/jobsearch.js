import { Hono } from "hono";
import * as db from "../lib/db.js";
import { runTask } from "../lib/llm.js";
import { fetchArbeitnowJobs } from "../lib/arbeitnow.js";
import { fetchHimalayasJobs } from "../lib/himalayas.js";
import { fetchJSearchJobs } from "../lib/jsearch.js";
import { dedupeJobs } from "../lib/jobdedup.js";
import { geocodeLocations, normalizeQuery } from "../lib/geocode.js";

const router = new Hono();

const SOURCES = ["arbeitnow", "himalayas", "jsearch"];

// JSearch needs an ISO-2 country code; Himalayas matches on full country
// names. The same user-typed `country` field can't satisfy both, so this
// maps common names to codes for JSearch specifically -- Himalayas keeps
// receiving the raw string unchanged. Falls back to treating the input as
// an already-valid code (lowercased) if it's not in the map, so a user who
// already typed "us"/"de"/etc. still works.
const COUNTRY_NAME_TO_CODE = {
  "united states": "us", "usa": "us", "us": "us",
  "united kingdom": "gb", "uk": "gb", "great britain": "gb",
  "germany": "de", "deutschland": "de",
  "canada": "ca",
  "france": "fr",
  "spain": "es",
  "italy": "it",
  "netherlands": "nl",
  "ireland": "ie",
  "australia": "au",
  "india": "in",
  "brazil": "br",
  "mexico": "mx",
  "poland": "pl",
  "portugal": "pt",
  "sweden": "se",
  "switzerland": "ch",
  "austria": "at",
  "belgium": "be",
};

function toJSearchCountryCode(country) {
  const key = String(country || "").trim().toLowerCase();
  if (!key) return "us";
  if (COUNTRY_NAME_TO_CODE[key]) return COUNTRY_NAME_TO_CODE[key];
  if (/^[a-z]{2}$/.test(key)) return key;
  return "us";
}

router.post("/search", async (c) => {
  const { cvId, city, region, country, remote, minComp, notes } = await c.req.json();

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const query = "jobs";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      for (const source of SOURCES) send("source", { source, status: "searching" });

      const [arbeitnowResult, himalayasResult, jsearchResult] = await Promise.all([
        fetchArbeitnowJobs({ remote, city, region, country }).then((r) => {
          send("source", r.error ? { source: "arbeitnow", status: "error", message: r.error } : { source: "arbeitnow", status: "done", count: r.jobs.length });
          return r;
        }),
        fetchHimalayasJobs({ query, country: remote ? "" : country }).then((r) => {
          send("source", r.error ? { source: "himalayas", status: "error", message: r.error } : { source: "himalayas", status: "done", count: r.jobs.length });
          return r;
        }),
        (c.env.OPENWEBNINJA_API_KEY
          ? fetchJSearchJobs({ apiKey: c.env.OPENWEBNINJA_API_KEY, query, country: toJSearchCountryCode(country) })
          : Promise.resolve({ jobs: [], error: "not configured" })
        ).then((r) => {
          send("source", r.error ? { source: "jsearch", status: "error", message: r.error } : { source: "jsearch", status: "done", count: r.jobs.length });
          return r.error === "not configured" ? { jobs: [], error: null } : r;
        }),
      ]);

      const merged = dedupeJobs([...arbeitnowResult.jobs, ...himalayasResult.jobs, ...jsearchResult.jobs]);

      if (!merged.length) {
        send("complete", {
          text: "No open roles matched your location/remote preference right now -- try widening the search.",
          jobs: [],
        });
        controller.close();
        return;
      }

      // Cap before ranking -- merging 3 sources can return up to ~70+ raw
      // jobs (vs. the single-source ~40 cap this ranking prompt's token
      // budget was originally sized for). Asking the model to emit ranked
      // JSON with an added matchScore/fitNote per job for the full merged
      // set reliably blows the output budget: the JSON truncates mid-object
      // (fails to parse, silently falls back to the full unranked list) or
      // truncates before the closing fence entirely (the extraction regex
      // fails outright and the raw ```RANKED block leaks into the visible
      // summary text instead of being stripped). 30 keeps the prompt well
      // within budget while still showing a generous result set.
      const rankingCandidates = merged.slice(0, 30);

      // Rank the real, already-found listings against the candidate's CV --
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
        `\nJob postings found:\n${JSON.stringify(rankingCandidates, null, 2)}\n\n` +
        `Return two things:\n` +
        `1. A short markdown summary (2-4 sentences) of the overall fit of this batch.\n` +
        `2. A fenced block starting with \`\`\`RANKED and ending with \`\`\` containing ` +
        `a JSON array, same jobs, reordered best-fit-first, each with an added ` +
        `"matchScore" (integer 0-100) and "fitNote" (one sentence) field.`;

      let finalJobs = rankingCandidates;
      let finalText = "";
      let finalRankingError = null;

      try {
        const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 8000 });

        let rankedJobs = rankingCandidates;
        const rankedMatch = text.match(/```RANKED\n([\s\S]*?)\n```/);
        if (rankedMatch) {
          try {
            const parsed = JSON.parse(rankedMatch[1]);
            if (Array.isArray(parsed)) rankedJobs = parsed;
          } catch {
            // Fall through to the unranked (but still real) merged list.
          }
        }

        finalJobs = rankedJobs;
        finalText = text.replace(/```RANKED\n[\s\S]*?\n```/, "").trim();
      } catch (err) {
        finalRankingError = err.message;
      }

      // Geocode each job's location (deduplicated, cached) so the
      // frontend can render a map. Runs after ranking, on whichever job
      // list ends up final either way, so it never reaches the LLM's
      // own prompt/context and never needs duplicating across the
      // success/error branches above.
      const geocoded = await geocodeLocations(c.env.DB, finalJobs.map((j) => j.location));
      const jobsWithCoords = finalJobs.map((j) => {
        const coords = geocoded.get(normalizeQuery(j.location));
        return { ...j, lat: coords?.lat ?? null, lng: coords?.lng ?? null };
      });

      send(
        "complete",
        finalRankingError
          ? { text: "", jobs: jobsWithCoords, rankingError: finalRankingError }
          : { text: finalText, jobs: jobsWithCoords }
      );

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default router;
