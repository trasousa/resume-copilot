# Map View + Company Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geocode job search result locations (cached, rate-limit-respecting), render them on a Leaflet map below the results, and show a small company favicon on each job card.

**Architecture:** A new D1 table (`geocode_cache`) and a new `src/lib/geocode.js` client, mirroring the existing job-source-client convention. `src/routes/jobsearch.js` gains one geocoding step, applied once to whichever job list ends up final (success or ranking-error fallback), before the SSE `complete` event. Frontend gets Leaflet loaded via pinned-version CDN tags (this app's first real runtime dependency — no `npm install`, matching the zero-build-step convention already used for Google Fonts), a map render call in the existing `renderSearchResults` function, and a favicon `<img>` per job card.

**Tech Stack:** Hono, D1, Leaflet.js 1.9.4 (CDN, pinned), OpenStreetMap tiles, Nominatim geocoding, vanilla JS, no build step.

**Spec:** `docs/superpowers/specs/2026-08-19-map-company-enrichment-design.md` — its Data/Geocoding client/Route integration/Frontend sections are the authority this plan implements.

## Global Constraints

- Nominatim's real usage policy (confirmed by reading it directly during design): max 1 request/second, a real `User-Agent` identifying the app, results must be cached, OSM attribution required (satisfied automatically by Leaflet's default tile-layer attribution control).
- Leaflet is loaded via CDN at a **pinned** version (`1.9.4`), never `@latest` — this app has no build step to catch a breaking CDN update.
- `src/lib/arbeitnow.js`/`himalayas.js`/`jsearch.js`/`jobdedup.js` are untouched — geocoding is a route-level step after sources have already run and been ranked.
- Company favicon lookup (Google's favicon service) is a best-effort visual touch, not a data-accuracy feature — the domain-guessing heuristic will be wrong for some companies, and the `<img>` must fail gracefully (hide itself, not show a broken-image icon) rather than trying to solve name-to-domain resolution perfectly.
- This project has no automated test suite — verification includes a direct live check of the geocoding cache actually working (a repeat call for the same city must be fast, not just "not error"), plus Playwright screenshots. Verification must use only 2-3 distinct real city names, never a loop that could approach or exceed Nominatim's 1 req/sec limit.

---

### Task 1: Backend — geocode cache table, client, and route integration

**Files:**
- Modify: `schema.sql` (new `geocode_cache` table)
- Create: `src/lib/geocode.js`
- Modify: `src/routes/jobsearch.js` (geocoding step + restructured ranking block)

**Interfaces:**
- Produces: `geocodeLocations(db, locations: string[]) -> Promise<Map<string, {lat: number, lng: number} | null>>` and `normalizeQuery(location: string) -> string` (both exported from `src/lib/geocode.js`) — consumed by the route in this same task, and available for any future page (e.g. an application detail map, not in scope here) without re-implementing normalization.

- [ ] **Step 1: Add the `geocode_cache` table**

Find (`schema.sql`, immediately before the final `CREATE INDEX` block):
```sql
CREATE INDEX IF NOT EXISTS idx_cvs_created      ON cvs(created_at DESC);
```
Add immediately before that line:
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

CREATE INDEX IF NOT EXISTS idx_cvs_created      ON cvs(created_at DESC);
```

- [ ] **Step 2: Apply the schema change to the local dev database**

```bash
npm run db:init:local
```
Expected: no errors (this is a `CREATE TABLE IF NOT EXISTS`, safe to re-run against an existing local D1 database).

- [ ] **Step 3: Write the geocoding client**

```js
// src/lib/geocode.js
//
// Geocodes location strings via Nominatim (OpenStreetMap's free geocoder),
// with a mandatory D1 cache -- see the usage policy at
// https://operations.osmfoundation.org/policies/nominatim/: max 1
// request/second, a real User-Agent identifying the app is required
// (library defaults are explicitly insufficient), and results must be
// cached. This module enforces both: every call checks the cache first,
// and calls to the live API are made sequentially with a 1-second gap
// after each cache miss, never in parallel and never after a cache hit.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "resume-copilot/1.0 (personal job-tracking tool)";

export function normalizeQuery(location) {
  return String(location || "").trim().toLowerCase();
}

async function geocodeOne(db, query) {
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
    // search -- cache the miss (null coordinates) and move on, same
    // graceful-degradation contract as every other source client in
    // this app.
  }

  await db
    .prepare("INSERT OR REPLACE INTO geocode_cache (query, lat, lng, cached_at) VALUES (?, ?, ?, ?)")
    .bind(query, result?.lat ?? null, result?.lng ?? null, new Date().toISOString())
    .run();

  return result;
}

/** Geocodes a list of location strings, deduplicated, cache-first,
 * respecting Nominatim's 1 req/sec cap for cache misses only (cache hits
 * are unlimited -- they never touch the live API). Returns a Map keyed
 * by normalizeQuery(location) -> {lat, lng} or null. */
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

- [ ] **Step 4: Verify the geocoding client live, against real cities, before touching the route**

```bash
npm run dev > /tmp/dev-verify-geocode.log 2>&1 &
disown
sleep 6
cat > /tmp/verify-geocode.mjs << 'EOF'
// Direct D1 access isn't available outside the Worker, so this hits the
// live Nominatim API directly (same client logic, standalone) to prove
// real coordinates come back for real cities -- exactly 2 distinct
// queries, respecting the 1 req/sec policy manually here too.
const cities = ["Berlin, Germany", "San Francisco, USA"];
for (const city of cities) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
    headers: { "User-Agent": "resume-copilot/1.0 (personal job-tracking tool)" },
  });
  const body = await res.json();
  console.log(city, "->", body[0] ? { lat: body[0].lat, lon: body[0].lon } : "NO RESULT");
  await new Promise((r) => setTimeout(r, 1000));
}
EOF
node /tmp/verify-geocode.mjs
rm /tmp/verify-geocode.mjs
```
Expected: real lat/lon pairs for both cities (Berlin roughly `52.5, 13.4`, San Francisco roughly `37.7, -122.4`). This confirms the live API call shape is correct before wiring the D1-caching version into the route -- if this fails, the issue is with the query/User-Agent, not the caching logic, and is much faster to debug in isolation.

- [ ] **Step 5: Restructure the ranking block to compute a single final job list, then geocode it once**

Find (`src/routes/jobsearch.js`):
```js
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

        const summary = text.replace(/```RANKED\n[\s\S]*?\n```/, "").trim();
        send("complete", { text: summary, jobs: rankedJobs });
      } catch (err) {
        send("complete", { text: "", jobs: rankingCandidates, rankingError: err.message });
      }

      controller.close();
```
Replace with:
```js
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
```

- [ ] **Step 6: Add the import**

Find (`src/routes/jobsearch.js:1-7`):
```js
import { Hono } from "hono";
import * as db from "../lib/db.js";
import { runTask } from "../lib/llm.js";
import { fetchArbeitnowJobs } from "../lib/arbeitnow.js";
import { fetchHimalayasJobs } from "../lib/himalayas.js";
import { fetchJSearchJobs } from "../lib/jsearch.js";
import { dedupeJobs } from "../lib/jobdedup.js";
```
Replace with:
```js
import { Hono } from "hono";
import * as db from "../lib/db.js";
import { runTask } from "../lib/llm.js";
import { fetchArbeitnowJobs } from "../lib/arbeitnow.js";
import { fetchHimalayasJobs } from "../lib/himalayas.js";
import { fetchJSearchJobs } from "../lib/jsearch.js";
import { dedupeJobs } from "../lib/jobdedup.js";
import { geocodeLocations, normalizeQuery } from "../lib/geocode.js";
```

- [ ] **Step 7: Verify end-to-end via a real search, confirming the cache actually works**

```bash
curl -s http://localhost:8787/api/cvs | head -c 100
```
If a CV exists, run a real search twice in a row for the same city (e.g. `curl -N -X POST http://localhost:8787/api/jobsearch/search -H "Content-Type: application/json" -d '{"cvId":"<real-id>","city":"Berlin","country":"Germany","remote":false}' --max-time 180 -o /tmp/search-run-1.txt`, then the identical request again into `/tmp/search-run-2.txt`), and confirm: (a) both responses include `lat`/`lng` fields on the job objects (`python3 -c "import json; d=json.load(open('/tmp/search-run-1.txt'))" ` won't work directly on raw SSE text -- extract the `event: complete` frame's JSON the same way prior sessions in this project's history have, via the frame-splitting approach already used for manual SSE debugging), and (b) the SECOND run's geocoding step completes noticeably faster than the first (most/all locations should now be cache hits, skipping the 1-second-per-miss delay) -- this is the actual proof the cache works, not just that the endpoint doesn't error.

- [ ] **Step 8: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add schema.sql src/lib/geocode.js src/routes/jobsearch.js
git commit -m "feat: geocode job search results with a cached Nominatim client"
```

(Leave the dev server running for Task 2's verification.)

---

### Task 2: Frontend — Leaflet map and company favicon

**Files:**
- Modify: `public/index.html` (Leaflet CDN tags)
- Modify: `public/js/index.js` (map render call, favicon markup)
- Modify: `public/css/styles.css` (`#jobMap` sizing)

**Interfaces:**
- Consumes: `job.lat`/`job.lng` fields from Task 1's SSE `complete` event.

- [ ] **Step 1: Add the Leaflet CDN tags**

Find (`public/index.html:8`):
```html
  <link rel="stylesheet" href="css/styles.css" />
```
Replace with:
```html
  <link rel="stylesheet" href="css/styles.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```
(Pinned to `1.9.4`, not `@latest` -- this app has no build step to catch a breaking CDN update.)

- [ ] **Step 2: Add `#jobMap` sizing CSS**

Append to `public/css/styles.css` (after the `.activity-cell` tier rules added in the prior redesign round):
```css

#jobMap { height: 280px; border-radius: 10px; margin: 16px 0; overflow: hidden; }
```

- [ ] **Step 3: Add the map render function and favicon markup**

Find (`public/js/index.js`, the end of `renderSearchResults`'s template, right before the closing backtick and the `searchResultEl.querySelectorAll("[data-idx]")` line):
```js
        : ""
    }
  `;

  searchResultEl.querySelectorAll("[data-idx]").forEach((btn) => {
```
Replace with:
```js
        : ""
    }
    <div id="jobMap"></div>
  `;

  renderJobMap(jobs);

  searchResultEl.querySelectorAll("[data-idx]").forEach((btn) => {
```

Find (the job-card template's company line):
```js
                <p class="muted" style="margin:0;">${escapeHtml(j.company)}</p>
```
Replace with:
```js
                <p class="muted" style="margin:0; display:flex; align-items:center; gap:6px;"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(String(j.company || "").toLowerCase().replace(/[^a-z0-9]/g, ""))}.com&sz=32" width="16" height="16" alt="" onerror="this.style.display='none'" />${escapeHtml(j.company)}</p>
```
(The `onerror` handler hides the `<img>` entirely on a failed load -- a wrong domain guess (very common, this is explicitly a best-effort heuristic per the spec) shows nothing rather than a broken-image icon.)

Add the new `renderJobMap` function, immediately before `renderSearchResults`:
```js
let jobMapInstance = null;

function renderJobMap(jobs) {
  const container = document.getElementById("jobMap");
  if (!container) return;

  const geocodedJobs = jobs.filter((j) => j.lat != null && j.lng != null);
  if (!geocodedJobs.length) {
    container.style.display = "none";
    return;
  }
  container.style.display = "";

  if (jobMapInstance) {
    jobMapInstance.remove();
    jobMapInstance = null;
  }

  // eslint-disable-next-line no-undef
  const map = L.map(container);
  // eslint-disable-next-line no-undef
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const markers = geocodedJobs.map((j) =>
    // eslint-disable-next-line no-undef
    L.marker([j.lat, j.lng])
      .bindPopup(`<strong>${escapeHtml(j.title)}</strong><br>${escapeHtml(j.company)}`)
      .addTo(map)
  );

  // eslint-disable-next-line no-undef
  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 10 });

  jobMapInstance = map;
}
```
(`jobMapInstance` is tracked at module scope and explicitly `.remove()`d before creating a new one -- Leaflet throws if you call `L.map()` again on a container that already has a map instance attached, which would happen on a second search in the same page session without this cleanup. The `eslint-disable-next-line no-undef` comments follow this file's own established pattern for runtime globals not in the lint config's allowlist, same as the existing `AbortSignal`-related disables elsewhere in this codebase.)

- [ ] **Step 4: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/index.js public/css/styles.css
git commit -m "feat: render job search results on a Leaflet map with company favicons"
```

---

### Task 3: Visual verification

**Files:** None modified — verification-only task.

**Interfaces:**
- Consumes: Tasks 1-2's combined output.

- [ ] **Step 1: Install Playwright as scratch tooling**

```bash
mkdir -p /tmp/pw-verify-map
cd /tmp/pw-verify-map
npm init -y > /dev/null 2>&1
npm install playwright@1.62.1
npx playwright install chromium
cd -
ln -s /tmp/pw-verify-map/node_modules/playwright node_modules/playwright
ln -s /tmp/pw-verify-map/node_modules/playwright-core node_modules/playwright-core
```

- [ ] **Step 2: Confirm the dev server is running with a real CV**

```bash
curl -s http://localhost:8787/api/cvs | head -c 200
```
Start it if needed: `npm run dev > /tmp/dev-verify-map.log 2>&1 & disown; sleep 6`.

- [ ] **Step 3: Run one real search and screenshot the map + favicon**

```bash
cat > /tmp/verify-map.mjs << 'EOF'
import { chromium } from "playwright";

const cvRes = await fetch("http://localhost:8787/api/cvs");
const cvs = await cvRes.json();
if (!cvs.length) {
  console.log("No CV available locally -- cannot run this live check.");
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:8787/index.html");
await page.waitForLoadState("networkidle");
await page.locator("#searchPane summary").click();
await page.selectOption("#cvSelect", { index: 0 });
await page.fill("#city", "Berlin");
await page.fill("#country", "Germany");
await page.click("#searchBtn");

await page.waitForSelector(".job-card [data-idx]", { timeout: 150000 });
console.log("page errors so far:", errors.length);
if (errors.length) console.log(errors.join("\n"));

const mapVisible = await page.locator("#jobMap").isVisible();
console.log("map container visible:", mapVisible);

const leafletTiles = await page.locator("#jobMap .leaflet-tile").count();
console.log("leaflet tiles rendered:", leafletTiles, leafletTiles > 0 ? "PASS" : "FAIL");

const markerCount = await page.locator("#jobMap .leaflet-marker-icon").count();
console.log("map markers:", markerCount);

const faviconCount = await page.locator(".job-card img").count();
console.log("favicon <img> elements:", faviconCount);

await page.screenshot({ path: "/tmp/screenshot-map.png", fullPage: true });
await browser.close();
EOF
node /tmp/verify-map.mjs
```
Expected: `map container visible: true`, `leaflet tiles rendered: > 0 PASS`, some marker count `>= 1` (assuming at least one result geocoded successfully), zero new page errors.

- [ ] **Step 4: Read the screenshot**

Use the Read tool on `/tmp/screenshot-map.png`. Confirm: a real map with visible OpenStreetMap tiles and at least one pin renders below the job result cards, and small favicon images appear next to company names on cards where the domain guess happened to resolve (not every card will have one -- that's expected, per the spec's explicit "best-effort" framing, not a bug to chase).

- [ ] **Step 5: Clean up scratch tooling**

```bash
pkill -f "wrangler dev" 2>/dev/null
rm -f node_modules/playwright node_modules/playwright-core
rm -f /tmp/screenshot-map.png /tmp/verify-map.mjs /tmp/dev-verify-map.log /tmp/dev-verify-geocode.log /tmp/search-run-1.txt /tmp/search-run-2.txt
```

- [ ] **Step 6: Final lint pass**

Run: `npm run lint`. Expected: no errors.

No commit for this task — it modifies no files.

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** Data/Geocoding client/Route integration/Frontend sections all map onto Tasks 1-2. The spec's open questions are resolved here: the domain-guessing heuristic is a simple lowercase-strip-punctuation-plus-`.com` guess with graceful `onerror` failure (Task 2 Step 3), map popups show title+company (Task 2 Step 3), and `fitBounds` is used rather than a hardcoded center/zoom (Task 2 Step 3).
- **A refinement over the spec, decided during plan authorship:** `normalizeQuery` is exported from `geocode.js` (the spec's own code sample didn't export it) and imported at the route's call site, rather than duplicating the same `.trim().toLowerCase()` logic in two files where it could silently drift out of sync.
- **Type/consistency check:** `geocodeLocations(db, locations)` and `normalizeQuery(location)` signatures match their call sites in Task 1 Step 5 exactly; `renderJobMap(jobs)` matches its one call site in Task 2 Step 3.
- **Non-goals honored:** no changes to `arbeitnow.js`/`himalayas.js`/`jsearch.js`/`jobdedup.js`/the ranking prompt; `application.html` untouched.
