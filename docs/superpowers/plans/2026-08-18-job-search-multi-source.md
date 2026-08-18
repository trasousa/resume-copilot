# Job Search: Multi-Source Streaming Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Himalayas and OpenWebNinja JSearch as job sources alongside Arbeitnow, stream per-source search progress to the frontend via SSE, and deduplicate postings that appear in more than one source.

**Architecture:** Three independent `fetchXJobs()` client modules (Arbeitnow already exists; Himalayas and JSearch are new) run concurrently from a rewritten `/api/jobsearch/search` route, which now streams SSE progress events (one per source, as each resolves) instead of returning one buffered JSON response. Once all three settle, a pure `dedupeJobs()` function merges/deduplicates the results, the existing Workers-AI ranking prompt runs over the deduped set, and a final `complete` SSE event carries the ranked list. The frontend consumes this the same way `public/js/cv-store.js` already consumes the CV-chat SSE stream (fetch + `ReadableStream` reader + `event:`/`data:` frame parsing) — reuse that exact pattern, don't reinvent it.

**Tech Stack:** Hono, Cloudflare Workers (D1, R2, Durable Objects — unchanged), Workers AI, vanilla ES modules, hand-written CSS, no build step, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-job-search-multi-source-design.md` — its Goals/Non-goals/Sources/Streaming architecture/Deduplication sections are the authority this plan implements. Also binding: `docs/superpowers/specs/2026-08-16-resume-agent-core-design.md`'s "Model choice" paragraph (Workers AI only — this plan adds plain data-source `fetch()` calls, never a second LLM provider).

## Global Constraints

- No new npm dependencies — every source client is a plain `fetch()` call, same as `src/lib/arbeitnow.js`.
- `OPENWEBNINJA_API_KEY` is a real secret: `wrangler secret put` for production, `.dev.vars` (gitignored) for local dev — **never** in `wrangler.jsonc`'s `vars` block, never committed to any file.
- OpenWebNinja JSearch free tier is 200 requests/month — the route must make **at most one** JSearch call per user-initiated search (no pagination loop, no retry-on-empty).
- This project has no automated test runner (`package.json` has no `test` script) — every task's verification step is a manual/live check (`npm run lint` + a real API call or `npm run dev` click-through), matching how `src/lib/arbeitnow.js` and every prior task in this project's history was verified. Do not add a test framework as a side effect of this plan.
- Every source client function must never throw — always return `{jobs: [], error: string|null}`, exactly `arbeitnow.js`'s existing contract, so one source failing never breaks the others.
- SSE framing must match `src/lib/workersai.js`'s `runChatStream` / `public/js/cv-store.js`'s `sendChat` exactly: `event: <name>\ndata: <JSON>\n\n` on the wire, frames split on `\n\n`, `event:`/`data:` lines extracted with the same regex shape already used there.

---

### Task 1: Himalayas job source client

**Files:**
- Create: `src/lib/himalayas.js`

**Interfaces:**
- Produces: `fetchHimalayasJobs({ query, country }) -> Promise<{ jobs: Array<{title: string, company: string, location: string, url: string, compEstimate: string, source: "himalayas"}>, error: string|null }>`

**Verified live response shape** (confirmed during design via `curl "https://himalayas.app/jobs/api/search?q=software%20engineer&country=US&page=1"`, no key needed):
```json
{
  "totalCount": 407,
  "jobs": [
    {
      "title": "Software Engineer",
      "companyName": "Corbalt",
      "minSalary": 126594,
      "maxSalary": 166412,
      "salaryPeriod": "annual",
      "currency": "USD",
      "locationRestrictions": ["United States"],
      "applicationLink": "https://himalayas.app/companies/corbalt/jobs/software-engineer",
      "guid": "https://himalayas.app/companies/corbalt/jobs/software-engineer"
    }
  ]
}
```
`minSalary`/`maxSalary`/`salaryPeriod`/`currency` are sometimes absent (job didn't disclose salary) — never assume presence. `locationRestrictions` is an array of country/region names (Himalayas is remote-only, so this is never a specific city) or absent for fully-open roles.

- [ ] **Step 1: Write the client**

```js
// src/lib/himalayas.js
//
// Calls Himalayas's public job board search API -- free, no signup, no
// API key. GET https://himalayas.app/jobs/api/search?q=<keyword>&country=<name>
// returns real, structured remote-job postings with salary data when
// disclosed. Himalayas lists remote roles only (no on-site postings), which
// pairs with Arbeitnow's on-site-heavy coverage rather than overlapping it.

const BASE_URL = "https://himalayas.app/jobs/api/search";

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return "";
  const period = job.salaryPeriod ? `/${job.salaryPeriod}` : "";
  const currency = job.currency || "";
  if (job.minSalary && job.maxSalary) {
    return `${currency} ${job.minSalary}-${job.maxSalary}${period}`.trim();
  }
  return `${currency} ${job.minSalary || job.maxSalary}${period}`.trim();
}

export async function fetchHimalayasJobs({ query, country }) {
  const params = new URLSearchParams({ q: query || "", page: "1" });
  if (country) params.set("country", country);

  let res;
  try {
    res = await fetch(`${BASE_URL}?${params}`, {
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { jobs: [], error: `Himalayas search request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `Himalayas search returned ${res.status}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { jobs: [], error: "Himalayas search returned an unreadable response." };
  }

  const items = Array.isArray(body?.jobs) ? body.jobs : [];
  const jobs = items
    .filter((item) => item?.applicationLink && item?.title)
    .slice(0, 40)
    .map((item) => ({
      title: String(item.title),
      company: String(item.companyName || ""),
      location: Array.isArray(item.locationRestrictions) && item.locationRestrictions.length
        ? item.locationRestrictions.join(", ")
        : "Remote",
      url: String(item.applicationLink),
      compEstimate: formatSalary(item),
      source: "himalayas",
    }))
    .filter((job) => job.company);

  return { jobs, error: null };
}
```

- [ ] **Step 2: Verify against the live API**

Run this from the repo root (delete the temp file afterward, it's scratch-only):

```bash
cat > /tmp/verify-himalayas.mjs << 'EOF'
globalThis.AbortSignal.timeout ??= (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
const { fetchHimalayasJobs } = await import(process.cwd() + "/src/lib/himalayas.js");
const r = await fetchHimalayasJobs({ query: "software engineer", country: "United States" });
console.log("jobs:", r.jobs.length, "error:", r.error);
console.log(r.jobs[0]);
EOF
node /tmp/verify-himalayas.mjs
rm /tmp/verify-himalayas.mjs
```

Expected: `jobs: <a positive number>`, `error: null`, and the first job has a non-empty `title`, `company`, `url` starting with `https://himalayas.app/`, and `source: "himalayas"`.

- [ ] **Step 3: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/himalayas.js
git commit -m "feat: add Himalayas as a second job search source (global remote, real search)"
```

---

### Task 2: OpenWebNinja JSearch client + secret documentation

**Files:**
- Create: `src/lib/jsearch.js`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: `fetchJSearchJobs({ apiKey, query, country }) -> Promise<{ jobs: Array<{title: string, company: string, location: string, url: string, compEstimate: string, source: "jsearch"}>, error: string|null }>`

**Verified live response shape** (confirmed during design via `curl -G "https://api.openwebninja.com/jsearch/search-v2" --data-urlencode "query=software engineer" --data-urlencode "country=de" -H "X-API-Key: ..."` — this call already happened during planning; do not repeat it, the quota is 200/month):
```json
{
  "status": "OK",
  "data": {
    "jobs": [
      {
        "job_title": "Software Developer (w/m/d)",
        "employer_name": "Brunel GmbH NL Ingolstadt",
        "job_apply_link": "https://www.arbeitsagentur.de/jobsuche/jobdetail/...",
        "job_is_remote": false,
        "job_location": "Ingolstadt     •  über Arbeitsagentur",
        "job_city": null,
        "job_state": null,
        "job_country": null,
        "job_min_salary": null,
        "job_max_salary": null,
        "job_salary_period": null,
        "job_salary_string": null
      }
    ],
    "cursor": "..."
  }
}
```
`job_city`/`job_state`/`job_country` are frequently `null` even when `job_location` has a real value — always fall back to `job_location`. The default `country` search parameter is `"us"` if omitted (confirmed empirically: an unscoped Berlin-keyword query returned zero results until `country=de` was passed explicitly) — **always pass an explicit `country`** derived from the request, never rely on the API's default.

- [ ] **Step 1: Write the client**

```js
// src/lib/jsearch.js
//
// Calls OpenWebNinja's JSearch API -- aggregates LinkedIn, Indeed,
// Glassdoor, ZipRecruiter, and other public boards via Google for Jobs.
// Structured JSON, no scraping, no proxy. Free tier: 200 requests/month,
// 1,000 req/hour -- this module must be called at most once per user
// search (no pagination, no retry-on-empty) to respect that budget.
//
// The API's `country` parameter defaults to "us" when omitted (confirmed
// empirically -- an unscoped non-US query returns zero results), so an
// explicit country is always passed here rather than relying on the
// default.

const BASE_URL = "https://api.openwebninja.com/jsearch/search-v2";

function formatSalary(job) {
  if (job.job_salary_string) return String(job.job_salary_string);
  if (!job.job_min_salary && !job.job_max_salary) return "";
  const period = job.job_salary_period ? `/${job.job_salary_period}` : "";
  if (job.job_min_salary && job.job_max_salary) {
    return `${job.job_min_salary}-${job.job_max_salary}${period}`;
  }
  return `${job.job_min_salary || job.job_max_salary}${period}`;
}

export async function fetchJSearchJobs({ apiKey, query, country }) {
  if (!apiKey) return { jobs: [], error: null }; // Not configured -- silently skip, not an error state.

  const params = new URLSearchParams({ query: query || "", country: country || "us" });

  let res;
  try {
    res = await fetch(`${BASE_URL}?${params}`, {
      headers: { "X-API-Key": apiKey },
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { jobs: [], error: `JSearch request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `JSearch returned ${res.status}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { jobs: [], error: "JSearch returned an unreadable response." };
  }

  const items = Array.isArray(body?.data?.jobs) ? body.data.jobs : [];
  const jobs = items
    .filter((item) => item?.job_apply_link && item?.job_title)
    .slice(0, 40)
    .map((item) => ({
      title: String(item.job_title),
      company: String(item.employer_name || ""),
      location: String(
        item.job_location || (item.job_is_remote ? "Remote" : [item.job_city, item.job_state, item.job_country].filter(Boolean).join(", "))
      ).trim(),
      url: String(item.job_apply_link),
      compEstimate: formatSalary(item),
      source: "jsearch",
    }))
    .filter((job) => job.company);

  return { jobs, error: null };
}
```

- [ ] **Step 2: Lint (do NOT make a live JSearch call in this task — quota is 200/month and Task 1's design-time call already validated the response shape above)**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 3: Document the secret in `.env.example`**

Find the `## Optional overrides` block in `.env.example` (or wherever `WORKERS_AI_CHAT_MODEL` currently ends) and append:

```bash

# Optional -- enables the JSearch job source (LinkedIn/Indeed/Glassdoor/
# ZipRecruiter via Google for Jobs). Free tier: 200 requests/month. Get a
# key at https://www.openwebninja.com. This is a real secret -- never put
# the actual value in wrangler.jsonc; use `npx wrangler secret put
# OPENWEBNINJA_API_KEY` for production, and set it here only for local dev
# (.env.example itself is never a real secret's home -- copy this file to
# .dev.vars, which is gitignored, and put the real key there).
OPENWEBNINJA_API_KEY=
```

- [ ] **Step 4: Update README's "Job search" section**

Find the `## Job search` section (added in a prior task, describing Arbeitnow). Replace its body with:

```markdown
Job Search combines three free sources, run concurrently:

- **[Arbeitnow](https://www.arbeitnow.com)** (`src/lib/arbeitnow.js`) -- free, no key. Germany/UK-heavy on-site + some remote postings, aggregated from Greenhouse/SmartRecruiters/etc, updated hourly. No server-side search, so city/region/country/remote filtering happens in-app after fetching.
- **[Himalayas](https://himalayas.app)** (`src/lib/himalayas.js`) -- free, no key. Global remote-only postings with real keyword+country search and salary data when disclosed.
- **[OpenWebNinja JSearch](https://www.openwebninja.com)** (`src/lib/jsearch.js`) -- optional, needs `OPENWEBNINJA_API_KEY`. Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, and other public boards via Google for Jobs. **Free tier is 200 requests/month** -- each user-initiated search costs exactly one JSearch request, so budget accordingly. Job Search works fine without this key set; you just lose that source's results.

Results from all three are deduplicated (`src/lib/jobdedup.js`, matched by normalized company + title + location/remote) before Workers AI ranks the merged list against your CV. Search progress streams to the page as each source resolves, rather than waiting for all three before showing anything.
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jsearch.js .env.example README.md
git commit -m "feat: add OpenWebNinja JSearch as a third job source (LinkedIn/Indeed/Glassdoor/ZipRecruiter)"
```

---

### Task 3: Deduplication module

**Files:**
- Create: `src/lib/jobdedup.js`

**Interfaces:**
- Consumes: job objects shaped `{title, company, location, url, compEstimate, source}` as produced by `fetchArbeitnowJobs` (Task-independent, already exists), `fetchHimalayasJobs` (Task 1), `fetchJSearchJobs` (Task 2).
- Produces: `dedupeJobs(jobs: Array<Job>) -> Array<Job>`, same shape, deduplicated, with `compEstimate` backfilled from a lower-trust duplicate when the kept record's own `compEstimate` is empty.

- [ ] **Step 1: Write the module**

```js
// src/lib/jobdedup.js
//
// Merges job postings from multiple sources, collapsing duplicates that
// the same underlying opening produces across Arbeitnow/Himalayas/JSearch
// (each source assigns its own URL to the same real job, so URL matching
// alone isn't enough -- dedup instead on normalized company+title+location).
//
// Source-trust order when two jobs collide: jsearch > himalayas >
// arbeitnow. JSearch and Himalayas return more structured/complete data;
// Arbeitnow's freeform location strings are the least reliable to match
// on, so it loses ties. The kept record is backfilled with any field
// (currently just compEstimate) that a lower-trust duplicate has and it
// doesn't, rather than discarding that data.

const SOURCE_RANK = { jsearch: 0, himalayas: 1, arbeitnow: 2 };
const LEGAL_SUFFIXES = /\b(inc|llc|ltd|gmbh|corp|co)\b\.?/gi;

function normalizeCompany(company) {
  return String(company || "")
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function locationBucket(job) {
  const loc = String(job.location || "").toLowerCase();
  if (loc.includes("remote")) return "remote";
  return loc.split(",")[0].trim();
}

function dedupeKey(job) {
  return `${normalizeCompany(job.company)}|${normalizeTitle(job.title)}|${locationBucket(job)}`;
}

export function dedupeJobs(jobs) {
  const byKey = new Map();

  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, job);
      continue;
    }

    const existingRank = SOURCE_RANK[existing.source] ?? 99;
    const candidateRank = SOURCE_RANK[job.source] ?? 99;
    const winner = candidateRank < existingRank ? job : existing;
    const loser = winner === job ? existing : job;

    byKey.set(key, {
      ...winner,
      compEstimate: winner.compEstimate || loser.compEstimate || "",
    });
  }

  return [...byKey.values()];
}
```

- [ ] **Step 2: Verify with a manual script**

```bash
cat > /tmp/verify-dedup.mjs << 'EOF'
const { dedupeJobs } = await import(process.cwd() + "/src/lib/jobdedup.js");

const jobs = [
  { title: "Software Engineer", company: "Stripe Inc.", location: "Berlin", url: "https://a.example/1", compEstimate: "", source: "arbeitnow" },
  { title: "software engineer", company: "Stripe", location: "Berlin, Germany", url: "https://b.example/2", compEstimate: "€80,000-100,000", source: "jsearch" },
  { title: "Backend Engineer", company: "Wolt", location: "Remote", url: "https://c.example/3", compEstimate: "", source: "himalayas" },
];

const result = dedupeJobs(jobs);
console.log("input:", jobs.length, "output:", result.length);
console.log(JSON.stringify(result, null, 2));

if (result.length !== 2) throw new Error(`expected 2 deduped jobs, got ${result.length}`);
const stripe = result.find((j) => j.company === "Stripe");
if (!stripe) throw new Error("expected the jsearch-sourced Stripe record to win");
if (stripe.compEstimate !== "€80,000-100,000") throw new Error("expected compEstimate to be preserved from the winning jsearch record");
console.log("PASS");
EOF
node /tmp/verify-dedup.mjs
rm /tmp/verify-dedup.mjs
```

Expected: `input: 3 output: 2`, ending with `PASS`. The two Stripe/Berlin entries collapse into one (the `jsearch` one wins since it outranks `arbeitnow`), the Wolt/Remote entry stays separate.

- [ ] **Step 3: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobdedup.js
git commit -m "feat: add cross-source job deduplication"
```

---

### Task 4: Streaming search route

**Files:**
- Modify: `src/routes/jobsearch.js`

**Interfaces:**
- Consumes: `fetchArbeitnowJobs({remote, city, region, country})` (existing), `fetchHimalayasJobs({query, country})` (Task 1), `fetchJSearchJobs({apiKey, query, country})` (Task 2), `dedupeJobs(jobs)` (Task 3), `runTask({env, stable, prompt, maxTokens})` from `../lib/llm.js` (existing, unchanged signature).
- Produces: `POST /api/jobsearch/search` now returns `Content-Type: text/event-stream` instead of JSON. Event contract (exact wire format, matching `runChatStream`'s framing):
  - `event: source\ndata: {"source":"arbeitnow"|"himalayas"|"jsearch","status":"searching"}\n\n` — emitted once per source, immediately.
  - `event: source\ndata: {"source":"...","status":"done","count":<n>}\n\n` or `event: source\ndata: {"source":"...","status":"error","message":"<reason>"}\n\n` — emitted once per source, when that source's fetch settles.
  - `event: complete\ndata: {"jobs":[...ranked, deduped jobs...],"text":"<summary>"}\n\n` — emitted once, after all sources have settled and ranking has run. Closes the stream.

- [ ] **Step 1: Read the current file for the ranking prompt to preserve**

The existing `src/routes/jobsearch.js` (from the Arbeitnow-only version) has a `stable`/`prompt` pair for CV-fit ranking and a `runTask` call — that logic is unchanged by this task, only its input (now a deduped, multi-source list instead of Arbeitnow-only) and how the response is delivered (streamed, not buffered) change.

- [ ] **Step 2: Rewrite the route**

Replace the entire contents of `src/routes/jobsearch.js` with:

```js
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
        fetchHimalayasJobs({ query, country: remote ? "" : (city || region || country) }).then((r) => {
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
```

- [ ] **Step 3: Verify locally**

Run: `npm run dev`. In another terminal, with `SKIP_AUTH=1` already set in `.dev.vars` (it already is), run:

```bash
curl -N -X POST http://localhost:8787/api/jobsearch/search \
  -H "Content-Type: application/json" \
  -d '{"cvId":"<a real CV id from your local DB>","city":"Berlin","remote":false}'
```

Expected: a stream of `event: source` frames (one `searching` then one `done`/`error` per source: arbeitnow, himalayas, jsearch), followed by one `event: complete` frame with a `jobs` array and `text` summary. If you don't have a CV id handy, check `GET http://localhost:8787/api/cvs` first, or use `npm run dev` and the actual Job Search page instead (Task 5 wires up the frontend to make this trivial).

- [ ] **Step 4: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/jobsearch.js
git commit -m "feat: stream multi-source job search progress via SSE, dedupe before ranking"
```

---

### Task 5: Frontend streaming consumption + per-source progress UI

**Files:**
- Modify: `public/js/job-search.js`
- Modify: `public/job-search.html`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: the SSE event contract from Task 4 (`source`/`complete` events as specified there).

- [ ] **Step 1: Add a progress-rows container to the page**

In `public/job-search.html`, find:
```html
    <div id="result"></div>
```
Replace with:
```html
    <div id="searchProgress" class="search-progress"></div>
    <div id="result"></div>
```

- [ ] **Step 2: Style the progress rows**

Append to `public/css/styles.css`:
```css
.search-progress { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.search-progress:empty { display: none; }
.source-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--bg); font-size: 13px; color: var(--ink-soft); }
.source-row.done { color: var(--ink); }
.source-row.error { color: var(--warn); }
```

- [ ] **Step 3: Rewrite the search handler to consume SSE**

In `public/js/job-search.js`, find:
```js
document.getElementById("searchBtn").onclick = async () => {
  const cvId = cvSelect.value;
  if (!cvId) return alert("Add a CV first (CV Store tab).");
  const remote = document.getElementById("remote").checked;
  const city = document.getElementById("city").value.trim();
  const region = document.getElementById("region").value.trim();
  const country = document.getElementById("country").value.trim();
  if (!remote && !city && !region && !country) return alert("Enter a location, or check 'remote'.");

  statusEl.innerHTML = `<span class="spinner"></span> searching open roles — this can take a bit…`;
  resultEl.innerHTML = "";
  try {
    const data = await api("/jobsearch/search", {
      method: "POST",
      body: {
        cvId,
        city,
        region,
        country,
        remote,
        minComp: document.getElementById("minComp").value.trim(),
        notes: [document.getElementById("notes").value.trim(), selectedJobTypes().length ? `Job type preference: ${selectedJobTypes().join(", ")}` : ""].filter(Boolean).join(". "),
      },
    });
    saveProfileFromForm();
    render(data, cvId);
  } catch (err) {
    showError(main, err);
  } finally {
    statusEl.textContent = "";
  }
};
```
Replace with:
```js
const SOURCE_LABELS = { arbeitnow: "Arbeitnow", himalayas: "Himalayas", jsearch: "LinkedIn/Indeed/Glassdoor" };
const progressEl = document.getElementById("searchProgress");

function renderProgressRow(source, status, extra) {
  let row = progressEl.querySelector(`[data-source="${source}"]`);
  if (!row) {
    row = document.createElement("span");
    row.className = "source-row";
    row.dataset.source = source;
    progressEl.appendChild(row);
  }
  row.className = `source-row ${status}`;
  const label = SOURCE_LABELS[source] || source;
  if (status === "searching") row.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`;
  else if (status === "done") row.textContent = `${label}: ${extra} found`;
  else row.textContent = `${label}: unavailable`;
}

document.getElementById("searchBtn").onclick = async () => {
  const cvId = cvSelect.value;
  if (!cvId) return alert("Add a CV first (CV Store tab).");
  const remote = document.getElementById("remote").checked;
  const city = document.getElementById("city").value.trim();
  const region = document.getElementById("region").value.trim();
  const country = document.getElementById("country").value.trim();
  if (!remote && !city && !region && !country) return alert("Enter a location, or check 'remote'.");

  statusEl.textContent = "";
  progressEl.innerHTML = "";
  resultEl.innerHTML = "";

  try {
    const res = await fetch("/api/jobsearch/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cvId,
        city,
        region,
        country,
        remote,
        minComp: document.getElementById("minComp").value.trim(),
        notes: [document.getElementById("notes").value.trim(), selectedJobTypes().length ? `Job type preference: ${selectedJobTypes().join(", ")}` : ""].filter(Boolean).join(". "),
      }),
    });

    if (!res.ok) {
      let error;
      try {
        error = (await res.json()).error;
      } catch {
        if (res.status === 401) error = "Your session expired. Reload the page to sign in again.";
      }
      throw new Error(error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData = null;

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const dataLine = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !dataLine) continue;

        const data = JSON.parse(dataLine);
        if (event === "source") {
          renderProgressRow(data.source, data.status, data.status === "done" ? data.count : data.message);
        } else if (event === "complete") {
          finalData = data;
        }
      }
    }

    saveProfileFromForm();
    if (finalData) render(finalData, cvId);
  } catch (err) {
    showError(main, err);
  }
};
```

- [ ] **Step 4: Update the `atsError`/`searchError` banner reference to match the new final-event shape**

Find:
```js
    ${data.searchError ? `<div class="error-banner" style="background:var(--warn-soft); color:var(--warn);">Job search failed this time (${escapeHtml(data.searchError)}).</div>` : ""}
```
Replace with:
```js
    ${data.rankingError ? `<div class="error-banner" style="background:var(--warn-soft); color:var(--warn);">Ranking failed this time (${escapeHtml(data.rankingError)}); showing unranked results.</div>` : ""}
```
(The per-source errors are now shown live in the progress rows, not in this banner — this banner is only for the ranking step itself failing.)

- [ ] **Step 5: Update the page subtitle**

In `public/job-search.html`, find:
```html
    <p class="subtitle">Live openings from Arbeitnow's job board, matched against your resume and ranked by fit + estimated compensation.</p>
```
Replace with:
```html
    <p class="subtitle">Live openings from Arbeitnow, Himalayas, and LinkedIn/Indeed/Glassdoor (via JSearch), matched against your resume and ranked by fit + estimated compensation.</p>
```

- [ ] **Step 6: Verify with a real browser session**

Run: `npm run dev`. Open the Job Search page, run a search. Expected: progress rows for all three sources appear immediately as "searching…", each updates independently to "N found" or "unavailable" as that source resolves (they should NOT all update at the same instant — Arbeitnow and Himalayas typically resolve faster than JSearch), and the results grid renders once, after the final `complete` event, with no visible duplicate postings (same company+title+city appearing twice). Confirm the JSearch progress row shows "unavailable" gracefully if `OPENWEBNINJA_API_KEY` isn't set in your `.dev.vars` — the page must not break) if that key is unset. Note: if `OPENWEBNINJA_API_KEY` IS set in `.dev.vars`, this manual test consumes one unit of the 200/month quota — worth doing once to confirm the wiring, not repeatedly.

- [ ] **Step 7: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add public/js/job-search.js public/job-search.html public/css/styles.css
git commit -m "feat: stream per-source job search progress in the UI"
```

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** all three spec sections (Sources, Streaming architecture, Deduplication, Route changes, Frontend changes, Error handling, Secret handling) map onto Tasks 1-5 above; the spec's "Open questions" (exact JSearch/Himalayas field names) were resolved during plan authorship via live verification calls, not left open in this plan.
- **Type consistency:** `{title, company, location, url, compEstimate, source}` is the one job shape used identically by `arbeitnow.js` (existing), `himalayas.js` (Task 1), `jsearch.js` (Task 2), `jobdedup.js` (Task 3), and the route (Task 4) — verified no field-name drift across tasks.
- **Non-goals honored:** no JobSpy, no Containers, no new LLM provider, no web-search-agent fourth source anywhere in this plan.
