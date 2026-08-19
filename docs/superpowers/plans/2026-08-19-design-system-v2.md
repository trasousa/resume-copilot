# Design System v2 (Calm Minimalism) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a calmer, less generic design system across resume-copilot — new body typeface, a de-generified card treatment, varied radius, restrained motion, a pastel semantic-color system for status tags, skeleton loading states, and cleanup of two dead/duplicate UI elements — with zero IA or feature changes.

**Architecture:** Almost entirely CSS-token and CSS-rule changes cascading through the app's existing custom-property system, plus small, localized JS edits (adding `--index` inline styles to two render loops for staggered reveals, and one skeleton-markup swap). No new files except one tiny CSS-only motion addition; no JS utility library, no build step.

**Tech Stack:** Plain CSS custom properties, vanilla JS, no build step, no new dependencies. Verification uses Playwright as scratch tooling (proven working in prior redesign rounds), including at least one interaction test (hover, not just a static screenshot) per the spec's testing requirement.

**Spec:** `docs/superpowers/specs/2026-08-19-design-system-v2-design.md` — its Typography/Color/Card treatment/Motion/Loading states/"What does NOT change" sections are the authority this plan implements. Builds on already-merged `docs/superpowers/specs/2026-08-18-editorial-dashboard-redesign-design.md` and `docs/superpowers/specs/2026-08-18-tracker-structural-redesign-design.md` (their tokens/patterns are the baseline this plan modifies, not replaces wholesale).

## Global Constraints

- No new npm dependencies, no build step change.
- No IA changes: no new routes, no nav tab/label changes (only the dead notification bell button is removed — a subtraction, not a restructure).
- Brand colors (`--rc-primary` teal, `--rc-secondary` coral) unchanged.
- No new features (map, activity graph, company enrichment, unified ranking) — those are separate sub-projects in the roadmap, not this plan.
- This project has no automated test suite — verification is Playwright-driven, including a real interaction test (hover/scroll), not just static screenshots, per the spec's explicit testing requirement.
- Playwright is scratch tooling only: install into a scratch directory, symlink into the repo's gitignored `node_modules/`, remove symlinks before committing. Never add to `package.json`.

---

### Task 1: Typography — Outfit body font + tabular figures

**Files:**
- Modify: `public/css/styles.css:1` (Google Fonts import)
- Modify: `public/css/styles.css` (`--font-body` in `:root`, plus tabular-nums additions)

**Interfaces:**
- Produces: `--font-body` now resolves to Outfit instead of Inter — consumed automatically by every element using `font-family: var(--font-body)` (the `body` selector sets this globally already).

- [ ] **Step 1: Update the Google Fonts import**

Find (`public/css/styles.css:1`):
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap');
```
Replace with:
```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap');
```

- [ ] **Step 2: Update `--font-body`**

Find (in the second `:root` block):
```css
  --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```
Replace with:
```css
  --font-body: "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

- [ ] **Step 3: Add tabular figures to numeric displays**

Find (`.ledger-item .ledger-value` rule):
```css
.ledger-item .ledger-value {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
}
```
Replace with:
```css
.ledger-item .ledger-value {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
```

Find (`.match-badge` rule):
```css
.match-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 700;
}
```
Replace with:
```css
.match-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`. Expected: no errors (CSS-only change, this confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add public/css/styles.css
git commit -m "feat: swap body typeface to Outfit, enable tabular figures for data displays"
```

---

### Task 2: Card treatment — drop resting shadow, vary radius, add hover lift to clickable cards

**Files:**
- Modify: `public/css/styles.css` (`.card` rule, new `.app-card:hover`/`.job-card:hover` rule)

**Interfaces:**
- Consumes: nothing new.
- Produces: `.card` no longer has a resting `box-shadow`. A new hover-lift box-shadow transition applies specifically to `.app-card`/`.job-card` (the genuinely clickable card types), not to static content cards.

- [ ] **Step 1: Rewrite `.card`**

Find:
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
  box-shadow: var(--shadow);
  margin-bottom: 18px;
}
```
Replace with:
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px 28px;
  margin-bottom: 18px;
}
```
(`--radius`, used elsewhere for inputs/buttons/pills, is untouched by this change — this is a card-specific literal value, deliberately different from the smaller radius used on smaller interactive elements, per the spec's "vary the radius" guidance.)

- [ ] **Step 2: Add hover lift to clickable cards only**

Find (`.app-card:hover { border-color: var(--accent); }`):
```css
.app-card:hover { border-color: var(--accent); }
```
Replace with:
```css
.app-card, .job-card { transition: box-shadow 200ms ease, border-color 200ms ease; }
.app-card:hover, .job-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(29, 78, 75, 0.08); }
```
(Static, non-clickable cards like "Upload a CV" keep zero box-shadow at all times, at rest or hover — the lift is a signal reserved for cards that are actually clickable, per the spec's reasoning: shadow-on-hover-only communicates interactivity, shadow-always communicates nothing.)

- [ ] **Step 3: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/css/styles.css
git commit -m "feat: drop resting card shadow, vary card radius, add hover lift to clickable cards only"
```

---

### Task 3: Pastel semantic color system for status tags

**Files:**
- Modify: `public/css/styles.css` (new `--rc-tag-*` tokens, remap `.status-chip`/`.match-badge`/`.pill` variants)

**Interfaces:**
- Produces: `--rc-tag-red`/`--rc-tag-red-ink`, `--rc-tag-blue`/`--rc-tag-blue-ink`, `--rc-tag-green`/`--rc-tag-green-ink`, `--rc-tag-yellow`/`--rc-tag-yellow-ink` — new tokens, consumed only within this task (no other task in this plan references them).

- [ ] **Step 1: Add the pastel tokens**

Find (end of the first `:root` block, right before its closing `}` — the block containing `--rc-outline-variant: #D8D4C8;`):
```css
  --rc-outline-variant: #D8D4C8;
}
```
Replace with:
```css
  --rc-outline-variant: #D8D4C8;

  /* Muted pastel tag system -- status chips, match badges, and pills use
     these instead of the more saturated --warn/--danger/--success tokens,
     which stay reserved for real alerts (error banners, destructive
     actions) rather than routine status labels. */
  --rc-tag-red: #FDEBEC;
  --rc-tag-red-ink: #9F2F2D;
  --rc-tag-blue: #E1F3FE;
  --rc-tag-blue-ink: #1F6C9F;
  --rc-tag-green: #EDF3EC;
  --rc-tag-green-ink: #346538;
  --rc-tag-yellow: #FBF3DB;
  --rc-tag-yellow-ink: #956400;
}
```

- [ ] **Step 2: Remap `.status-chip` variants**

Find:
```css
.status-chip.saved     { background: var(--rc-surface-container); color: var(--rc-on-surface-variant); }
.status-chip.applied   { background: var(--rc-primary-container); color: var(--rc-primary); }
.status-chip.screening { background: var(--rc-primary-container); color: var(--rc-primary); }
.status-chip.interview { background: var(--rc-warn-soft); color: var(--rc-warn); }
.status-chip.offer     { background: var(--rc-success-soft); color: var(--rc-success); }
.status-chip.rejected,
.status-chip.withdrawn { background: var(--danger-soft); color: var(--danger); }
```
Replace with:
```css
.status-chip.saved     { background: var(--rc-surface-container); color: var(--rc-on-surface-variant); }
.status-chip.applied   { background: var(--rc-tag-blue); color: var(--rc-tag-blue-ink); }
.status-chip.screening { background: var(--rc-tag-blue); color: var(--rc-tag-blue-ink); }
.status-chip.interview { background: var(--rc-tag-yellow); color: var(--rc-tag-yellow-ink); }
.status-chip.offer     { background: var(--rc-tag-green); color: var(--rc-tag-green-ink); }
.status-chip.rejected,
.status-chip.withdrawn { background: var(--rc-tag-red); color: var(--rc-tag-red-ink); }
```
(`.status-chip.saved` is intentionally left on the existing neutral tokens — "saved" isn't a positive/negative/attention state, it's a neutral starting point, so it doesn't map to any of the four pastels.)

- [ ] **Step 3: Remap `.match-badge` variants**

Find:
```css
.match-badge.high { background: var(--rc-success-soft); color: var(--rc-success); }
.match-badge.mid  { background: var(--rc-primary-container); color: var(--rc-primary); }
.match-badge.low  { background: var(--danger-soft); color: var(--danger); }
```
Replace with:
```css
.match-badge.high { background: var(--rc-tag-green); color: var(--rc-tag-green-ink); }
.match-badge.mid  { background: var(--rc-tag-yellow); color: var(--rc-tag-yellow-ink); }
.match-badge.low  { background: var(--rc-tag-red); color: var(--rc-tag-red-ink); }
```

- [ ] **Step 4: Remap `.pill` variants**

Find:
```css
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.danger { background: var(--danger-soft); color: var(--danger); }
.pill.muted { background: var(--bg); color: var(--ink-soft); }
```
Replace with:
```css
.pill.warn { background: var(--rc-tag-yellow); color: var(--rc-tag-yellow-ink); }
.pill.danger { background: var(--rc-tag-red); color: var(--rc-tag-red-ink); }
.pill.muted { background: var(--bg); color: var(--ink-soft); }
```
(`.pill.muted` is intentionally left unchanged — it's used for neutral labels like the "Arbeitnow" source-attribution pill in job search results, not a status signal.)

- [ ] **Step 5: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/css/styles.css
git commit -m "feat: remap status tags to a muted pastel color system"
```

---

### Task 4: Staggered reveal for kanban and job-search cards

**Files:**
- Modify: `public/css/styles.css` (new `cardStagger` keyframe + `.stagger-item` class)
- Modify: `public/js/index.js` (kanban card render loop)
- Modify: `public/js/job-search.js` (job card render loop)

**Interfaces:**
- Produces: `.stagger-item` CSS class + `--index` inline custom property convention — consumed by both render loops in this task.
- Scoping decision (resolving the spec's open question): kanban `.app-card` and job-search `.job-card` elements currently have ZERO entrance animation (the existing `riseIn` keyframe only targets `main > .card` — a direct-child selector that doesn't reach cards nested inside `.column .col-body` or `.job-grid`). This task adds staggered reveals specifically to fill that gap, and leaves the existing `riseIn` animation for top-level page cards untouched — the two coexist, targeting different elements, not a replacement.

- [ ] **Step 1: Add the stagger keyframe and class**

Find (the `@keyframes riseIn` block and the rules immediately following it):
```css
@keyframes riseIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
main > .card,
main > .grid > .card,
main > #onboardingBanner > .card,
.cv-page > * {
  animation: riseIn 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
main > .grid > .card:nth-child(2) { animation-delay: 0.06s; }
.cv-page > .assistant-rail { animation-delay: 0.1s; }
```
Replace with:
```css
@keyframes riseIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
main > .card,
main > .grid > .card,
main > #onboardingBanner > .card,
.cv-page > * {
  animation: riseIn 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
main > .grid > .card:nth-child(2) { animation-delay: 0.06s; }
.cv-page > .assistant-rail { animation-delay: 0.1s; }

/* Staggered entrance for dynamically-rendered card lists (kanban cards,
   job search results) -- riseIn above only reaches cards that are direct
   children of main/.grid, so nested repeated cards get zero entrance
   animation without this. Set --index inline per item at render time. */
@keyframes cardStagger {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.stagger-item {
  animation: cardStagger 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--index, 0) * 80ms);
}
```

- [ ] **Step 2: Apply `.stagger-item` to kanban cards**

Find (`public/js/index.js`, inside the `for (const [key] of STAGES)` loop):
```js
    const items = apps.filter((a) => a.stage === key);
    body.innerHTML = items
      .map(
        (a) => `
      <div class="app-card app-card-${a.stage}" data-id="${a.id}">
```
Replace with:
```js
    const items = apps.filter((a) => a.stage === key);
    body.innerHTML = items
      .map(
        (a, i) => `
      <div class="app-card app-card-${a.stage} stagger-item" data-id="${a.id}" style="--index:${i};">
```

- [ ] **Step 3: Apply `.stagger-item` to job search result cards**

Find (`public/js/job-search.js`):
```js
            .map(
              (j, i) => `
          <div class="card job-card">
```
Replace with:
```js
            .map(
              (j, i) => `
          <div class="card job-card stagger-item" style="--index:${i};">
```

- [ ] **Step 4: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add public/css/styles.css public/js/index.js public/js/job-search.js
git commit -m "feat: add staggered entrance animation to kanban and job search cards"
```

---

### Task 5: Skeleton loading state for job search progress rows

**Files:**
- Modify: `public/css/styles.css` (new `.skeleton-pulse` rule + `pulse` keyframe)
- Modify: `public/js/job-search.js` (`renderProgressRow`'s "searching" branch)

**Interfaces:**
- Consumes: nothing new.
- Produces: `.skeleton-pulse` class, used only within this task's changed line.

- [ ] **Step 1: Add the skeleton CSS**

Find (the `.spinner`/`@keyframes spin` rules):
```css
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```
Replace with:
```css
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Shaped like the text it's about to be replaced by ("N found") rather
   than a generic spinner -- used for job search's per-source progress
   rows specifically, which take the longest and are the most visible
   loading state in the app. */
.skeleton-pulse { display: inline-block; width: 44px; height: 11px; border-radius: 4px; background: var(--border); vertical-align: middle; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.9; } }
```
(`.spinner` itself is left in place — this plan's scope is job search's progress rows specifically, per the spec's explicit note that the CV-chat "thinking…" indicator is out of scope for this plan.)

- [ ] **Step 2: Swap the searching-state markup**

Find (`public/js/job-search.js`, `renderProgressRow`):
```js
  if (status === "searching") row.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`;
  else if (status === "done") row.textContent = `${label}: ${extra} found`;
  else row.textContent = `${label}: unavailable`;
```
Replace with:
```js
  if (status === "searching") row.innerHTML = `${escapeHtml(label)}: <span class="skeleton-pulse"></span>`;
  else if (status === "done") row.textContent = `${label}: ${extra} found`;
  else row.textContent = `${label}: unavailable`;
```
(The skeleton now sits exactly where the eventual `${extra} found` text will appear, matching the final content's position and rough shape instead of a spinner icon unrelated to what's coming.)

- [ ] **Step 3: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/css/styles.css public/js/job-search.js
git commit -m "feat: replace job search's loading spinner with a shape-matched skeleton"
```

---

### Task 6: Cleanup — dead bell button, duplicate New Application button, stale comment

**Files:**
- Modify: `public/js/app.js` (remove notification bell button)
- Modify: `public/index.html` (remove page-level New Application button)
- Modify: `public/css/styles.css` (rename stale comment)

**Interfaces:** None — pure removals/renames, no new interfaces produced or consumed.

- [ ] **Step 1: Remove the dead notification bell**

Find (`public/js/app.js`):
```js
        <button class="icon-btn" title="Notifications" disabled>${icon("bell")}</button>
```
Delete this line entirely.

- [ ] **Step 2: Remove the duplicate New Application button on the Tracker page**

Find (`public/index.html`):
```html
    <div class="row between">
      <div>
        <h1 id="mastheadStatement">Loading your applications…</h1>
      </div>
      <button class="btn" id="newAppBtn">+ New application</button>
    </div>
```
Replace with:
```html
    <h1 id="mastheadStatement">Loading your applications…</h1>
```
(The `.row.between` wrapper and its own button are removed entirely — the global nav's `New Application` button, id `topnavNewApp` in `public/js/app.js`, already links to `index.html?new=1`, and `public/js/index.js:37-39` already listens for that query param and auto-opens the same dialog this button opened. Nothing else needs to change — `index.js`'s `document.getElementById("newAppBtn").onclick = ...` handler at the top of the file becomes dead code once this button is removed from the DOM; leave that handler assignment in place only if removing it would require touching unrelated code paths, but check first: if `newAppBtn` element lookup on a null element throws, this must be fixed too. Read `public/js/index.js`'s current `document.getElementById("newAppBtn").onclick = async () => {...}` block before finishing this step — since the element with `id="newAppBtn"` no longer exists in the DOM, `document.getElementById("newAppBtn")` returns `null`, and calling `.onclick = ...` on `null` throws a TypeError that would break the whole page's script execution. This line MUST also be removed as part of this step, along with its entire handler function body, not just the HTML button.)

- [ ] **Step 3: Remove the now-dead `newAppBtn` handler in index.js**

Find (`public/js/index.js`, near the top of the file, right after `wireJobPostFetch(...)`):
```js
document.getElementById("newAppBtn").onclick = async () => {
  dialog.showModal();
  const hint = document.getElementById("newAppCvHint");
  hint.innerHTML = "";
  const cvs = await api("/cvs").catch(() => []);
  if (!cvs.length) {
    hint.innerHTML = `<p class="muted" style="margin: -4px 0 12px;">No CV in the store yet — you can save this application now, but tailoring needs one from <a href="cv-store.html">CV Store</a> first.</p>`;
  }
};
document.getElementById("cancelNewApp").onclick = () => dialog.close();

if (new URLSearchParams(window.location.search).get("new") === "1") {
  document.getElementById("newAppBtn").click();
}
```
Replace with:
```js
async function openNewAppDialog() {
  dialog.showModal();
  const hint = document.getElementById("newAppCvHint");
  hint.innerHTML = "";
  const cvs = await api("/cvs").catch(() => []);
  if (!cvs.length) {
    hint.innerHTML = `<p class="muted" style="margin: -4px 0 12px;">No CV in the store yet — you can save this application now, but tailoring needs one from <a href="cv-store.html">CV Store</a> first.</p>`;
  }
}
document.getElementById("cancelNewApp").onclick = () => dialog.close();

if (new URLSearchParams(window.location.search).get("new") === "1") {
  openNewAppDialog();
}
```
(Extracts the dialog-opening logic into a named function called directly from the `?new=1` query-param check, rather than a removed button's `.click()` — this is the only remaining way that flow was triggered besides the button itself, which the global nav's `New Application` link already reaches via `index.html?new=1`.)

- [ ] **Step 4: Rename the stale comment**

Find (`public/css/styles.css`):
```css
/* --- Advocate component primitives -------------------------------------- */
```
Replace with:
```css
/* --- Component primitives ------------------------------------------------ */
```

- [ ] **Step 5: Lint**

Run: `npm run lint`. Expected: no errors — pay particular attention here, since Step 3's refactor is the one change in this task with real logic risk (removing a button whose handler was also the query-param-triggered dialog opener).

- [ ] **Step 6: Commit**

```bash
git add public/js/app.js public/index.html public/js/index.js public/css/styles.css
git commit -m "fix: remove dead notification bell and duplicate New Application button"
```

---

### Task 7: Visual and interaction verification

**Files:** None modified — verification-only task.

**Interfaces:**
- Consumes: all of Tasks 1-6's combined changes.

- [ ] **Step 1: Install Playwright as scratch tooling**

```bash
mkdir -p /tmp/pw-verify-design2
cd /tmp/pw-verify-design2
npm init -y > /dev/null 2>&1
npm install playwright@1.62.1
npx playwright install chromium
cd -
ln -s /tmp/pw-verify-design2/node_modules/playwright node_modules/playwright
ln -s /tmp/pw-verify-design2/node_modules/playwright-core node_modules/playwright-core
```

- [ ] **Step 2: Start the dev server, confirm test data exists**

```bash
npm run dev > /tmp/dev-verify-design2.log 2>&1 &
disown
sleep 6
curl -s http://localhost:8787/api/applications | head -c 300
```
If empty, create 2-3 test applications across different stages so the kanban stagger/hover/color changes are visible:
```bash
curl -s -X POST http://localhost:8787/api/applications -H "Content-Type: application/json" -d '{"company":"Acme Corp","role":"Senior Engineer","stage":"interview","source":"manual"}' | head -c 200
curl -s -X POST http://localhost:8787/api/applications -H "Content-Type: application/json" -d '{"company":"Globex","role":"Staff Engineer","stage":"offer","source":"manual"}' | head -c 200
curl -s -X POST http://localhost:8787/api/applications -H "Content-Type: application/json" -d '{"company":"Initech","role":"Backend Engineer","stage":"rejected","source":"manual"}' | head -c 200
```

- [ ] **Step 3: Verify the CRITICAL fix from Task 6 first — the page must not throw on load**

```bash
cat > /tmp/verify-no-throw.mjs << 'EOF'
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:8787/index.html");
await page.waitForLoadState("networkidle");
console.log("errors:", errors.length);
if (errors.length) { console.log(errors.join("\n")); process.exit(1); }
console.log("PASS: no page errors");

// Confirm the ?new=1 flow (Task 6 Step 3's refactor) still works.
await page.goto("http://localhost:8787/index.html?new=1");
await page.waitForLoadState("networkidle");
const dialogOpen = await page.locator("#newAppDialog[open]").count();
console.log("dialog opened via ?new=1:", dialogOpen === 1 ? "PASS" : "FAIL");
await browser.close();
EOF
node /tmp/verify-no-throw.mjs
```
Expected: `PASS: no page errors` and `dialog opened via ?new=1: PASS`. If either fails, Task 6's refactor has a real bug — stop and fix before proceeding to screenshots.

- [ ] **Step 4: Screenshot the Tracker page and verify the hover-lift interaction**

```bash
cat > /tmp/screenshot-design2.mjs << 'EOF'
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:8787/index.html");
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500); // let stagger animations finish
await page.screenshot({ path: "/tmp/screenshot-tracker.png", fullPage: true });

// Real interaction test, not just a static screenshot -- hover a kanban
// card and confirm the box-shadow actually changes.
const card = page.locator(".app-card").first();
const before = await card.evaluate((el) => getComputedStyle(el).boxShadow);
await card.hover();
await page.waitForTimeout(300);
const after = await card.evaluate((el) => getComputedStyle(el).boxShadow);
console.log("box-shadow before hover:", before);
console.log("box-shadow after hover:", after);
console.log(before !== after ? "PASS: hover lift fires" : "FAIL: no change on hover");

await browser.close();
EOF
node /tmp/screenshot-design2.mjs
```

- [ ] **Step 5: Read the screenshot and confirm visually**

Use the Read tool on `/tmp/screenshot-tracker.png`. Confirm:
- Body text renders in Outfit (a geometric sans, visibly different from Inter — check letterforms, particularly the lowercase "a" and "g").
- Kanban cards under Interview/Offer/Rejected show the new pastel status-chip colors (yellow/green/red respectively), not the old more-saturated warn/success/danger tokens.
- `.card` elements (e.g. any static content card) show no drop shadow at rest.
- The masthead area no longer shows a second "+ New application" button next to the title (only the nav's global one, in the top bar, remains).

- [ ] **Step 6: Screenshot Job Search's progress-row skeleton state**

This requires capturing mid-search, before the "searching" status resolves — trigger a real search and screenshot quickly:
```bash
cat > /tmp/screenshot-skeleton.mjs << 'EOF'
import { chromium } from "playwright";
const res = await fetch("http://localhost:8787/api/cvs");
const cvs = await res.json();
if (!cvs.length) { console.log("No CV available locally -- skipping skeleton screenshot, not a bug in this plan."); process.exit(0); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:8787/job-search.html");
await page.waitForLoadState("networkidle");
await page.selectOption("#cvSelect", { index: 0 });
await page.fill("#city", "Berlin");
await page.fill("#country", "Germany");
await page.click("#searchBtn");
await page.waitForTimeout(1500); // sources are mid-flight, at least one should show "searching"
await page.screenshot({ path: "/tmp/screenshot-skeleton.png" });
console.log("skeleton screenshot saved");
await browser.close();
EOF
node /tmp/screenshot-skeleton.mjs
```
If a screenshot was saved, read it and confirm at least one progress row shows the pulsing skeleton bar (not a spinning circle) next to its source label.

- [ ] **Step 7: Clean up scratch tooling**

```bash
rm -f node_modules/playwright node_modules/playwright-core
rm -f /tmp/screenshot-*.png /tmp/verify-no-throw.mjs /tmp/screenshot-design2.mjs /tmp/screenshot-skeleton.mjs /tmp/dev-verify-design2.log
```

- [ ] **Step 8: Final lint pass**

Run: `npm run lint`. Expected: no errors.

No commit for this task — it modifies no files.

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** every section of the design spec (Typography, Color, Card treatment, Motion, Loading states, plus the audit's duplicate-button/dead-bell/stale-comment findings) maps onto Tasks 1-6. The spec's three "Open questions" are resolved here, not left open: pastel-to-variant mapping is fully enumerated in Task 3 (every existing chip/badge/pill variant walked), the `riseIn` coexistence question is resolved in Task 4 (coexist, targeting different elements — `riseIn` never reached nested kanban/job cards in the first place, so this is additive, not a replacement), and the skeleton shape is defined concretely in Task 5 (matches the eventual `"N found"` text's position).
- **A real bug caught during plan authorship, not left for review to find:** removing the duplicate `newAppBtn` button (Task 6 Step 2) would leave `public/js/index.js`'s `document.getElementById("newAppBtn").onclick = ...` calling a method on `null`, throwing and breaking the entire page's script — including the kanban board, stats, and every other feature on the Tracker page. Task 6 Step 3 fixes this in the same task, and Task 7 Step 3 verifies it explicitly (not just visually) before any screenshot work proceeds, since this is the one change in this plan with real logic risk, not just a style change.
- **Non-goals honored:** no IA changes beyond removing the dead bell (a subtraction), no new features, brand colors (teal/coral) untouched, no new dependencies.
