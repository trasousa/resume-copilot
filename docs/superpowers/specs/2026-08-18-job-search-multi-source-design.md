# Job Search: Multi-Source Streaming Search — Design

**Status:** Approved by user in conversation on 2026-08-18. Ready for `superpowers:writing-plans`.

**Context:** resume-copilot's Job Search page currently has one source, Arbeitnow's free public job board API (`src/lib/arbeitnow.js`), added after an earlier session found Apify's paid ATS scraper too expensive and too manually-curated (a hardcoded/env-configured company watchlist). Arbeitnow works but is Germany/UK-heavy — real coverage of the US and of "conventional" boards (LinkedIn, Indeed, Glassdoor, ZipRecruiter) is thin to nonexistent. This design adds two more sources to close that gap, restructures the search endpoint to stream results as each source resolves instead of waiting for all of them, and adds cross-source deduplication.

A companion research trail (hands-on benchmarking, not just desk research) is in this session's history: JobSpy was actually installed and run against live sites — only Indeed and LinkedIn worked without a paid proxy (Glassdoor/Bayt/Naukri/ZipRecruiter all hard-failed with 4xx errors, confirmed on the latest JobSpy release, not just an old one). That result is superseded by this design's choice of OpenWebNinja's JSearch API, which structurally covers the same boards (via Google for Jobs aggregation) with no scraping, no proxy, and no hosting required — so JobSpy and Cloudflare Containers are explicitly **out of scope**, not deferred.

## Goals

- Add two new job sources: **Himalayas** (global remote jobs, real keyword+country search, salary data) and **OpenWebNinja JSearch** (LinkedIn/Indeed/Glassdoor/ZipRecruiter via Google for Jobs aggregation, structured JSON).
- Stream search progress to the frontend as each source resolves, instead of one opaque "searching…" spinner until everything finishes.
- Deduplicate job postings that appear in more than one source.
- Keep the existing Workers-AI CV-fit ranking step, now running over the deduplicated, merged set.

## Non-goals

- JobSpy / self-hosted scraping of any kind — ruled out by this session's own benchmarking (2 of 8 sites reachable without a paid proxy) in favor of JSearch, which gets equivalent-or-better board coverage with none of the hosting/proxy/ToS cost.
- A general "AI agent that searches the web" fourth source — explicitly dropped by the user during design (see conversation on 2026-08-18); may be revisited later as a separate design.
- Cloudflare Containers, the Workers Paid plan, or any new hosted infrastructure — not needed once JobSpy is out of scope.
- Any change to the existing Workers-AI-only LLM provider architecture (`docs/superpowers/specs/2026-08-16-resume-agent-core-design.md`'s "Model choice" paragraph remains binding — this design adds plain data-source API calls, not a second LLM provider).

## Sources

### 1. Arbeitnow (existing, unchanged)
`src/lib/arbeitnow.js`, `fetchArbeitnowJobs({remote, city, region, country})`. No secret. Already in production.

### 2. Himalayas (new)
Free public JSON API, no signup, no key. Search endpoint: `GET https://himalayas.app/jobs/api/search?q=<keyword>&country=<ISO alpha-2 or name>&page=<n>`. Verified live during design (`q=software engineer&country=US` → 407 real results, salary populated, real apply links). Remote-only jobs — pairs with Arbeitnow's on-site-heavy coverage rather than overlapping it.

New file `src/lib/himalayas.js`:
- `fetchHimalayasJobs({ query, country }) -> Promise<{ jobs: Array<{title, company, location, url, compEstimate, source: "himalayas"}>, error: string|null }>`
- `query` derives from the search form's existing "notes"/role context (see Task breakdown for exact mapping — this is a plan-time detail, not fixed here).
- `country` derives from the existing `country` form field, converted to ISO alpha-2 if the API requires it (verify exact accepted format when implementing — the design confirms the endpoint and shape, not every parameter's exact encoding).
- `compEstimate` populated from `minSalary`/`maxSalary`/`salaryPeriod`/`currency` when present (Himalayas returns these; Arbeitnow/JSearch may not always).
- Never throws; same `{jobs: [], error: "<reason>"}` contract as `arbeitnow.js` on failure, `{jobs: [], error: null}` for zero-results.

### 3. OpenWebNinja JSearch (new)
`GET https://api.openwebninja.com/jsearch/search-v2?query=<free text>` with header `X-API-Key: <OPENWEBNINJA_API_KEY>`. Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, and other public boards via Google for Jobs. Free tier: 200 requests/month, 1,000 req/hour. **This is a hard monthly budget** — the route must make at most one JSearch call per search request (no pagination loop), and the frontend/README should note the cap so the user doesn't burn through it accidentally.

New file `src/lib/jsearch.js`:
- `fetchJSearchJobs({ apiKey, query }) -> Promise<{ jobs: Array<{title, company, location, url, compEstimate, source: "jsearch"}>, error: string|null }>`
- `query` is a single free-text string built from title/location/remote preference (e.g. `"software engineer in Berlin"` or `"remote python developer"`), matching the API's example usage.
- Maps response fields: `job_title`→title, `employer_name`→company, `job_city`/`job_country`/remote flag→location, `job_apply_link`→url, `job_min_salary`/`job_max_salary`→compEstimate when present. Exact field names must be confirmed against a live response during implementation (the design's earlier doc-fetch summarized fields at a high level; the plan's implementer must verify exact JSON keys with a real API call before writing the mapper).
- Missing/invalid `apiKey` → `{jobs: [], error: null}` (not-configured, same graceful-skip pattern as the old Apify client), not a hard error — this keeps the app functional if the key is ever unset.

**Secret handling:** `OPENWEBNINJA_API_KEY` is a real credential (unlike this app's existing `CF_ACCESS_*` vars, which are identifiers, not secrets — this will be the app's **first** real secret). Store via `npx wrangler secret put OPENWEBNINJA_API_KEY` for production and `OPENWEBNINJA_API_KEY=...` in `.dev.vars` (gitignored) for local dev. Never in `wrangler.jsonc`'s `vars` block, never committed. Document this distinction in README's secrets section, since every existing documented var in this app so far has been non-secret.

## Streaming architecture

`POST /api/jobsearch/search` changes from a single buffered JSON response to a **Server-Sent Events stream**, reusing the same streaming primitive already used by the CV-improve chat (`src/lib/workersai.js`'s `runChatStream` / the existing SSE plumbing in `src/routes/cvs.js`'s chat route — the plan should point the implementer at that existing code as the pattern to follow, not reinvent SSE framing).

Event sequence per request:
1. For each of the 3 sources, immediately emit `{type: "source", source: "<name>", status: "searching"}`.
2. Kick off all 3 source fetches concurrently (`Promise.allSettled` — one source's rejection/error must never block or delay the others).
3. As each source's promise settles, emit `{type: "source", source: "<name>", status: "done", count: <n>}` or `{type: "source", source: "<name>", status: "error", message: "<reason>"}`.
4. Once all 3 have settled (or a bounded per-source timeout trips — reuse the same `AbortSignal.timeout` pattern `arbeitnow.js` already uses), merge all returned jobs, run dedup (below), then run the existing Workers-AI CV-fit ranking prompt over the deduped set.
5. Emit a final `{type: "complete", jobs: [...ranked, deduped jobs...], text: "<summary>"}` event and close the stream.

If a source's fetch is slow, the frontend shows that source's row as still "searching" while others complete — this is the actual point of streaming (visible partial progress), not just a UX polish detail.

## Deduplication

Pure function in a new file `src/lib/jobdedup.js`:

- `dedupeJobs(jobs) -> Array<Job>` where `jobs` is the flat merged array from all sources (each already tagged with its `source` field).
- Dedup key: `normalizeCompany(job.company) + "|" + normalizeTitle(job.title) + "|" + locationBucket(job)`.
  - `normalizeCompany`: lowercase, trim, strip common legal suffixes (`inc`, `llc`, `ltd`, `gmbh`, `corp`, `co`) and punctuation.
  - `normalizeTitle`: lowercase, trim, collapse whitespace.
  - `locationBucket`: `"remote"` if the job is remote, otherwise the lowercased city (falling back to region/country if city is absent).
- Source-trust order when two jobs share a key: **JSearch > Himalayas > Arbeitnow** (JSearch and Himalayas return more structured/complete data; Arbeitnow's freeform location strings are the least reliable to match on, so it loses ties). The kept record is the highest-trust one present; any field the kept record is missing (most commonly `compEstimate`) gets backfilled from a lower-trust duplicate that has it, rather than discarding that data.
- This is pure, input→output logic with no I/O — the plan should call out that it's a natural candidate for a small unit test even though this project has no test runner configured yet (same gap the final review of the previous body of work flagged for `markdown.js`; not this design's job to fix, just worth noting for whoever picks that up).

## Route changes

`src/routes/jobsearch.js` is restructured (not just extended) to:
- Accept the same request body shape as today (`cvId, city, region, country, remote, minComp, notes`).
- Orchestrate the 3 sources per the streaming architecture above.
- Run dedup, then the existing ranking prompt (unchanged prompt logic, just now fed a merged/deduped list instead of Arbeitnow's alone).
- Stream all of the above as SSE per the event sequence above.

## Frontend changes

`public/js/job-search.js` changes from a single `await api(...)` call to consuming an SSE stream (follow the existing chat-streaming consumption pattern already used elsewhere in this app's frontend, e.g. the CV-improve chat page, for the fetch+ReadableStream-reader shape).

- Render a small progress row per source (e.g. "Arbeitnow: searching…" → "Arbeitnow: 12 found" or "Arbeitnow: unavailable") above the results grid, updating live as `source` events arrive.
- Render jobs into the results grid incrementally is **not** required — since dedup and ranking only happen after all sources settle, the job grid itself renders once, on the final `complete` event (only the per-source progress rows update live). This avoids showing un-deduped/unranked jobs that then have to be replaced.
- `public/job-search.html` needs no structural change beyond whatever the progress-rows container requires (a plan-time detail).

## Error handling

- Per-source errors are caught inside each source's own `fetchXJobs()` (same contract as `arbeitnow.js` today: never throws, always returns `{jobs, error}`) — a source failing shows as that source's progress row going to `"error"`, everything else proceeds normally.
- If **all three** sources return zero jobs or all error, the final `complete` event's `text` should say so plainly (matching the existing "No open roles matched..." message pattern), not silently show an empty grid.
- `OPENWEBNINJA_API_KEY` unset → JSearch source resolves as not-configured (empty jobs, no error) — the app must remain fully usable with just Arbeitnow + Himalayas if the user hasn't set up the JSearch key yet, exactly as `wrangler.jsonc`'s "Original files"/R2 section already models graceful-optional-binding behavior for this app.

## Testing

This project has no automated test suite (confirmed in the previous body of work's final review). Verification for this feature is manual/live, consistent with every prior frontend task in this project's history: `npm run lint`, then `npm run dev` and a real search with and without `OPENWEBNINJA_API_KEY` set, confirming per-source progress rows update independently, deduped results don't show visible duplicates, and the JSearch monthly quota isn't burned by anything beyond one call per user-initiated search.

## Open questions for the implementation plan (not resolved by this design)

- Exact JSearch response field names — must be confirmed against a live API call before writing `jsearch.js`'s mapper (only 200 free requests/month, so this should be done deliberately, not by trial-and-error burning through the quota).
- Himalayas' exact accepted `country` parameter format (ISO alpha-2 vs full name) — the docs mention both are accepted; confirm which resolves best against this app's existing `country` free-text form field.
- Exact markup/CSS for the per-source progress rows in `job-search.html`/`styles.css`.
