import { Hono } from "hono";
import * as db from "../lib/db.js";
import { runTask } from "../lib/llm.js";
import { fetchArbeitnowJobs } from "../lib/arbeitnow.js";
import { fetchHimalayasJobs } from "../lib/himalayas.js";
import { fetchJSearchJobs } from "../lib/jsearch.js";
import { dedupeJobs } from "../lib/jobdedup.js";

const router = new Hono();

const SOURCES = ["arbeitnow", "himalayas", "jsearch"];

router.post("/search", async (c) => {
  const { cvId, city, region, country, remote, minComp, notes } = await c.req.json();

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const query = ["software", notes].filter(Boolean).join(" ").trim() || "jobs";
  const countryCode = country || "us";

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
        fetchJSearchJobs({ apiKey: c.env.OPENWEBNINJA_API_KEY, query, country: countryCode }).then((r) => {
          send("source", r.error ? { source: "jsearch", status: "error", message: r.error } : { source: "jsearch", status: "done", count: r.jobs.length });
          return r;
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
        `\nJob postings found:\n${JSON.stringify(merged, null, 2)}\n\n` +
        `Return two things:\n` +
        `1. A short markdown summary (2-4 sentences) of the overall fit of this batch.\n` +
        `2. A fenced block starting with \`\`\`RANKED and ending with \`\`\` containing ` +
        `a JSON array, same jobs, reordered best-fit-first, each with an added ` +
        `"matchScore" (integer 0-100) and "fitNote" (one sentence) field.`;

      try {
        const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 4000 });

        let rankedJobs = merged;
        const rankedMatch = text.match(/```RANKED\n([\s\S]*?)\n```/);
        if (rankedMatch) {
          try {
            const parsed = JSON.parse(rankedMatch[1]);
            if (Array.isArray(parsed)) rankedJobs = parsed;
          } catch {
            // Fall through to the unranked (but still real) merged list.
          }
        }

        const summary = text.replace(/```RANKED\n[\s\S]*?\n```/, "").trim();
        send("complete", { text: summary, jobs: rankedJobs });
      } catch (err) {
        send("complete", { text: "", jobs: merged, rankingError: err.message });
      }

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
