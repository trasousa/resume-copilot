# Map View + Company Enrichment — Design

**Status:** Approved by user in conversation on 2026-08-19. Ready for `superpowers:writing-plans`. Fourth of the 5-part redesign roadmap (design system v2, unified Applications+Search page, activity graph, already merged → this → unified ranking view).

**Context:** User asked for a map showing job search result locations, plus company metadata (location/details) to "build a metadata around the fetched application and companies." Scoped during brainstorming to: a map of search results (not application/company detail pages — deferred), geocoded via free Nominatim (OpenStreetMap) with mandatory server-side caching, and a small company favicon next to each result (Clearbit's free logo API was checked during design and found dead — `logo.clearbit.com` no longer resolves at all — Google's favicon service is the verified-working free replacement, though it returns a small icon, not a full wordmark logo).

**This is the first part of the redesign roadmap to introduce a real runtime dependency**: Leaflet.js, loaded via CDN `<script>`/`<link>` tags (no `npm install`, matching this app's zero-build-step convention — the same pattern already used for Google Fonts `@import`s) — not a new npm package.

**Nominatim's usage policy** (confirmed by reading `https://operations.osmfoundation.org/policies/nominatim/` directly during design, not assumed): max 1 request/second, a valid `User-Agent` header identifying the app is required (library defaults are explicitly called out as insufficient), results **must be cached**, and OpenStreetMap attribution must be displayed — the last point is satisfied automatically by Leaflet's default tile-layer attribution control, not something this app needs to build separately.

## Goals

- Geocode job search result locations, with a server-side D1 cache so repeat searches for the same city never re-hit Nominatim.
- Render a Leaflet map (OpenStreetMap tiles) below the job search results, one pin per geocoded location, showing a popup with title/company on click.
- Show a small company favicon (Google's favicon service) next to each job card's company name.

## Non-goals

- No map on `application.html` or any other page — search results only, this round.
- No firmographic company data (funding, headcount, industry) — decided during the earlier "company data depth" brainstorming question, before this spec was written; still holds.
- No change to `src/lib/arbeitnow.js`/`himalayas.js`/`jsearch.js`/`jobdedup.js` — geocoding and logo lookup are additive steps in the route, after sources are merged and ranked, not part of any individual source client.
- No batch/bulk geocoding of historical saved applications — only new search results get geocoded, live, per search.

## Data: geocode cache

New table, `schema.sql` (alongside the existing `profile`/`token_usage` tables' style):
```sql
-- Server-side cache for Nominatim (OpenStreetMap) geocoding results.
-- Nominatim's usage policy requires caching -- see src/lib/geocode.js.
-- One row per distinct location string ever geocoded; permanent (no TTL
-- eviction) since city-level coordinates don't meaningfully change.
CREATE TABLE IF NOT EXISTS geocode_cache (
  query      TEXT PRIMARY KEY, -- the raw location string, lowercased+trimmed
  lat        REAL,
  lng        REAL,
  cached_at  TEXT NOT NULL
);
```
(`lat`/`lng` are nullable — a location Nominatim couldn't resolve is still cached as a "known miss" with null coordinates, so a future identical query doesn't re-attempt geocoding it every single search. This is a real, deliberate design point: without caching misses too, a consistently-unresolvable location string like "Remote" or a garbled city name would burn a Nominatim request on every future search forever.)

This is a new table (`CREATE TABLE IF NOT EXISTS`), not a new column on an existing table — per the README's own established distinction, this needs `npm run db:init`/`db:init:local` re-run against an existing deployment, but does NOT need one of the manual `ALTER TABLE` migration commands documented there for column additions (a fresh `CREATE TABLE IF NOT EXISTS` is a no-op against a DB that already has the table, and creates it cleanly against one that doesn't — no special-cased migration needed either way).

## Geocoding client

New file `src/lib/geocode.js`, mirroring the existing source-client convention (`arbeitnow.js`/`himalayas.js`) — never throws, always returns a defined shape:
```js
// Geocodes location strings via Nominatim (OpenStreetMap's free geocoder),
// with a mandatory D1 cache -- see the usage policy at
// https://operations.osmfoundation.org/policies/nominatim/: max 1
// request/second, a real User-Agent identifying the app is required
// (library defaults are explicitly insufficient), and results must be
// cached. This module enforces both: every call checks the cache first,
// and calls to the live API are made sequentially with a 1-second gap,
// never in parallel.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "resume-copilot/1.0 (personal job-tracking tool)";

function normalizeQuery(location) {
  return String(location || "").trim().toLowerCase();
}

async function geocodeOne(db, rawLocation) {
  const query = normalizeQuery(rawLocation);
  if (!query) return null;

  const cached = await db.prepare("SELECT lat, lng FROM geocode_cache WHERE query = ?").bind(query).first();
  if (cached) return cached.lat != null ? { lat: cached.lat, lng: cached.lng } : null;

  let result = null;
  try {
    const res = await fetch(`${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { "User-Agent": USER_AGENT },
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body) && body.length) {
        result = { lat: Number(body[0].lat), lng: Number(body[0].lon) };
      }
    }
  } catch {
    // Geocoding failure for one location must never break the whole
    // search -- cache the miss (see the table's own comment on why) and
    // move on.
  }

  await db
    .prepare("INSERT OR REPLACE INTO geocode_cache (query, lat, lng, cached_at) VALUES (?, ?, ?, ?)")
    .bind(query, result?.lat ?? null, result?.lng ?? null, new Date().toISOString())
    .run();

  return result;
}

/** Geocodes a list of location strings, deduplicated, cache-first,
 * respecting Nominatim's 1 req/sec cap for cache misses only (cache hits
 * are unlimited -- they never touch the live API). Returns a Map from the
 * normalized query string to {lat, lng} or null. */
export async function geocodeLocations(db, locations) {
  const unique = [...new Set(locations.map(normalizeQuery).filter(Boolean))];
  const results = new Map();

  for (const query of unique) {
    const wasCached = await db.prepare("SELECT 1 FROM geocode_cache WHERE query = ?").bind(query).first();
    results.set(query, await geocodeOne(db, query));
    if (!wasCached) {
      // Only pause after a real API call -- cache hits should stay fast,
      // otherwise a search whose locations are all already cached would
      // pay a needless multi-second penalty for no reason.
      // eslint-disable-next-line no-undef
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
```

## Route integration

`src/routes/jobsearch.js` gains a geocoding step after the ranking step resolves (both the success path and the catch-fallback path need it, since either can be what actually gets sent — the plan should structure this as a single shared step applied to whichever job list ends up final, not duplicated in both branches). Each job in the final list gets a `lat`/`lng` field (possibly `null` if ungeocodable) attached before the `"complete"` SSE event is sent, keyed off `job.location`.

## Frontend: map + company favicon

**Leaflet loading**: add to `public/index.html`'s `<head>` (this page now hosts the search panel, per the already-merged unified-page redesign):
```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```
(Pinned version, not `@latest` — this app doesn't have a build step to catch a breaking CDN update, so an unpinned version is a real risk the plan must avoid.)

**Map container**: a new `<div id="jobMap"></div>` rendered inside the search results area (`renderSearchResults` in `index.js`), only when at least one job has resolved coordinates — no empty map shown when nothing geocoded.

**Company favicon**: each job card's company name gets a small `<img>` before it, `src="https://www.google.com/s2/favicons?domain=<guessed-domain>&sz=32"`. **A real gap the plan must resolve, not left unaddressed here**: job search results don't include a company website domain, only a company name string — Google's favicon endpoint needs a domain, not a name. The plan needs a domain-guessing strategy (e.g. lowercase + strip spaces/punctuation + append `.com`) that will be wrong for a meaningful fraction of companies (multi-word names, non-`.com` TLDs, holding-company vs. brand-name mismatches) — this is a best-effort visual touch, not a data-accuracy feature, and the plan should make the `<img>` fail gracefully (e.g. `onerror` hiding the broken-image icon) rather than trying to solve company-name-to-domain resolution perfectly.

## What does NOT change

- `src/lib/arbeitnow.js`/`himalayas.js`/`jsearch.js`/`jobdedup.js` — untouched, geocoding is a route-level step after they've already run.
- The ranking prompt/LLM call — unchanged; geocoding happens after ranking, not before, so it never reaches the LLM context (keeping the prompt's token budget exactly as it is today).
- `application.html` — no map there this round.

## Testing

No automated test suite (established convention). Verification is a mix of: a direct live check of `geocodeLocations` against a couple of real city names (confirming real lat/lng come back, and confirming a second call for the same city is fast — proving the cache actually works, not just that the function doesn't error), plus Playwright screenshots of the rendered map and favicon, same convention as prior rounds. Given Nominatim's real 1 req/sec constraint, the plan's own verification steps must not spam it — test with 2-3 distinct cities, not a loop over dozens.

## Open questions for the implementation plan (not resolved by this design)

- Exact domain-guessing heuristic for the favicon lookup (a plan-level detail, explicitly not solvable perfectly).
- Exact map popup markup/styling.
- Whether the map re-centers/re-fits bounds automatically to show all pins, or uses a fixed default view (Leaflet has a built-in `fitBounds` helper for this — the plan should use it rather than hardcoding a center/zoom).
