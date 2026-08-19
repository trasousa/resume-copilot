# Activity Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub-style contribution-graph heatmap to the Applications page, aggregating the existing `activity_events` table by day over a trailing 365-day window.

**Architecture:** One new backend read: a `getActivityHeatmap` DB function plus a `GET /applications/activity-heatmap` route, both following the exact pattern already established by `getApplicationStats`/`GET /applications/stats` in the same files. One new small frontend module (`public/js/activity-graph.js`) rendering a CSS-grid heatmap from that data, wired into `index.js`'s existing page-init sequence.

**Tech Stack:** Hono routes, D1/SQLite, vanilla JS, plain CSS Grid, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-19-activity-graph-design.md` — its Data/Component/Placement sections are the authority this plan implements.

## Global Constraints

- No new activity-event types, no new logging call sites — this only aggregates what `src/routes/applications.js` already writes to `activity_events` at its 4 existing `db.addActivity` call sites.
- No new npm dependencies, no build step change.
- This project has no automated test suite — verification includes a direct check of the new endpoint's raw JSON shape before checking the rendered visual (per the spec's explicit testing requirement), plus Playwright screenshots as scratch tooling.
- **Route collision, checked during plan authorship:** `GET /activity-heatmap` (single path segment) cannot collide with the existing `GET /:id/activity` (requires a literal trailing `/activity` segment) — confirmed by reading Hono's route definitions directly, not just reasoning about it. No special registration-order handling is needed; place the new route as a straightforward sibling of `/stats`.

---

### Task 1: Backend — aggregation query and route

**Files:**
- Modify: `src/lib/db.js` (new `getActivityHeatmap` function)
- Modify: `src/routes/applications.js` (new `GET /activity-heatmap` route)

**Interfaces:**
- Produces: `getActivityHeatmap(db) -> Promise<Array<{date: string, count: number}>>` (exported from `src/lib/db.js`), and `GET /api/applications/activity-heatmap -> {date, count}[]` (consumed by Task 2's frontend fetch).

- [ ] **Step 1: Add the DB function**

Find (`src/lib/db.js`, immediately after `getApplicationStats`'s closing `}`):
```js
export async function getApplicationStats(db) {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN stage = 'interview' THEN 1 ELSE 0 END) AS interviews,
         SUM(CASE WHEN stage = 'offer' THEN 1 ELSE 0 END) AS offers,
         AVG(CASE WHEN match_score IS NOT NULL THEN match_score END) AS avg_match
       FROM applications`
    )
    .first();
  return {
    total: row?.total ?? 0,
    interviews: row?.interviews ?? 0,
    offers: row?.offers ?? 0,
    avgMatch: row?.avg_match != null ? Math.round(row.avg_match) : null,
  };
}
```
Add immediately after it:
```js

/** Daily activity counts for the trailing 365 days, for the Applications
 * page's contribution-graph heatmap. Aggregates activity_events (already
 * logged at every application creation, stage change, tailoring run,
 * document generation, and reminder -- see the 4 db.addActivity call
 * sites in src/routes/applications.js) rather than introducing any new
 * event source. */
export async function getActivityHeatmap(db) {
  const { results } = await db
    .prepare(
      `SELECT date(occurred_at) AS day, COUNT(*) AS count
       FROM activity_events
       WHERE occurred_at >= date('now', '-365 days')
       GROUP BY date(occurred_at)
       ORDER BY day`
    )
    .all();
  return results.map((r) => ({ date: r.day, count: r.count }));
}
```

- [ ] **Step 2: Add the route**

Find (`src/routes/applications.js`):
```js
router.get("/stats", async (c) => c.json(await db.getApplicationStats(c.env.DB)));
```
Replace with:
```js
router.get("/stats", async (c) => c.json(await db.getApplicationStats(c.env.DB)));

router.get("/activity-heatmap", async (c) => c.json(await db.getActivityHeatmap(c.env.DB)));
```

- [ ] **Step 3: Verify the endpoint directly, before any frontend work**

```bash
npm run dev > /tmp/dev-verify-activity.log 2>&1 &
disown
sleep 6
curl -s http://localhost:8787/api/applications/activity-heatmap
```
Expected: a JSON array of `{"date":"YYYY-MM-DD","count":N}` objects (or `[]` if this local D1 database genuinely has zero activity events yet — check `curl -s http://localhost:8787/api/applications` first; if applications exist, activity events should too, since creation always logs one). Do not proceed to Task 2 until this returns valid, real-shaped JSON — confirm the shape yourself, don't assume the SQL is correct just because it doesn't error.

- [ ] **Step 4: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.js src/routes/applications.js
git commit -m "feat: add activity heatmap aggregation endpoint"
```

(Leave the dev server running for Task 2's verification — no need to restart it.)

---

### Task 2: Frontend — the graph component, styling, and wiring

**Files:**
- Create: `public/js/activity-graph.js`
- Modify: `public/index.html` (insertion point)
- Modify: `public/js/index.js` (fetch + render call)
- Modify: `public/css/styles.css` (`.activity-graph`/`.activity-cell`/tier rules)

**Interfaces:**
- Consumes: `GET /applications/activity-heatmap` (Task 1).
- Produces: `renderActivityGraph(container, data)` exported from `public/js/activity-graph.js`.

- [ ] **Step 1: Create the component module**

```js
// public/js/activity-graph.js
//
// GitHub-style contribution-graph heatmap: 53 columns (weeks) x 7 rows
// (days), 5 color tiers by daily activity count, trailing 365 days.
// `data` is the raw {date, count}[] from GET /applications/activity-heatmap
// -- sparse (only days with activity present); zero-filled here for every
// day in the window so the grid always has a full 365-day shape.

export function renderActivityGraph(container, data) {
  const byDate = new Map(data.map((d) => [d.date, d.count]));
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: byDate.get(iso) || 0 });
  }
  // Pad to start on a Sunday so columns align to real calendar weeks,
  // matching GitHub's own convention.
  const firstDow = new Date(days[0].date).getDay();
  for (let i = 0; i < firstDow; i++) days.unshift({ date: null, count: 0 });

  const tier = (count) => (count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4);

  container.innerHTML = `<div class="activity-graph">${days
    .map(
      (d) =>
        `<span class="activity-cell tier-${tier(d.count)}" ${d.date ? `title="${d.count} ${d.count === 1 ? "activity" : "activities"} on ${d.date}"` : ""}></span>`
    )
    .join("")}</div>`;
}
```

- [ ] **Step 2: Add the CSS**

Find (`public/css/styles.css`, the `.ledger-line`/`.ledger-item` rules from the Tracker redesign — append immediately after that block):
```css
@media (max-width: 700px) {
  .ledger-line { border-top-width: 1px; }
  .ledger-item { flex: 1 1 40%; margin-right: 0; padding: 10px 12px; border-left: none !important; padding-left: 12px !important; }
  .ledger-item:nth-child(n+3) { border-top: 1px solid var(--border); }
}
```
Add immediately after that block:
```css

/* Contribution-graph heatmap -- 5 tiers of --rc-primary at increasing
   opacity (rgba(29, 78, 75, ...) is that token's RGB decomposition,
   matching the same triple already used for .app-card's hover shadow). */
.activity-graph { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 1fr); gap: 3px; margin-bottom: 24px; width: fit-content; }
.activity-cell { width: 11px; height: 11px; border-radius: 2px; }
.activity-cell.tier-0 { background: var(--surface); border: 1px solid var(--border); }
.activity-cell.tier-1 { background: rgba(29, 78, 75, 0.25); }
.activity-cell.tier-2 { background: rgba(29, 78, 75, 0.5); }
.activity-cell.tier-3 { background: rgba(29, 78, 75, 0.75); }
.activity-cell.tier-4 { background: rgba(29, 78, 75, 1); }
```

- [ ] **Step 3: Add the container to `index.html`**

Find:
```html
    <div id="statTiles" class="ledger-line"></div>

    <details class="card" id="searchPane">
```
Replace with:
```html
    <div id="statTiles" class="ledger-line"></div>

    <div id="activityGraph"></div>

    <details class="card" id="searchPane">
```

- [ ] **Step 4: Wire it up in `index.js`**

Find (`public/js/index.js:1`):
```js
import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, wireJobPostFetch, safeUrl, fetchJobPostFromUrl } from "./app.js";
```
Replace with:
```js
import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, wireJobPostFetch, safeUrl, fetchJobPostFromUrl } from "./app.js";
import { renderActivityGraph } from "./activity-graph.js";
```

Find (the final two lines of the file):
```js
loadSearchCvs().then((hasCvs) => hasCvs && loadSearchProfile());
load();
```
Replace with:
```js
loadSearchCvs().then((hasCvs) => hasCvs && loadSearchProfile());
api("/applications/activity-heatmap")
  .then((data) => renderActivityGraph(document.getElementById("activityGraph"), data))
  .catch(() => {}); // Non-critical widget -- a failed fetch just leaves it empty, doesn't block the rest of the page.
load();
```
(Fetched once at page init, not re-fetched on every `load()` re-run after a save — activity history doesn't need to refresh as often as the kanban board does, and today's cell being one activity behind after a save is a fine tradeoff for not adding a network round-trip to every save action.)

- [ ] **Step 5: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/js/activity-graph.js public/index.html public/js/index.js public/css/styles.css
git commit -m "feat: render a GitHub-style activity heatmap on the Applications page"
```

---

### Task 3: Visual verification

**Files:** None modified — verification-only task.

**Interfaces:**
- Consumes: Tasks 1-2's combined output.

- [ ] **Step 1: Install Playwright as scratch tooling**

```bash
mkdir -p /tmp/pw-verify-activity
cd /tmp/pw-verify-activity
npm init -y > /dev/null 2>&1
npm install playwright@1.62.1
npx playwright install chromium
cd -
ln -s /tmp/pw-verify-activity/node_modules/playwright node_modules/playwright
ln -s /tmp/pw-verify-activity/node_modules/playwright-core node_modules/playwright-core
```

- [ ] **Step 2: Confirm the dev server is running and the endpoint still returns real data**

```bash
curl -s http://localhost:8787/api/applications/activity-heatmap
```
If it's not running (e.g. this is a fresh session), start it: `npm run dev > /tmp/dev-verify-activity.log 2>&1 & disown; sleep 6`.

- [ ] **Step 3: Screenshot and check for errors**

```bash
cat > /tmp/verify-activity.mjs << 'EOF'
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:8787/index.html");
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
console.log("page errors:", errors.length);
if (errors.length) console.log(errors.join("\n"));

const cellCount = await page.locator(".activity-cell").count();
console.log("activity cells rendered:", cellCount, cellCount >= 365 ? "PASS" : "FAIL");

const filledCells = await page.locator(".activity-cell:not(.tier-0)").count();
console.log("cells with activity (tier 1-4):", filledCells);

// Hover a filled cell (if any) and read its tooltip text.
if (filledCells > 0) {
  const cell = page.locator(".activity-cell:not(.tier-0)").first();
  const title = await cell.getAttribute("title");
  console.log("tooltip text on a filled cell:", title);
}

await page.screenshot({ path: "/tmp/screenshot-activity.png", fullPage: true });
await browser.close();
EOF
node /tmp/verify-activity.mjs
```
Expected: `page errors: 0`, `activity cells rendered: >= 365 PASS` (365 plus up to 6 padding cells for the Sunday-alignment), and if any real activity exists in the local DB, at least one filled cell with a real tooltip like `"2 activities on 2026-08-15"`.

- [ ] **Step 4: Read the screenshot**

Use the Read tool on `/tmp/screenshot-activity.png`. Confirm: a grid of small squares renders below the ledger line and above the "Find roles" panel, most cells are empty/bordered (tier-0, since this is a personal-use app without a year of history yet), and any cells corresponding to recent test-application creation show visibly darker teal shading than the empty ones.

- [ ] **Step 5: Clean up scratch tooling**

```bash
pkill -f "wrangler dev" 2>/dev/null
rm -f node_modules/playwright node_modules/playwright-core
rm -f /tmp/screenshot-activity.png /tmp/verify-activity.mjs /tmp/dev-verify-activity.log
```

- [ ] **Step 6: Final lint pass**

Run: `npm run lint`. Expected: no errors.

No commit for this task — it modifies no files.

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** Data/Component/Placement sections all map onto Tasks 1-2. The spec's open questions are resolved here: tier thresholds are `1 / 2-3 / 4-6 / 7+` (concrete, not left vague), the graph fetches once at page init rather than on every `load()` (documented tradeoff, not silently decided), and the hover tooltip uses the native `title` attribute (simplest option, explicitly not upgraded to a custom tooltip in this plan).
- **Type/consistency check:** `renderActivityGraph(container, data)`'s signature matches its one call site in Task 2 Step 4 exactly (`renderActivityGraph(document.getElementById("activityGraph"), data)`); `getActivityHeatmap(db)` matches its one call site in the new route.
- **Route-collision concern from the spec:** resolved definitively during plan authorship (Global Constraints) by reading Hono's actual route patterns, not left as a "the plan should verify this" hedge.
- **Non-goals honored:** no new activity-event types or logging call sites (confirmed: Task 1 only reads from `activity_events`, never writes to it), `application.html`'s own per-application activity timeline untouched.
