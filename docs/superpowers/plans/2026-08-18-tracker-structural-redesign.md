# Tracker Homepage Structural Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tracker homepage's generic 4-card stat-tile grid and static page title with a computed editorial masthead statement and a single rule-divided "ledger line" — the first structural (not just token-level) move in this app's redesign.

**Architecture:** Same data (`apps`, `stats` from the existing `load()` function), new presentation. `renderStats()` is rewritten to produce the ledger-line markup instead of stat-tile cards; a new function computes the masthead statement's text. Both are pure presentation changes — no new API calls, no IA change, kanban board untouched.

**Tech Stack:** Plain CSS custom properties, vanilla JS template literals, no build step, no new dependencies. Verification uses Playwright as scratch tooling (proven working earlier this session).

**Spec:** `docs/superpowers/specs/2026-08-18-tracker-structural-redesign-design.md` — its Masthead statement, Ledger line, and "What does NOT change" sections are the authority this plan implements. Also relevant, already-merged: `docs/superpowers/specs/2026-08-18-editorial-dashboard-redesign-design.md` (this plan builds on its tokens — `--font-display`, `--ink`, `--border`, `--ink-soft` — already in place).

## Global Constraints

- No new npm dependencies, no build step change.
- No IA changes: no new routes, no nav changes, `+ New application` dialog flow unchanged.
- Kanban board (`.board`, `.column`, `.app-card`) untouched in this plan.
- This project has no automated test suite — verification is Playwright-driven visual screenshots plus `npm run lint`, matching the prior redesign plan's established convention.
- Playwright is scratch tooling only: install into a scratch directory outside the repo, symlink into the repo's gitignored `node_modules/` for testing, remove the symlinks before committing. Never add it to `package.json`.
- Confirmed by grep during plan authorship: `stat-tile`/`stat-grid`/`statTiles` appear only in `public/index.html`, `public/js/index.js`, and `public/css/styles.css` — safe to fully replace, nothing else in the codebase references them.

---

### Task 1: Masthead statement + ledger line

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/index.js`
- Modify: `public/css/styles.css:438-452` (replace `.stat-tile`/`.stat-grid` rules)

**Interfaces:**
- Produces: `masthead statement text` (computed in `index.js`, no exported function — internal to the page script, same pattern the file already uses for `renderStats`).
- Consumes: `apps` (array) and `stats` (`{total, interviews, offers, avgMatch}`) — both already fetched by the existing `load()` function, unchanged shape.

- [ ] **Step 1: Update the page header markup**

Find (`public/index.html`):
```html
    <div class="row between">
      <div>
        <h1>Application Tracker</h1>
        <p class="subtitle">Every application, its stage, and what's next.</p>
      </div>
      <button class="btn" id="newAppBtn">+ New application</button>
    </div>

    <div id="statTiles" class="stat-grid"></div>
```
Replace with:
```html
    <div class="row between">
      <div>
        <h1 id="mastheadStatement">Loading your applications…</h1>
      </div>
      <button class="btn" id="newAppBtn">+ New application</button>
    </div>

    <div id="statTiles" class="ledger-line"></div>
```

- [ ] **Step 2: Replace the stat-tile CSS with the ledger-line CSS**

Find (`public/css/styles.css:438-452`):
```css
.stat-tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 18px 20px; box-shadow: var(--shadow);
}
.stat-tile .row.between { margin-bottom: 14px; }
.stat-tile .stat-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
.stat-tile .stat-icon {
  width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--rc-surface-container); color: var(--rc-primary);
}
.stat-tile .stat-value { font-family: var(--font-display); font-size: 32px; font-weight: 700; line-height: 1; }
.stat-tile .stat-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 6px; }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
```
Replace with:
```css
.ledger-line {
  display: flex;
  flex-wrap: wrap;
  border-top: 2px solid var(--ink);
  border-bottom: 1px solid var(--border);
  margin-bottom: 28px;
}
.ledger-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 14px 24px 14px 0;
  margin-right: 24px;
}
.ledger-item + .ledger-item {
  border-left: 1px solid var(--border);
  padding-left: 24px;
}
.ledger-item .ledger-value {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
}
.ledger-item .ledger-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-soft);
}
@media (max-width: 700px) {
  .ledger-line { border-top-width: 1px; }
  .ledger-item { flex: 1 1 40%; margin-right: 0; padding: 10px 12px; }
  .ledger-item + .ledger-item { border-left: none; border-top: 1px solid var(--border); padding-left: 12px; }
}
```
(The narrow-viewport override drops the vertical dividers and heavier top rule in favor of a 2-column wrapped grid with horizontal dividers between wrapped rows — a straight 4-in-a-row layout with dividers doesn't hold up under ~375px width, this keeps the same information legible there instead of just letting it overflow.)

- [ ] **Step 3: Rewrite `renderStats()` to produce the ledger-line markup**

Find (`public/js/index.js:77-101`):
```js
function renderStats(apps, stats) {
  const interviewsActive = apps.filter((a) => a.stage === "interview").length;
  const offersPending = apps.filter((a) => a.stage === "offer").length;
  document.getElementById("statTiles").innerHTML = `
    <div class="stat-tile">
      <div class="row between"><span class="stat-label">Total</span><span class="stat-icon">${icon("list")}</span></div>
      <div class="stat-value">${stats.total}</div>
      <div class="stat-sub">Across every stage</div>
    </div>
    <div class="stat-tile">
      <div class="row between"><span class="stat-label">Interviews</span><span class="stat-icon">${icon("mail")}</span></div>
      <div class="stat-value">${stats.interviews}</div>
      <div class="stat-sub">${interviewsActive} active</div>
    </div>
    <div class="stat-tile">
      <div class="row between"><span class="stat-label">Offers</span><span class="stat-icon">${icon("sparkle")}</span></div>
      <div class="stat-value">${stats.offers}</div>
      <div class="stat-sub">${offersPending ? "Pending review" : "None yet"}</div>
    </div>
    <div class="stat-tile">
      <div class="row between"><span class="stat-label">Avg Match</span><span class="stat-icon">${icon("search")}</span></div>
      <div class="stat-value">${stats.avgMatch != null ? stats.avgMatch + "%" : "—"}</div>
      <div class="stat-sub">${stats.avgMatch != null ? (stats.avgMatch >= 80 ? "Solid alignment" : "Room to improve") : "Tailor a CV to see this"}</div>
    </div>`;
}
```
Replace with:
```js
function renderStats(apps, stats) {
  document.getElementById("statTiles").innerHTML = `
    <div class="ledger-item"><span class="ledger-value">${stats.total}</span><span class="ledger-label">Total</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.interviews}</span><span class="ledger-label">Interviews</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.offers}</span><span class="ledger-label">Offers</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.avgMatch != null ? stats.avgMatch + "%" : "—"}</span><span class="ledger-label">Avg match</span></div>`;
}
```
Note: this drops the `icon(...)` calls and the `interviewsActive`/`offersPending` locals that fed the old `.stat-sub` captions — the ledger line's single-line-per-item format doesn't have room for a caption, and the plan's Step 4 (masthead statement) is where that "how many are active" information now lives instead, at the page level rather than per-stat-tile.

- [ ] **Step 4: Add the masthead statement function and call it from `load()`**

Find (`public/js/index.js`, the `renderStats` function you just replaced in Step 3 — add this new function immediately after it):
```js
function renderStats(apps, stats) {
  document.getElementById("statTiles").innerHTML = `
    <div class="ledger-item"><span class="ledger-value">${stats.total}</span><span class="ledger-label">Total</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.interviews}</span><span class="ledger-label">Interviews</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.offers}</span><span class="ledger-label">Offers</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.avgMatch != null ? stats.avgMatch + "%" : "—"}</span><span class="ledger-label">Avg match</span></div>`;
}
```
becomes:
```js
function renderStats(apps, stats) {
  document.getElementById("statTiles").innerHTML = `
    <div class="ledger-item"><span class="ledger-value">${stats.total}</span><span class="ledger-label">Total</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.interviews}</span><span class="ledger-label">Interviews</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.offers}</span><span class="ledger-label">Offers</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.avgMatch != null ? stats.avgMatch + "%" : "—"}</span><span class="ledger-label">Avg match</span></div>`;
}

/** Computes the masthead <h1> text -- a real sentence describing current
 * state, not a static page title. Mirrors how an editorial masthead
 * states the day's actual news rather than a fixed banner. */
function renderMastheadStatement(apps, stats) {
  const el = document.getElementById("mastheadStatement");
  if (stats.total === 0) {
    el.textContent = "No applications tracked yet.";
    return;
  }
  const interviewsActive = apps.filter((a) => a.stage === "interview").length;
  const offersPending = apps.filter((a) => a.stage === "offer").length;

  let statement = `${stats.total} application${stats.total === 1 ? "" : "s"} tracked.`;
  if (interviewsActive > 0) {
    statement += ` ${interviewsActive} moving through interview${interviewsActive === 1 ? "" : "s"}.`;
  } else if (offersPending > 0) {
    statement += ` ${offersPending} offer${offersPending === 1 ? "" : "s"} on the table.`;
  }
  el.textContent = statement;
}
```

Find (`public/js/index.js`, inside `load()`):
```js
  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(apps, stats);
```
Replace with:
```js
  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(apps, stats);
  renderMastheadStatement(apps, stats);
```

- [ ] **Step 5: Lint**

Run: `npm run lint`. Expected: no errors. (This will also catch the now-unused `icon` import if it becomes unused — check `index.js`'s other code before assuming; `icon()` is very likely still used elsewhere in this file for the kanban cards' clock icon, so the import should stay, but let the linter be the actual check here rather than assuming.)

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/index.js public/css/styles.css
git commit -m "feat: replace Tracker stat tiles with a ledger line and computed masthead statement"
```

---

### Task 2: Visual verification (populated and empty states)

**Files:** None modified — verification-only task.

**Interfaces:**
- Consumes: Task 1's complete change.

- [ ] **Step 1: Install Playwright as scratch tooling**

```bash
mkdir -p /tmp/pw-verify-tracker
cd /tmp/pw-verify-tracker
npm init -y > /dev/null 2>&1
npm install playwright@1.62.1
npx playwright install chromium
cd -
ln -s /tmp/pw-verify-tracker/node_modules/playwright node_modules/playwright
ln -s /tmp/pw-verify-tracker/node_modules/playwright-core node_modules/playwright-core
```

- [ ] **Step 2: Start the dev server and confirm at least one test application exists**

```bash
npm run dev > /tmp/dev-verify-tracker.log 2>&1 &
disown
sleep 6
curl -s http://localhost:8787/api/applications | head -c 300
```
If this returns `[]` (no applications), create one so the populated-state screenshot is meaningful:
```bash
curl -s -X POST http://localhost:8787/api/applications -H "Content-Type: application/json" \
  -d '{"company":"Acme Corp","role":"Senior Engineer","stage":"interview","source":"manual"}' | head -c 200
```

- [ ] **Step 3: Screenshot the populated state**

```bash
cat > /tmp/screenshot-tracker.mjs << 'EOF'
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:8787/index.html");
await page.waitForLoadState("networkidle");
await page.screenshot({ path: "/tmp/screenshot-tracker-populated.png", fullPage: true });
console.log("populated:", errors.length, "errors");
if (errors.length) console.log(errors.join("\n"));

// Also capture the narrow-viewport responsive behavior from Step 2 of Task 1.
await page.setViewportSize({ width: 375, height: 800 });
await page.screenshot({ path: "/tmp/screenshot-tracker-narrow.png", fullPage: true });
console.log("narrow viewport screenshot saved");
await browser.close();
EOF
node /tmp/screenshot-tracker.mjs
```

- [ ] **Step 4: Read both screenshots and confirm the design landed correctly**

Use the Read tool on `/tmp/screenshot-tracker-populated.png` and `/tmp/screenshot-tracker-narrow.png`. Confirm:
- The masthead `<h1>` shows a real computed sentence (e.g. "1 application tracked. 1 moving through interviews." if you created the test application from Step 2 with `stage: "interview"`), in serif type, NOT the static "Application Tracker" title.
- The ledger line shows 4 number/label pairs in one row, divided by vertical rules, framed by a visibly heavier top rule and lighter bottom rule — NOT 4 separate rounded cards.
- At 375px width, the ledger line wraps into a legible 2-column layout with horizontal (not vertical) dividers, per Step 2's responsive override — confirm it doesn't look broken/overlapping.
- The kanban board below is visually unchanged from before this plan (still rounded cards, same colors) — confirming Task 1 didn't touch it.

- [ ] **Step 5: Screenshot and verify the empty state**

The empty-state masthead copy ("No applications tracked yet.") is a genuinely different code path (`stats.total === 0` branch in `renderMastheadStatement`) that the populated-state screenshot above cannot exercise. If your local DB has any applications (from Step 2 or otherwise), this step can't run against local `npm run dev` without deleting them, which risks losing real local data — instead, verify this branch by reading `public/js/index.js`'s `renderMastheadStatement` function directly against the code in Task 1 Step 4 and confirming the `stats.total === 0` branch is correct by inspection (this is a simple, three-line conditional — a careful code read is a legitimate substitute here, consistent with how the prior redesign plan's Task 3 handled a similarly hard-to-exercise dynamic state).

- [ ] **Step 6: Clean up scratch tooling**

```bash
rm -f node_modules/playwright node_modules/playwright-core
rm -f /tmp/screenshot-tracker-*.png /tmp/screenshot-tracker.mjs /tmp/dev-verify-tracker.log
```

- [ ] **Step 7: Final lint pass**

Run: `npm run lint`. Expected: no errors.

No commit for this task — it modifies no files.

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** both spec sections (Masthead statement, Ledger line) map onto Task 1's steps 1-4; the spec's two "Open questions" (responsive behavior, `renderStats` signature) are resolved here — responsive behavior gets an explicit `@media` override in Step 2, and `renderStats`'s signature is confirmed unchanged (`(apps, stats) -> void`, `apps` param is now unused inside the function body but kept for signature stability since `load()` calls it positionally alongside `renderMastheadStatement(apps, stats)` immediately after).
- **Type/consistency check:** `renderMastheadStatement(apps, stats)` takes the same two params in the same order as `renderStats(apps, stats)` — consistent calling convention, both called back-to-back in `load()`.
- **Non-goals honored:** kanban board, IA, dialog flow, API calls all unchanged — confirmed no task in this plan touches `.board`/`.app-card`/`.column` CSS or the `saveNewApp`/`newAppBtn` handlers.
