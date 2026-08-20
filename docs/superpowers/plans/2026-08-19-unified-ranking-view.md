# Unified Ranking / Compare View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sortable, cross-application comparison table (Company/Role, Stage, Match, Comp, Location) to the Applications page, letting the user compare all applications at a glance instead of only seeing them scattered across kanban columns.

**Architecture:** A new collapsible `<details id="comparePanel">` panel on `public/index.html`, rendered entirely client-side from the same `apps` array `load()` in `public/js/index.js` already fetches for the kanban board — no new backend endpoint. Sort state lives as two module-scope variables; clicking a column header re-sorts the already-fetched data and re-renders, no re-fetch.

**Tech Stack:** Vanilla JS, no build step, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-19-unified-ranking-view-design.md`

## Global Constraints

- No new backend endpoint or schema change — this is a pure frontend addition over `GET /applications`, which `load()` already calls.
- No map on this view (confirmed during brainstorming) — Location is a plain text column.
- Read-only: no stage editing from this table. Row click may navigate to `application.html?id=...` (matching existing kanban-card click behavior), but nothing here mutates data.
- Nulls (missing `matchScore` or unparseable `compEstimate`) sort last, in both ascending and descending order — never treated as zero/lowest.
- Default sort: stage order (`saved → applied → screening → interview → offer → rejected → withdrawn`).
- Reuse the existing `.status-chip.<stage>` classes for the Stage column — no new badge system or colors.

---

### Task 1: Table markup and render/sort logic

**Files:**
- Modify: `public/index.html` (new `#comparePanel` markup)
- Modify: `public/js/index.js` (`STAGE_ORDER`, sort state, `renderComparePanel`, header click wiring, call site in `load()`)

**Interfaces:**
- Produces: `renderComparePanel(apps)` — called once from `load()` with the same `apps` array used for the kanban board, and again from header-click handlers with the module-cached copy (no parameters change between calls).

- [ ] **Step 1: Add the panel markup**

Find (`public/index.html`):
```html
    <div id="activityGraph"></div>

    <details class="card" id="searchPane">
```
Replace with:
```html
    <div id="activityGraph"></div>

    <details class="card" id="comparePanel">
      <summary><h2 style="display:inline;">Compare</h2></summary>
      <div class="table-wrap">
        <table id="compareTable">
          <thead>
            <tr>
              <th data-sort="company">Company / Role</th>
              <th data-sort="stage">Stage</th>
              <th data-sort="match">Match</th>
              <th data-sort="comp">Comp</th>
              <th data-sort="location">Location</th>
            </tr>
          </thead>
          <tbody id="compareTableBody"></tbody>
        </table>
      </div>
    </details>

    <details class="card" id="searchPane">
```

- [ ] **Step 2: Add sort state and the stage-order constant**

Find (`public/js/index.js`):
```js
const STAGES = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["interview", "Interview"],
  ["offer", "Offer"],
];

const board = document.getElementById("board");
```
Replace with:
```js
const STAGES = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["interview", "Interview"],
  ["offer", "Offer"],
];

// Full stage order for the compare table's default sort, including the two
// terminal stages the kanban's STAGES above deliberately excludes (they
// render in a separate "Closed" column, not a kanban stage column).
const STAGE_ORDER = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];

let compareSortKey = "stage";
let compareSortDir = "asc";
let compareAppsData = [];

const board = document.getElementById("board");
```

- [ ] **Step 3: Add the comparison-value parser, sort/render function, and header click wiring**

Find (`public/js/index.js`, immediately before `async function load() {`):
```js
async function load() {
```
Replace with:
```js
/** Best-effort first-number scrape from freeform compensation text (e.g.
 * "$120k-140k" -> 120, "competitive" -> null). Mirrors the same
 * regex-scrape spirit as parseMatchScore in src/routes/applications.js --
 * good enough for sorting, not meant to be exact. */
function parseCompValue(compEstimate) {
  const m = String(compEstimate || "").match(/[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function renderComparePanel(apps) {
  compareAppsData = apps;
  const tbody = document.getElementById("compareTableBody");
  if (!tbody) return;

  const dir = compareSortDir === "asc" ? 1 : -1;
  const rows = [...apps].sort((a, b) => {
    if (compareSortKey === "match" || compareSortKey === "comp") {
      const av = compareSortKey === "match" ? a.matchScore : parseCompValue(a.compEstimate);
      const bv = compareSortKey === "match" ? b.matchScore : parseCompValue(b.compEstimate);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls sort last regardless of direction
      if (bv == null) return -1;
      return (av - bv) * dir;
    }
    if (compareSortKey === "stage") {
      return (STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)) * dir;
    }
    if (compareSortKey === "location") {
      return String(a.location || "").localeCompare(String(b.location || "")) * dir;
    }
    return (
      (String(a.company || "").localeCompare(String(b.company || "")) ||
        String(a.role || "").localeCompare(String(b.role || ""))) * dir
    );
  });

  tbody.innerHTML = rows
    .map(
      (a) => `
    <tr data-id="${a.id}">
      <td>${escapeHtml(a.company)} — ${escapeHtml(a.role)}</td>
      <td><span class="status-chip ${a.stage}">${a.stage}</span></td>
      <td>${a.matchScore != null ? a.matchScore + "%" : "—"}</td>
      <td>${a.compEstimate ? escapeHtml(a.compEstimate) : "—"}</td>
      <td>${escapeHtml(a.location || "—")}</td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => (window.location.href = `application.html?id=${tr.dataset.id}`);
  });

  document.querySelectorAll("#compareTable th[data-sort]").forEach((th) => {
    if (th.dataset.sort === compareSortKey) {
      th.setAttribute("aria-sort", compareSortDir === "asc" ? "ascending" : "descending");
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

document.querySelectorAll("#compareTable th[data-sort]").forEach((th) => {
  th.onclick = () => {
    const key = th.dataset.sort;
    compareSortDir = compareSortKey === key ? (compareSortDir === "asc" ? "desc" : "asc") : "asc";
    compareSortKey = key;
    renderComparePanel(compareAppsData);
  };
});

async function load() {
```

- [ ] **Step 4: Call `renderComparePanel` from `load()`**

Find (`public/js/index.js`):
```js
  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(apps, stats);
  renderMastheadStatement(apps, stats, appsLoadFailed);
```
Replace with:
```js
  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(apps, stats);
  renderMastheadStatement(apps, stats, appsLoadFailed);
  renderComparePanel(apps);
```
(Placed before the `apps.length === 0` early return further down in `load()`, so the table still renders -- empty -- rather than being skipped when there are no applications yet.)

- [ ] **Step 5: Manual verification -- page loads without errors, table has data**

Start the dev server and confirm the panel appears and populates:
```bash
npm run dev > /tmp/dev-verify-compare.log 2>&1 &
disown
sleep 6
curl -s http://localhost:8787/index.html | grep -c "comparePanel"
```
Expected: `1` (the panel markup is present in the served HTML). Full interactive verification (sorting, click-through) happens in Task 3.

- [ ] **Step 6: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/js/index.js
git commit -m "feat: add sortable cross-application compare table"
```

---

### Task 2: Table styling

**Files:**
- Modify: `public/css/styles.css` (new rules for `.table-wrap`, `#compareTable`, sort-arrow indicator)

**Interfaces:**
- Consumes: the `#compareTable`/`th[data-sort]`/`aria-sort` structure produced by Task 1.

- [ ] **Step 1: Add table styling**

Find (`public/css/styles.css`, immediately after the `#jobMap` rule added in Part 4):
```css
#jobMap { height: 280px; border-radius: 10px; margin: 16px 0; overflow: hidden; }
```
Replace with:
```css
#jobMap { height: 280px; border-radius: 10px; margin: 16px 0; overflow: hidden; }

.table-wrap { overflow-x: auto; margin-top: 12px; }
#compareTable { width: 100%; border-collapse: collapse; font-size: 13.5px; }
#compareTable th, #compareTable td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
#compareTable th { color: var(--ink-soft); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; user-select: none; }
#compareTable th:hover { color: var(--ink); }
#compareTable th[data-sort]::after { content: ""; margin-left: 4px; opacity: 0.35; }
#compareTable th[aria-sort="ascending"]::after { content: "▲"; opacity: 1; }
#compareTable th[aria-sort="descending"]::after { content: "▼"; opacity: 1; }
#compareTable tbody tr { cursor: pointer; }
#compareTable tbody tr:hover { background: var(--rc-surface-container-low); }
```

- [ ] **Step 2: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add public/css/styles.css
git commit -m "style: table styling for the compare panel"
```

---

### Task 3: Visual and interaction verification

**Files:** None modified — verification-only task.

**Interfaces:**
- Consumes: Tasks 1-2's combined output.

- [ ] **Step 1: Install Playwright as scratch tooling**

```bash
mkdir -p /tmp/pw-verify-compare
npm init -y --prefix /tmp/pw-verify-compare > /dev/null 2>&1
npm install --prefix /tmp/pw-verify-compare playwright@1.62.1
npx --prefix /tmp/pw-verify-compare playwright install chromium
ln -sf /tmp/pw-verify-compare/node_modules/playwright node_modules/playwright
ln -sf /tmp/pw-verify-compare/node_modules/playwright-core node_modules/playwright-core
```

- [ ] **Step 2: Confirm the dev server is running with real application data**

```bash
curl -s http://localhost:8787/api/applications | head -c 200
```
Start it if needed: `npm run dev > /tmp/dev-verify-compare.log 2>&1 & disown; sleep 6`. If no applications exist locally, create one first via `POST /api/applications` with a real `company`/`role` (matching the shape used elsewhere in this project's manual verification steps) so the table has at least 2-3 rows to sort meaningfully.

- [ ] **Step 3: Verify rendering and sort behavior**

Write and run (repo root, so the `playwright` symlink resolves):
```js
// verify-compare-scratch.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:8787/index.html");
await page.waitForLoadState("networkidle");
await page.locator("#comparePanel summary").click();

const rowCountBefore = await page.locator("#compareTableBody tr").count();
console.log("rows rendered:", rowCountBefore, rowCountBefore > 0 ? "PASS" : "FAIL");

// Default sort should be stage order -- confirm the header shows it.
const stageAriaSort = await page.locator('#compareTable th[data-sort="stage"]').getAttribute("aria-sort");
console.log("default sort column is stage:", stageAriaSort === "ascending" ? "PASS" : `FAIL (${stageAriaSort})`);

// Click Match header twice: first ascending, then descending -- confirm
// aria-sort flips and the row order actually changes.
await page.locator('#compareTable th[data-sort="match"]').click();
const matchAriaSort1 = await page.locator('#compareTable th[data-sort="match"]').getAttribute("aria-sort");
const firstRowAfterAsc = await page.locator("#compareTableBody tr").first().innerText();
await page.locator('#compareTable th[data-sort="match"]').click();
const matchAriaSort2 = await page.locator('#compareTable th[data-sort="match"]').getAttribute("aria-sort");
const firstRowAfterDesc = await page.locator("#compareTableBody tr").first().innerText();
console.log("match sort toggled asc->desc:", matchAriaSort1, "->", matchAriaSort2, matchAriaSort1 !== matchAriaSort2 ? "PASS" : "FAIL");
console.log("row order changed between asc/desc:", firstRowAfterAsc !== firstRowAfterDesc ? "PASS" : "FAIL (only meaningful with >1 distinct match score)");

console.log("page errors:", errors.length);
if (errors.length) console.log(errors.join("\n"));

await page.screenshot({ path: "/tmp/screenshot-compare.png", fullPage: true });
await browser.close();
```
```bash
node verify-compare-scratch.mjs
```
Expected: rows rendered PASS, default sort is stage PASS, sort toggled PASS, zero page errors.

- [ ] **Step 4: Read the screenshot**

Use the Read tool on `/tmp/screenshot-compare.png`. Confirm the table is visually legible: stage badges render with the existing pastel colors, columns align, sort-arrow indicator is visible on the active column header.

- [ ] **Step 5: Clean up scratch tooling**

```bash
pkill -f "wrangler dev" 2>/dev/null
rm -f node_modules/playwright node_modules/playwright-core
rm -f verify-compare-scratch.mjs /tmp/screenshot-compare.png /tmp/dev-verify-compare.log
```

- [ ] **Step 6: Final lint pass**

Run: `npm run lint`. Expected: no errors.

No commit for this task — it modifies no files.

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** default stage-order sort, click-to-sort with direction toggle, nulls-sort-last for Match/Comp, text-only Location, reuse of `.status-chip` classes, no new backend endpoint, no map -- all covered in Task 1/2.
- **Placeholder scan:** none found -- every step has real code, not descriptions of code.
- **Type/consistency check:** `renderComparePanel(apps)` signature is identical at its two call sites (Task 1 Step 4's `load()` call, and the header-click handlers' `compareAppsData` call in Task 1 Step 3); `parseCompValue` is only used inside `renderComparePanel`, no cross-file signature to drift.
- **Non-goals honored:** no changes to `src/routes/applications.js`, `src/lib/db.js`, `application.html`, `outreach.html`, or `tailor.html`.
