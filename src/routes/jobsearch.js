import { Hono } from "hono";
import { runTask } from "../lib/llm.js";
import { fetchArbeitnowJobs } from "../lib/arbeitnow.js";
import { fetchHimalayasJobs } from "../lib/himalayas.js";
import { fetchJSearchJobs } from "../lib/jsearch.js";
import { fetchTavilyJobs } from "../lib/tavily.js";
import { dedupeJobs } from "../lib/jobdedup.js";
import { geocodeLocations, normalizeQuery } from "../lib/geocode.js";

const router = new Hono();

const SOURCES = ["arbeitnow", "himalayas", "jsearch", "tavily"];

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

/** Takes one job from each source in turn until every list is exhausted,
 * so a downstream cap trims each source evenly instead of dropping the
 * last ones entirely. Empty lists simply drop out. */
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

function toJSearchCountryCode(country) {
  const key = String(country || "").trim().toLowerCase();
  if (!key) return "us";
  if (COUNTRY_NAME_TO_CODE[key]) return COUNTRY_NAME_TO_CODE[key];
  if (/^[a-z]{2}$/.test(key)) return key;
  return "us";
}

router.post("/search", async (c) => {
  const { cvId, city, region, country, remote, minComp, notes, targetRole } = await c.req.json();

  const cv = await c.var.store.resolveCv(cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  // The keyword sent to the job boards. A literal "jobs" query returns
  // whatever the boards consider popular, not what fits this candidate --
  // the target-role field (persisted on the profile) is what makes the
  // source results relevant in the first place.
  const query = String(targetRole || "").trim() || "jobs";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      for (const source of SOURCES) send("source", { source, status: "searching" });

      const [arbeitnowResult, himalayasResult, jsearchResult, tavilyResult] = await Promise.all([
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
        (c.env.TAVILY_API_KEY
          ? fetchTavilyJobs({ apiKey: c.env.TAVILY_API_KEY, query, city, region, country, remote })
          : Promise.resolve({ jobs: [], error: "not configured" })
        ).then((r) => {
          send("source", r.error ? { source: "tavily", status: "error", message: r.error } : { source: "tavily", status: "done", count: r.jobs.length });
          return r.error === "not configured" ? { jobs: [], error: null } : r;
        }),
      ]);

      // Round-robin across sources rather than concatenating them, because
      // the 30-job cap below truncates whatever comes last. Concatenated,
      // Arbeitnow's ~29 results filled the cap on their own and every
      // Tavily posting -- the source that returns individual ATS listings
      // rather than board aggregates -- was silently discarded before
      // ranking ever saw it. Interleaving gives each source a fair share of
      // the budget and leaves dedupe to settle genuine overlaps.
      const merged = dedupeJobs(
        interleave([arbeitnowResult.jobs, himalayasResult.jobs, jsearchResult.jobs, tavilyResult.jobs])
      );

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

      // Real results are in hand within seconds -- show them NOW. Ranking
      // and geocoding each take tens of seconds and arrive as follow-up
      // events (`ranked`, `geo`) that upgrade the already-visible list,
      // instead of gating the first render behind the slowest stage.
      send("jobs", { jobs: rankingCandidates, total: merged.length });

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

      // Ranking (one slow LLM call) and geocoding (up to ~1s per uncached
      // location, Nominatim-mandated) are independent -- run them
      // concurrently and stream each result the moment it lands. Geocoding
      // keys by location string, not list order, so it doesn't need to wait
      // for the ranked order. Each settles with its own event so the UI can
      // upgrade in place; `complete` at the end carries the final combined
      // state for anything that missed the intermediate events.
      const rankingPromise = (async () => {
        try {
          const { text } = await runTask({ env: c.env, store: c.var.store, stable, prompt, maxTokens: 8000 });

          let rankedJobs = rankingCandidates;
          const rankedMatch = text.match(/```RANKED\n([\s\S]*?)\n```/);
          if (rankedMatch) {
            try {
              const parsed = JSON.parse(rankedMatch[1]);
              // The model rewrites every field when it re-emits the list, so
              // treat the whole array as untrusted: coerce matchScore to a
              // clamped integer (it lands in the DOM unescaped as a badge)
              // and force the text fields back to strings. A prompt-injected
              // job posting must not be able to smuggle markup or objects
              // through the ranked JSON.
              if (Array.isArray(parsed)) {
                rankedJobs = parsed.map((j) => {
                  const score = Number(j?.matchScore);
                  return {
                    ...j,
                    title: String(j?.title ?? ""),
                    company: String(j?.company ?? ""),
                    location: String(j?.location ?? ""),
                    url: String(j?.url ?? ""),
                    compEstimate: String(j?.compEstimate ?? ""),
                    fitNote: String(j?.fitNote ?? ""),
                    matchScore: Number.isFinite(score)
                      ? Math.max(0, Math.min(100, Math.round(score)))
                      : null,
                  };
                });
              }
            } catch {
              // Fall through to the unranked (but still real) merged list.
            }
          }

          finalJobs = rankedJobs;
          finalText = text.replace(/```RANKED\n[\s\S]*?\n```/, "").trim();
          send("ranked", { text: finalText, jobs: finalJobs });
        } catch (err) {
          finalRankingError = err.message;
          send("ranked", { rankingError: finalRankingError });
        }
      })();

      // Geocode each job's location (deduplicated, cached) so the frontend
      // can render a map. Capped at 10 uncached lookups per search so the
      // map never delays completion by more than ~10s -- jobs past the cap
      // simply don't get a pin this time (they'll hit the cache on a later
      // search).
      const geocodePromise = (async () => {
        const geocoded = await geocodeLocations(c.env.DB, rankingCandidates.map((j) => j.location), { maxUncached: 10 });
        const coords = {};
        for (const [key, value] of geocoded) {
          if (value) coords[key] = value;
        }
        send("geo", { coords });
        return geocoded;
      })();

      const [geocoded] = await Promise.all([geocodePromise, rankingPromise]);

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
