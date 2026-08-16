# Advocate Design Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin resume-copilot's existing multi-page app (Kanban tracker, tailoring studio, job search, CV store) to the "Advocate" design system from the Stitch mockups, and build the genuinely-missing pieces those mockups assume exist: an onboarding wizard, a Profile page, an application detail view with an activity timeline and reminders, match-score-aware job search results, keyword-highlighted resume tailoring, and a dedicated Outreach (cover letter / cold email) studio with tone control and saved templates.

**Architecture:** This is a re-skin + gap-fill of a working app, not a rebuild. The backend (Hono on Cloudflare Workers, D1, R2, one LLM-provider abstraction in `src/lib/llm.js`) already covers CVs, applications, tailoring, and document generation — most tasks below extend existing routes/tables rather than inventing new subsystems. The frontend is plain ES module JS with no bundler/framework and one shared `public/css/styles.css`; the redesign follows that same pattern (hand-written CSS using the Advocate design tokens as CSS custom properties, inline SVG icons instead of the mockups' Material Symbols font, Google Fonts `@import` for Plus Jakarta Sans/Inter instead of Tailwind CDN).

**Tech Stack:** Hono, Cloudflare Workers + D1 + R2, vanilla ES modules, hand-written CSS (no Tailwind, no build step for CSS/JS).

**Spec:** `/Users/tomassousa/Downloads/stitch_career_tailor_tracker/` — 6 Stitch mockup exports (`advocate_design_system/DESIGN.md` for tokens; `onboarding_top_nav/`, `dashboard_top_nav/`, `application_detail_view/`, `job_search_top_nav/`, `resume_studio_top_nav/`, `outreach_communication_studio/` each with `screen.png` + `code.html` for layout reference). Executors should open the relevant `screen.png` for their task before styling — this plan describes structure and gives real code, but the screenshot is the visual source of truth for spacing/alignment details not called out below.

## Global Constraints

- **No Tailwind, no new frontend framework.** The mockups' `code.html` files use Tailwind CDN + a generated config — do not port that. Translate the same design tokens into `:root` CSS custom properties in `public/css/styles.css`, following the existing hand-written-CSS convention already in that file.
- **No icon font.** The mockups use `Material Symbols Outlined` via a Google Fonts link. Use small inline SVG icons (24×24, `currentColor` stroke) instead — one extra font family (`Plus Jakarta Sans` + `Inter`) is enough of a new network dependency.
- **Fonts:** add `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap');` as the very first line of `public/css/styles.css` — this reaches every page without editing each HTML file's `<head>`.
- **Design tokens** (from `advocate_design_system/DESIGN.md`, copied verbatim): primary `#0050cb`, primary-container/action `#0066ff`, secondary (Action Indigo) `#4b41e1`, tertiary (success green) `#006645`/`#008259`, error `#ba1a1a`, surface `#f8f9ff`, surface-container-low `#eff4ff`, on-surface `#0b1c30`, on-surface-variant `#424656`, outline-variant `#c2c6d8`. Radius: buttons/inputs 8px (`0.5rem`), cards 12px (`0.75rem`... mockup calls it `rounded-lg` = 12px), pills/chips full. Type: headlines in Plus Jakarta Sans 600/700, body/labels in Inter.
- **No test framework exists in this repo** (`package.json` has no test script/runner). Verify backend tasks with `npm run lint` + `wrangler dev` + `curl`; verify UI tasks by running `npm run dev` and clicking through the actual flow in a browser, per the project's own testing convention — do not invent a test suite.
- **D1 has no migration runner.** `schema.sql` is applied directly via `npm run db:init` / `db:init:local`. New tables use `CREATE TABLE IF NOT EXISTS` (idempotent); the one new column on an existing table (`applications.match_score`) needs a one-time `ALTER TABLE` run by hand against local/remote — call this out explicitly in that task, don't silently assume a fresh DB.
- **Every new API route stays under `/api/*`**, which `src/index.js` already gates with `requireAuth()` — never add a route outside that prefix or with its own auth bypass.
- **Preserve the existing 7-stage pipeline** (`saved, applied, screening, interview, offer, rejected, withdrawn` in `src/lib/db.js`). The mockup's 3-column board (Applied / Interview / Offer) is a simplified illustration, not a schema to copy — keep all 7 stages, just restyle the columns/cards.
- **Escaping:** every new frontend render function must use the existing `escapeHtml()` / `safeUrl()` helpers from `public/js/app.js` for anything derived from user or LLM input — several LLM-sourced fields (job titles, URLs, generated document text) flow directly into `innerHTML` throughout this codebase already; keep that discipline.

---

## Task 1: Design tokens, typography, and shared component CSS

**Files:**
- Modify: `public/css/styles.css`

**Interfaces:**
- Produces: new CSS custom properties consumed by every later task — `--advocate-primary`, `--advocate-primary-container`, `--advocate-secondary`, `--advocate-success`, `--advocate-success-soft`, `--advocate-warn`, `--advocate-warn-soft`, `--advocate-danger`, `--advocate-danger-soft`, `--advocate-surface`, `--advocate-surface-container`, `--advocate-surface-container-low`, `--advocate-on-surface`, `--advocate-on-surface-variant`, `--advocate-outline-variant`, `--font-display` (redefined to Plus Jakarta Sans), `--font-body` (redefined to Inter). Also produces reusable classes: `.stat-tile`, `.stat-tile-icon`, `.status-chip`, `.status-chip.applied|interview|offer|rejected|saved|screening`, `.match-badge`, `.match-badge.high|mid|low`, `.icon` (inline-SVG sizing wrapper), `.avatar-circle`.

- [ ] **Step 1: Add the font import and Advocate token block**

At the very top of `public/css/styles.css`, before the existing `:root { ... }` block, add:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap');

:root {
  --advocate-primary: #0050cb;
  --advocate-primary-container: #0066ff;
  --advocate-secondary: #4b41e1;
  --advocate-success: #006645;
  --advocate-success-soft: #e1ffec;
  --advocate-warn: #a35a1e;
  --advocate-warn-soft: #fbe9d3;
  --advocate-danger: #ba1a1a;
  --advocate-danger-soft: #ffdad6;
  --advocate-surface: #f8f9ff;
  --advocate-surface-container: #e5eeff;
  --advocate-surface-container-low: #eff4ff;
  --advocate-surface-container-lowest: #ffffff;
  --advocate-on-surface: #0b1c30;
  --advocate-on-surface-variant: #424656;
  --advocate-outline-variant: #c2c6d8;
}
```

Leave the existing `:root { --bg: ...; }` block below it untouched for now — Task 2 repoints the existing tokens (`--bg`, `--surface`, `--ink`, `--accent`, etc.) at these new Advocate values so every page picks up the redesign without a page-by-page CSS rewrite.

- [ ] **Step 2: Repoint the existing semantic tokens at the Advocate palette**

Replace the existing `:root { ... }` block (the one with `--bg`, `--surface`, `--border`, `--ink`, etc. — currently lines 1-18 pre-Task-1) with:

```css
:root {
  --bg: var(--advocate-surface);
  --surface: var(--advocate-surface-container-lowest);
  --border: var(--advocate-outline-variant);
  --ink: var(--advocate-on-surface);
  --ink-soft: var(--advocate-on-surface-variant);
  --accent: var(--advocate-secondary);
  --accent-soft: #eeecff;
  --warn: var(--advocate-warn);
  --warn-soft: var(--advocate-warn-soft);
  --danger: var(--advocate-danger);
  --danger-soft: var(--advocate-danger-soft);
  --radius: 0.75rem;
  --shadow: 0 1px 2px rgba(0, 80, 203, 0.05), 0 1px 6px rgba(0, 80, 203, 0.05);
  --font-display: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-family: var(--font-body);
}
```

This keeps every existing rule in the file working unchanged (they all reference `--bg`, `--accent`, etc., not raw hex values) while switching the whole app to the Advocate palette and fonts in one place. Also change the `body` background rule (the one with `radial-gradient(...)`) to just `background: var(--bg);` — the dotted-paper texture matched the old serif aesthetic, not this one.

- [ ] **Step 3: Add status chip, match badge, stat tile, and avatar component CSS**

Append to the end of `public/css/styles.css`:

```css
/* --- Advocate component primitives -------------------------------------- */

.icon { display: inline-flex; width: 20px; height: 20px; flex-shrink: 0; }
.icon svg { width: 100%; height: 100%; }

.avatar-circle {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--advocate-primary-container); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 14px;
  flex-shrink: 0;
}

.status-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  background: var(--advocate-surface-container); color: var(--advocate-on-surface-variant);
}
.status-chip.saved     { background: var(--advocate-surface-container); color: var(--advocate-on-surface-variant); }
.status-chip.applied   { background: #dae1ff; color: var(--advocate-primary); }
.status-chip.screening { background: #dae1ff; color: var(--advocate-primary); }
.status-chip.interview { background: var(--advocate-warn-soft); color: var(--advocate-warn); }
.status-chip.offer     { background: var(--advocate-success-soft); color: var(--advocate-success); }
.status-chip.rejected,
.status-chip.withdrawn { background: var(--danger-soft); color: var(--danger); }

.match-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 700;
}
.match-badge.high { background: var(--advocate-success-soft); color: var(--advocate-success); }
.match-badge.mid  { background: #dae1ff; color: var(--advocate-primary); }
.match-badge.low  { background: var(--danger-soft); color: var(--danger); }

.stat-tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 18px 20px; box-shadow: var(--shadow);
}
.stat-tile .row.between { margin-bottom: 14px; }
.stat-tile .stat-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
.stat-tile .stat-icon {
  width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--advocate-surface-container); color: var(--advocate-primary);
}
.stat-tile .stat-value { font-family: var(--font-display); font-size: 32px; font-weight: 700; line-height: 1; }
.stat-tile .stat-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 6px; }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
```

- [ ] **Step 4: Verify with lint and a visual smoke check**

Run: `npm run lint`
Expected: no errors (CSS isn't linted by this project's ESLint config, so this just guards against having broken any co-located JS — it should be a no-op here).

Run: `npm run dev`, open `http://localhost:8787/index.html` in a browser.
Expected: page background is a very light blue (`#f8f9ff`), headings render in a rounded sans-serif (Plus Jakarta Sans), body text in Inter, buttons are indigo (`#4b41e1`) — the overall page reads noticeably "bluer/cooler" than before even though no HTML structure changed yet.

- [ ] **Step 5: Commit**

```bash
git add public/css/styles.css
git commit -m "style: switch design tokens and fonts to the Advocate palette"
```

---

## Task 2: Shared icon set and Advocate top nav

**Files:**
- Create: `public/js/icons.js`
- Modify: `public/js/app.js` (`renderNav`, lines ~96-129)
- Modify: `public/css/styles.css` (append nav styles)

**Interfaces:**
- Produces: `ICONS` object of `{ name: svgString }` exported from `public/js/icons.js`, with at least `search, edit, list, user, bell, gear, plus, upload, file, mail, calendar, checkCircle, chevronRight, folder, download, sparkle, clock, mapPin, briefcase, dollar` keys. Consumed by every later frontend task instead of emoji/text glyphs.
- Consumes: `escapeHtml` from `./app.js` (unchanged import already used by every page).
- Modifies `renderNav(active)` signature: unchanged (`renderNav(activeHref)`), but the DOM it renders changes shape — later tasks that touch `#topnav` content don't need to; they only call `renderNav()` once at module load like today.

- [ ] **Step 1: Create the shared icon module**

```js
// public/js/icons.js
// Small inline-SVG icon set (24x24 viewBox, stroke=currentColor) standing in
// for the mockups' Material Symbols icon font, so the app doesn't take on an
// extra font-loading dependency for ~15 glyphs.

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  upload: svg('<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>'),
  file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>'),
  chevronRight: svg('<path d="M9 18l6-6-6-6"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  download: svg('<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  mapPin: svg('<path d="M12 21s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>'),
  briefcase: svg('<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  dollar: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5 1.3 2 3 2.5c1.7.5 3 1.1 3 2.5s-1.3 2.5-3 2.5-3-1.1-3-2.5"/>'),
};

export function icon(name, extraClass = "") {
  return `<span class="icon ${extraClass}">${ICONS[name] || ""}</span>`;
}
```

- [ ] **Step 2: Rewrite `renderNav` to the Advocate top nav**

Replace `renderNav` in `public/js/app.js` (currently lines 96-129):

```js
import { icon } from "./icons.js";

export function renderNav(active) {
  const links = [
    ["job-search.html", "Search", "search"],
    ["tailor.html", "Tailor", "edit"],
    ["index.html", "Applications", "list"],
    ["profile.html", "Profile", "user"],
  ];
  const el = document.getElementById("topnav");
  if (!el) return;
  el.innerHTML = `
    <header class="topbar">
      <a href="index.html" class="brand"><span class="brand-mark">A</span> Advocate</a>
      <nav class="tabs">
        ${links
          .map(
            ([href, label, iconName]) =>
              `<a href="${href}" class="${active === href ? "active" : ""}">${icon(iconName)}${label}</a>`
          )
          .join("")}
      </nav>
      <div class="row" style="gap: 10px;">
        <a class="btn" href="index.html?new=1" id="topnavNewApp">${icon("plus")} New Application</a>
        <button class="icon-btn" title="Notifications" disabled>${icon("bell")}</button>
        <a class="icon-btn" href="profile.html" title="Settings">${icon("gear")}</a>
        <span class="avatar-circle" id="whoamiAvatar">?</span>
      </div>
    </header>`;

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    location.href = "/cdn-cgi/access/logout";
  });

  fetch("/api/auth/me")
    .then((r) => r.json())
    .then(({ email }) => {
      const avatar = document.getElementById("whoamiAvatar");
      if (email && avatar) avatar.textContent = email[0].toUpperCase();
      if (email && avatar) avatar.title = email;
    })
    .catch(() => {});
}
```

Note the old `#logoutBtn` element no longer exists in the markup — logging out now happens from the Profile page (Task 9 adds a "Log out" action there), so the `?.addEventListener` guard above is intentional, not dead code to clean up later.

- [ ] **Step 3: Add top nav CSS**

Append to `public/css/styles.css`:

```css
header.topbar { padding: 12px 28px; gap: 24px; }
.brand { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 700; font-size: 18px; color: var(--advocate-primary); text-decoration: none; }
.brand-mark {
  width: 28px; height: 28px; border-radius: 8px; background: var(--advocate-primary-container); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 14px;
}
nav.tabs { flex: 1; display: flex; gap: 4px; }
nav.tabs a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; text-decoration: none; color: var(--ink-soft); font-size: 14px; font-weight: 600; }
nav.tabs a:hover { background: var(--advocate-surface-container-low); }
nav.tabs a.active { background: var(--advocate-surface-container); color: var(--advocate-primary); }
.icon-btn {
  width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.icon-btn:hover { background: var(--advocate-surface-container-low); }
.icon-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, open any page (e.g. `index.html`).
Expected: top nav shows "Advocate" brand mark, four tabs with icons (Search/Tailor/Applications/Profile), a filled "+ New Application" button, a bell and gear icon button, and an avatar circle with your Access-authenticated email's first letter. Clicking each tab navigates and highlights correctly (`profile.html` won't exist until Task 9 — expect a 404 for that one link until then).

- [ ] **Step 5: Commit**

```bash
git add public/js/icons.js public/js/app.js public/css/styles.css
git commit -m "feat: replace top nav with the Advocate design's icon nav"
```

---

## Task 3: Schema migration — match score, activity events, templates

**Files:**
- Modify: `schema.sql`
- Modify: `src/lib/db.js`

**Interfaces:**
- Produces (from `src/lib/db.js`, consumed by Tasks 4, 7, 8, 11, 14):
  - `appFromRow` gains `matchScore: r.match_score ?? null` in its returned object.
  - `updateApplication(db, id, patch)` — `patch.matchScore` (number or null) is now a recognized key, persisted to the new `match_score` column.
  - `listActivity(db, applicationId) -> Promise<Array<{id, applicationId, type, title, detail, occurredAt, createdAt}>>`
  - `addActivity(db, {id, applicationId, type, title, detail, occurredAt, createdAt}) -> Promise<activity>`
  - `getApplicationStats(db) -> Promise<{total, interviews, interviewsActive, offers, offersPending, avgMatch}>`
  - `listTemplates(db) -> Promise<Array<template>>`, `getTemplate(db, id) -> Promise<template|null>`, `createTemplate(db, {id, kind, label, tone, targetRoleCompany, content, createdAt}) -> Promise<template>`, `touchTemplate(db, id) -> Promise<template>` (bumps `last_used_at`), `deleteTemplate(db, id) -> Promise<void>`.

- [ ] **Step 1: Add the new column and tables to `schema.sql`**

In `schema.sql`, add `match_score INTEGER` to the `applications` table definition, right after `comp_estimate`:

```sql
  comp_estimate    TEXT NOT NULL DEFAULT '',
  match_score      INTEGER,
  notes            TEXT NOT NULL DEFAULT '',
```

Then, after the `documents` table block, add two new tables:

```sql
-- Auto-logged timeline entries (created, stage changes, tailoring runs,
-- document generation) plus user-added reminders -- all one append-only
-- table so the Application Detail view's Activity feed is a single ordered
-- query instead of a union across several sources.
CREATE TABLE IF NOT EXISTS activity_events (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           TEXT NOT NULL, -- 'created' | 'stage_change' | 'tailored' | 'document' | 'reminder'
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  occurred_at    TEXT NOT NULL, -- reminders are future-dated; everything else = created_at
  created_at     TEXT NOT NULL
);

-- Reusable cover-letter/cold-email drafts saved from the Outreach Studio,
-- independent of any single application (unlike `documents`, whose
-- application_id is NOT NULL).
CREATE TABLE IF NOT EXISTS templates (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL, -- 'coverLetter' | 'coldEmail'
  label               TEXT NOT NULL,
  tone                TEXT NOT NULL DEFAULT 'professional',
  target_role_company TEXT NOT NULL DEFAULT '',
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  last_used_at        TEXT NOT NULL
);
```

And add matching indexes next to the existing `CREATE INDEX` block:

```sql
CREATE INDEX IF NOT EXISTS idx_activity_app  ON activity_events(application_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_templates_used ON templates(last_used_at DESC);
```

- [ ] **Step 2: Apply the migration to the local D1 database**

The two new tables are picked up by the existing idempotent `db:init:local` script. The new `match_score` column on an *existing* table needs a one-time `ALTER TABLE` since SQLite's `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` form and re-running the full `CREATE TABLE applications (...)` would fail against an already-existing table.

Run:
```bash
npx wrangler d1 execute resume-copilot --local --command="ALTER TABLE applications ADD COLUMN match_score INTEGER;"
npm run db:init:local
```
Expected: the `ALTER TABLE` succeeds once (re-running it later would error `duplicate column name` — that's fine, it only needs to run once per database); `db:init:local` reports the two new tables created (or no-ops if already present).

Note for whoever deploys this to the remote/production D1 database later: run the same `ALTER TABLE` (with `--remote` instead of `--local`) once before `npm run db:init`, since production already has an `applications` table without this column.

- [ ] **Step 3: Add `matchScore` to `appFromRow` and `PATCHABLE`**

In `src/lib/db.js`, update `appFromRow` (around line 31-48) to add one field:

```js
const appFromRow = (r) =>
  r && {
    id: r.id,
    company: r.company,
    role: r.role,
    location: r.location,
    link: r.link,
    source: r.source,
    jobPostText: r.job_post_text,
    cvId: r.cv_id,
    stage: r.stage,
    stageEnteredAt: r.stage_entered_at,
    appliedAt: r.applied_at,
    compEstimate: r.comp_estimate,
    matchScore: r.match_score ?? null,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
```

And add `matchScore: "match_score"` to the `PATCHABLE` map (around line 175-182):

```js
const PATCHABLE = {
  notes: "notes",
  link: "link",
  location: "location",
  compEstimate: "comp_estimate",
  matchScore: "match_score",
  cvId: "cv_id",
  jobPostText: "job_post_text",
};
```

- [ ] **Step 4: Add activity, stats, and template functions to `db.js`**

Append to `src/lib/db.js`, after the `deleteDocument` function:

```js
// --- Activity timeline -------------------------------------------------------

const activityFromRow = (r) =>
  r && {
    id: r.id,
    applicationId: r.application_id,
    type: r.type,
    title: r.title,
    detail: r.detail,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };

export async function listActivity(db, applicationId) {
  const { results } = await db
    .prepare(
      "SELECT * FROM activity_events WHERE application_id = ? ORDER BY occurred_at DESC"
    )
    .bind(applicationId)
    .all();
  return results.map(activityFromRow);
}

export async function addActivity(db, ev) {
  await db
    .prepare(
      `INSERT INTO activity_events (id, application_id, type, title, detail, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(ev.id, ev.applicationId, ev.type, ev.title, ev.detail || "", ev.occurredAt, ev.createdAt)
    .run();
  return activityFromRow({
    id: ev.id, application_id: ev.applicationId, type: ev.type, title: ev.title,
    detail: ev.detail || "", occurred_at: ev.occurredAt, created_at: ev.createdAt,
  });
}

// --- Dashboard stats ---------------------------------------------------------

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

// --- Templates (saved Outreach Studio drafts) --------------------------------

const templateFromRow = (r) =>
  r && {
    id: r.id,
    kind: r.kind,
    label: r.label,
    tone: r.tone,
    targetRoleCompany: r.target_role_company,
    content: r.content,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };

export async function listTemplates(db) {
  const { results } = await db
    .prepare("SELECT * FROM templates ORDER BY last_used_at DESC")
    .all();
  return results.map(templateFromRow);
}

export async function getTemplate(db, id) {
  return templateFromRow(
    await db.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first()
  );
}

export async function createTemplate(db, t) {
  await db
    .prepare(
      `INSERT INTO templates (id, kind, label, tone, target_role_company, content, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(t.id, t.kind, t.label, t.tone, t.targetRoleCompany || "", t.content, t.createdAt, t.createdAt)
    .run();
  return getTemplate(db, t.id);
}

export async function touchTemplate(db, id) {
  await db
    .prepare("UPDATE templates SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
  return getTemplate(db, id);
}

export async function deleteTemplate(db, id) {
  await db.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();
}
```

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: no errors.

Run:
```bash
npx wrangler d1 execute resume-copilot --local --command="SELECT match_score FROM applications LIMIT 1;"
npx wrangler d1 execute resume-copilot --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('activity_events','templates');"
```
Expected: first command returns a column (empty result set is fine, it's proving the column exists, not that rows exist); second command lists both `activity_events` and `templates`.

- [ ] **Step 6: Commit**

```bash
git add schema.sql src/lib/db.js
git commit -m "feat: add match_score column, activity_events, and templates tables"
```

---

## Task 4: Persist match score and auto-log activity on applications

**Files:**
- Modify: `src/routes/applications.js`

**Interfaces:**
- Consumes: `db.addActivity`, `db.updateApplication` (now accepts `matchScore`), `db.getApplicationStats`, `db.listActivity` from Task 3.
- Produces: `POST /api/applications` now also writes a `created` activity row. `PATCH /api/applications/:id` now also writes a `stage_change` activity row when `stage` changes. `POST /api/applications/:id/tailor` now parses a `Match Score` out of the analysis text, persists it to `matchScore`, and writes a `tailored` activity row. New routes: `GET /api/applications/stats`, `GET /api/applications/:id/activity`, `POST /api/applications/:id/activity` (for manually-added reminders).

- [ ] **Step 1: Add a match-score parser helper**

At the top of `src/routes/applications.js`, after the imports, add:

```js
// The tailoring prompt asks the model for "## Match Analysis" containing a
// score out of 100 in prose (e.g. "Match score: 85/100" or "Match Score: 85%").
// This is a best-effort scrape of that number for the dashboard/detail-view
// badges -- if the model phrases it differently, matchScore stays null and
// the UI simply doesn't show a badge, it never blocks tailoring itself.
function parseMatchScore(analysisText) {
  const m = analysisText.match(/match\s*score[:\s]*[^\d]{0,10}(\d{1,3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}
```

- [ ] **Step 2: Log activity on create, patch stage change, and tailor**

In `router.post("/", ...)` (application create), after `const app = await db.createApplication(...)` and before `return c.json(app, 201);`, add:

```js
  await db.addActivity(c.env.DB, {
    id: crypto.randomUUID(),
    applicationId: app.id,
    type: "created",
    title: "Application created",
    detail: b.source === "job-search" ? "Started from Job Search" : "Added manually",
    occurredAt: now,
    createdAt: now,
  });
```

In `router.patch("/:id", ...)`, after computing `patch` and before `return c.json(await db.updateApplication(c.env.DB, id, patch));`, add:

```js
  const updated = await db.updateApplication(c.env.DB, id, patch);
  if (patch.stage !== undefined) {
    const now2 = new Date().toISOString();
    await db.addActivity(c.env.DB, {
      id: crypto.randomUUID(),
      applicationId: id,
      type: "stage_change",
      title: `Moved to ${patch.stage[0].toUpperCase()}${patch.stage.slice(1)}`,
      detail: "",
      occurredAt: now2,
      createdAt: now2,
    });
  }
  return c.json(updated);
```

(Remove the old bare `return c.json(await db.updateApplication(...))` line it replaces.)

In `router.post("/:id/tailor", ...)`, after `const { text } = await runTask(...)` and the existing `tailoredText` extraction, before the `let newCv = null;` block, add:

```js
  const matchScore = parseMatchScore(text);
```

Then, right after the existing `if (tailoredText) { ... }` block that creates `newCv` and calls `db.updateApplication`, extend that same `updateApplication` call to also set the score, and log the activity. Change:

```js
    await db.updateApplication(c.env.DB, id, { cvId: newCv.id });
```
to:
```js
    await db.updateApplication(c.env.DB, id, { cvId: newCv.id, matchScore });
```

and immediately after that block (still inside the route handler, before `return c.json({ analysis: text, tailoredCv: newCv });`), add:

```js
  if (!newCv && matchScore != null) {
    // No structured CV came back, but a score did -- still worth recording.
    await db.updateApplication(c.env.DB, id, { matchScore });
  }
  const tailoredAt = new Date().toISOString();
  await db.addActivity(c.env.DB, {
    id: crypto.randomUUID(),
    applicationId: id,
    type: "tailored",
    title: "Materials tailored",
    detail: matchScore != null ? `Match score ${matchScore}%` : "",
    occurredAt: tailoredAt,
    createdAt: tailoredAt,
  });
```

- [ ] **Step 3: Add the stats, activity-list, and add-reminder routes**

Add these three routes to `src/routes/applications.js`, before `export default router;`. The stats route must be registered before `/:id` would otherwise shadow it — but since it's a distinct literal path (`/stats`) and Hono matches literal segments before params, ordering relative to `/:id` doesn't matter here; still, place it near the top of the file for readability, right after the `router.get("/", ...)` list route:

```js
router.get("/stats", async (c) => c.json(await db.getApplicationStats(c.env.DB)));

router.get("/:id/activity", async (c) => {
  const app = await db.getApplication(c.env.DB, c.req.param("id"));
  if (!app) return c.json({ error: "Application not found" }, 404);
  return c.json(await db.listActivity(c.env.DB, app.id));
});

router.post("/:id/activity", async (c) => {
  const id = c.req.param("id");
  const app = await db.getApplication(c.env.DB, id);
  if (!app) return c.json({ error: "Application not found" }, 404);

  const { title, detail, occurredAt } = await c.req.json();
  if (!title?.trim()) return c.json({ error: "title is required" }, 400);

  const now = new Date().toISOString();
  const ev = await db.addActivity(c.env.DB, {
    id: crypto.randomUUID(),
    applicationId: id,
    type: "reminder",
    title: title.trim(),
    detail: detail || "",
    occurredAt: occurredAt || now,
    createdAt: now,
  });
  return c.json(ev, 201);
});
```

Note `router.get("/stats", ...)` must come before `router.get("/:id", ...)` in file order — Hono still matches literal routes registered later ahead of param routes registered earlier by specificity, but keeping the literal route physically above the param route in the file avoids relying on that and matches how this file already orders `GET /` before `GET /:id`.

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, then in another terminal:
```bash
curl -s localhost:8787/api/applications/stats | jq
```
Expected: `{"total": N, "interviews": N, "offers": N, "avgMatch": null-or-number}` (requires `SKIP_AUTH=1` in `.dev.vars` for a bare curl to pass auth locally — check `.dev.vars` for the existing local-dev auth bypass this project already uses; if absent, test via the browser's authenticated session using devtools' Network tab instead).

Create a test application, PATCH its stage, and confirm via `curl localhost:8787/api/applications/<id>/activity` that `created` and `stage_change` rows appear in descending `occurredAt` order.

- [ ] **Step 5: Commit**

```bash
git add src/routes/applications.js
git commit -m "feat: persist match score and auto-log application activity"
```

---

## Task 5: Match score in job search results

**Files:**
- Modify: `src/routes/jobsearch.js`

**Interfaces:**
- Produces: the `POST /api/jobsearch/search` response's `text` field's fenced `\`\`\`JOBS` block now includes a `matchScore` (0-100 integer) per job, consumed by Task 12's frontend render.
- Consumes: nothing new — same `runWebSearchTask` contract.

- [ ] **Step 1: Extend the JSON schema requested in the prompt**

In `src/routes/jobsearch.js`, change the JSON-shape sentence inside the `prompt` template (around line 39-41) from:

```js
    `with \`\`\`. The "url" must be a real URL from your search results -- omit a ` +
    `job from the JSON entirely rather than inventing a URL.`;
```

to:

```js
    `with \`\`\`. Each item must also include "matchScore": an integer 0-100 ` +
    `estimating how well this posting fits the candidate's CV (skills, ` +
    `seniority, domain overlap) -- the same scale used elsewhere for match ` +
    `scoring. The "url" must be a real URL from your search results -- omit a ` +
    `job from the JSON entirely rather than inventing a URL.`;
```

And update the shape spec a few lines above it (the sentence starting `where each item is exactly:`) to include the new field:

```js
    `jobs, same order) inside a fenced block starting with \`\`\`JOBS and ending ` +
    `with \`\`\`, where each item is exactly: {"title": string, "company": string, ` +
    `"location": string, "url": string, "compEstimate": string, "matchScore": ` +
    `number, "fitNote": string}. The "url" must be a real URL from your search ` +
    `results -- omit a job from the JSON entirely rather than inventing a URL.`;
```

(This replaces the two separate edits above with one coherent block — apply it as a single edit to that template literal, keeping everything else in the prompt unchanged.)

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, perform a real job search from the UI (needs a live LLM provider key configured), and check the raw response in devtools' Network tab for `/api/jobsearch/search`.
Expected: the `\`\`\`JOBS` block's entries each have a `matchScore` field with a plausible 0-100 number. If the model occasionally omits it, that's expected best-effort behavior — Task 12's frontend must handle a missing `matchScore` (render no badge, not `undefined%`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/jobsearch.js
git commit -m "feat: request a per-job match score from job search"
```

---

## Task 6: Tone support in document generation

**Files:**
- Modify: `src/routes/documents.js`

**Interfaces:**
- Produces: `POST /api/applications/:id/documents` now accepts an optional `tone` field (`"professional" | "casual" | "confident" | "referral"`), appended to the generation prompt when present. Behavior is unchanged when `tone` is omitted.

- [ ] **Step 1: Add a tone-to-instruction map and wire it into the prompt**

In `src/routes/documents.js`, after the `DOC_TYPES` object and before `export const DOC_TYPE_KEYS`, add:

```js
const TONE_INSTRUCTIONS = {
  professional: "Use a polished, professional tone.",
  casual: "Use a warm, casual, conversational tone -- still competent, just less formal.",
  confident: "Use a confident, assertive tone that leads with impact and results.",
  referral: "Write as if referred by a mutual contact -- open by naming that connection as the reason you're reaching out.",
};
```

In `router.post("/", ...)`, change the destructure from:
```js
  const { type, extraNotes } = await c.req.json();
```
to:
```js
  const { type, extraNotes, tone } = await c.req.json();
```

Then, in the `prompt` template, after the line building `(extraNotes ? ... : "")`, append the tone line:

```js
  const prompt =
    `Task: ${docType.instruction}\n\n` +
    `Company: ${app.company}\nRole: ${app.role}\n` +
    `Location: ${app.location || "n/a"}\n\n` +
    `Job posting:\n"""\n${app.jobPostText || "(not provided)"}\n"""\n\n` +
    `Candidate's CV:\n"""\n${cv.content}\n"""\n` +
    (extraNotes ? `\nAdditional context from the candidate: ${extraNotes}` : "") +
    (TONE_INSTRUCTIONS[tone] ? `\n${TONE_INSTRUCTIONS[tone]}` : "");
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, then:
```bash
curl -s -X POST localhost:8787/api/applications/<id>/documents \
  -H "content-type: application/json" \
  -d '{"type":"coverLetter","tone":"casual"}'
```
Expected: 201 with generated content that reads noticeably more casual than the default professional tone (manual read, not automatable).

- [ ] **Step 3: Commit**

```bash
git add src/routes/documents.js
git commit -m "feat: accept a tone parameter for generated documents"
```

---

## Task 7: Standalone outreach generation endpoint

**Files:**
- Create: `src/routes/outreach.js`
- Modify: `src/index.js` (mount the new router)

**Interfaces:**
- Produces: `POST /api/outreach/generate` — body `{ type: "coverLetter" | "coldEmail", targetRoleCompany: string, tone?: string, cvId?: string }`, returns `{ content: string }`. Unlike `documents.js`, this doesn't require an existing tracked application — it's for the Outreach Studio (Task 14), which the mockup shows reachable independent of any specific application.
- Consumes: `db.resolveCv`, `buildSkillPrompt`, `SKILL_ROUTES.coverLetter` / `SKILL_ROUTES.coldEmail`, `runTask` — same building blocks `documents.js` already uses.

- [ ] **Step 1: Write the route**

```js
// src/routes/outreach.js
//
// Generates a cover letter or cold email from just a target role/company and
// a tone, without requiring a tracked application first -- backs the
// Outreach Studio, which the design lets a user open straight from the
// Tailor tab to draft something before (or without ever) creating an
// application for it.

import { Hono } from "hono";
import * as db from "../lib/db.js";
import { buildSkillPrompt, SKILL_ROUTES } from "../lib/skills.js";
import { runTask } from "../lib/llm.js";

const router = new Hono();

const KIND_SKILLS = {
  coverLetter: SKILL_ROUTES.coverLetter,
  coldEmail: SKILL_ROUTES.coldEmail,
};

const TONE_INSTRUCTIONS = {
  professional: "Use a polished, professional tone.",
  casual: "Use a warm, casual, conversational tone -- still competent, just less formal.",
  confident: "Use a confident, assertive tone that leads with impact and results.",
  referral: "Write as if referred by a mutual contact -- open by naming that connection as the reason you're reaching out.",
};

router.post("/generate", async (c) => {
  const { type, targetRoleCompany, tone, cvId } = await c.req.json();

  const skills = KIND_SKILLS[type];
  if (!skills) return c.json({ error: `Unknown outreach type "${type}"` }, 400);
  if (!targetRoleCompany?.trim())
    return c.json({ error: "targetRoleCompany is required" }, 400);

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const stable =
    `You are a job-application copilot. Follow the skill guidance below ` +
    `precisely, and never fabricate facts, dates, or achievements that aren't ` +
    `in the candidate's CV.\n\n` +
    buildSkillPrompt(skills);

  const instruction =
    type === "coverLetter"
      ? "Write a complete, ready-to-send cover letter for this specific role and company."
      : "Write a short, specific cold outreach email to a hiring manager or founder at this company about this role.";

  const prompt =
    `Task: ${instruction}\n\n` +
    `Target role / company: ${targetRoleCompany}\n\n` +
    `Candidate's CV:\n"""\n${cv.content}\n"""\n` +
    (TONE_INSTRUCTIONS[tone] ? `\n${TONE_INSTRUCTIONS[tone]}` : "");

  const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 8000 });
  return c.json({ content: text });
});

export default router;
```

- [ ] **Step 2: Mount it**

In `src/index.js`, add the import next to the other route imports:

```js
import outreachRouter from "./routes/outreach.js";
```

And mount it next to the other `app.route(...)` calls:

```js
app.route("/api/outreach", outreachRouter);
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, then:
```bash
curl -s -X POST localhost:8787/api/outreach/generate \
  -H "content-type: application/json" \
  -d '{"type":"coldEmail","targetRoleCompany":"Senior Designer at Acme Corp","tone":"confident"}'
```
Expected: `{"content": "..."}` with a cold email addressed to that role/company (requires at least one CV to exist in the local DB and a working LLM provider key).

- [ ] **Step 4: Commit**

```bash
git add src/routes/outreach.js src/index.js
git commit -m "feat: add standalone outreach generation endpoint"
```

---

## Task 8: Templates CRUD API

**Files:**
- Create: `src/routes/templates.js`
- Modify: `src/index.js` (mount the new router)

**Interfaces:**
- Produces: `GET /api/templates`, `POST /api/templates` (body `{kind, label, tone, targetRoleCompany, content}` → 201), `POST /api/templates/:id/use` (bumps `lastUsedAt`, returns the template — called when a saved template is reopened into the editor), `DELETE /api/templates/:id`.

- [ ] **Step 1: Write the route**

```js
// src/routes/templates.js
//
// CRUD for Outreach Studio's "Saved Templates" -- cover-letter/cold-email
// drafts kept independent of any single application (see schema.sql's
// `templates` table for why this isn't just another `documents` row).

import { Hono } from "hono";
import * as db from "../lib/db.js";

const router = new Hono();

router.get("/", async (c) => c.json(await db.listTemplates(c.env.DB)));

router.post("/", async (c) => {
  const { kind, label, tone, targetRoleCompany, content } = await c.req.json();
  if (kind !== "coverLetter" && kind !== "coldEmail")
    return c.json({ error: 'kind must be "coverLetter" or "coldEmail"' }, 400);
  if (!label?.trim()) return c.json({ error: "label is required" }, 400);
  if (!content?.trim()) return c.json({ error: "content is required" }, 400);

  const template = await db.createTemplate(c.env.DB, {
    id: crypto.randomUUID(),
    kind,
    label: label.trim(),
    tone: tone || "professional",
    targetRoleCompany: targetRoleCompany || "",
    content,
    createdAt: new Date().toISOString(),
  });
  return c.json(template, 201);
});

router.post("/:id/use", async (c) => {
  const template = await db.getTemplate(c.env.DB, c.req.param("id"));
  if (!template) return c.json({ error: "Template not found" }, 404);
  return c.json(await db.touchTemplate(c.env.DB, template.id));
});

router.delete("/:id", async (c) => {
  await db.deleteTemplate(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});

export default router;
```

- [ ] **Step 2: Mount it**

In `src/index.js`, add:

```js
import templatesRouter from "./routes/templates.js";
```
and
```js
app.route("/api/templates", templatesRouter);
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, then:
```bash
curl -s -X POST localhost:8787/api/templates \
  -H "content-type: application/json" \
  -d '{"kind":"coverLetter","label":"Standard Tech Cover","content":"Dear Hiring Manager..."}'
curl -s localhost:8787/api/templates | jq
```
Expected: POST returns 201 with the created template (`lastUsedAt` equal to `createdAt`); GET returns an array containing it.

- [ ] **Step 4: Commit**

```bash
git add src/routes/templates.js src/index.js
git commit -m "feat: add templates CRUD API for saved outreach drafts"
```

---

## Task 9: Onboarding wizard + Profile page

**Files:**
- Create: `public/profile.html`
- Create: `public/js/profile.js`

**Interfaces:**
- Consumes: `api`, `escapeHtml`, `renderNav`, `showError`, `ensureCvsOrEmptyState` pattern (but inverted — this page IS the empty-state destination) from `app.js`; `icon` from `icons.js`; `POST /api/cvs`, `POST /api/cvs/upload`, `GET/PUT /api/profile` (existing); `GET /api/cvs` to detect first-run.
- Produces: a page that shows a 3-step onboarding wizard when the user has zero CVs, and a normal profile/settings view once they have at least one CV. Every other page's `renderNav()` already links here as of Task 2.

- [ ] **Step 1: Write `public/profile.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Profile · Advocate</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <div id="topnav"></div>
  <main id="profileMain"></main>
  <script type="module" src="js/profile.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the onboarding wizard + settled-profile view in `public/js/profile.js`**

```js
import { api, escapeHtml, renderNav, showError } from "./app.js";
import { icon } from "./icons.js";

renderNav("profile.html");

const main = document.getElementById("profileMain");
let step = 1;

async function init() {
  const cvs = await api("/cvs").catch(() => []);
  if (cvs.length === 0) renderOnboarding();
  else renderSettled(cvs);
}

// --- Step 1/3: onboarding wizard (no CV yet) --------------------------------

function renderOnboarding() {
  main.innerHTML = `
    <div class="card" style="max-width: 640px; margin: 40px auto; padding: 0; overflow: hidden;">
      <div style="padding: 24px 28px 20px; border-bottom: 1px solid var(--border);">
        <div class="row between">
          <span class="pill">Step ${step} of 3</span>
          <div class="row" style="gap: 4px;">
            ${[1, 2, 3].map((n) => `<span style="width:32px;height:4px;border-radius:2px;background:${n <= step ? "var(--advocate-primary)" : "var(--advocate-outline-variant)"};"></span>`).join("")}
          </div>
        </div>
        <h1 id="stepTitle" style="margin-top: 14px;"></h1>
        <p class="subtitle" id="stepSubtitle" style="margin-bottom: 0;"></p>
      </div>
      <div style="padding: 28px;" id="stepBody"></div>
      <div class="row between" style="padding: 16px 28px; border-top: 1px solid var(--border); background: var(--advocate-surface-container-low);">
        <button class="btn secondary" id="backBtn" ${step === 1 ? "disabled" : ""}>Back</button>
        <button class="btn secondary" id="skipBtn">Skip for now</button>
      </div>
    </div>`;

  document.getElementById("backBtn").onclick = () => { step = Math.max(1, step - 1); renderOnboarding(); };
  document.getElementById("skipBtn").onclick = () => { step = 3; renderOnboarding(); };

  if (step === 1) renderStep1();
  else if (step === 2) renderStep2();
  else renderStep3();
}

function renderStep1() {
  document.getElementById("stepTitle").textContent = "Welcome to Advocate. Let's build your profile.";
  document.getElementById("stepSubtitle").textContent = "We'll use this information to tailor your resume and find the perfect match.";
  document.getElementById("stepBody").innerHTML = `
    <div class="dropzone">
      ${icon("upload")}
      <h2>Upload your existing resume</h2>
      <p class="muted">Drag and drop your PDF or DOCX file here, or click to browse.</p>
      <input type="file" id="resumeFile" accept=".pdf,.docx,.doc,.txt" style="display:none;" />
      <button class="btn" id="selectFileBtn">Select File</button>
      <span id="uploadStatus" class="muted"></span>
    </div>
    <div class="row" style="margin: 20px 0; color: var(--ink-soft);">
      <div style="flex:1; height:1px; background: var(--border);"></div>OR<div style="flex:1; height:1px; background: var(--border);"></div>
    </div>
    <button class="btn secondary" id="manualEntryBtn" style="width:100%; justify-content:center;">${icon("file")} Fill out details manually</button>
  `;

  const fileInput = document.getElementById("resumeFile");
  document.getElementById("selectFileBtn").onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const status = document.getElementById("uploadStatus");
    status.innerHTML = `<span class="spinner"></span> uploading…`;
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("isMaster", "true");
      await api("/cvs/upload", { method: "POST", body: form });
      step = 2;
      renderOnboarding();
    } catch (err) {
      status.textContent = "";
      showError(main, err);
    }
  };

  document.getElementById("manualEntryBtn").onclick = async () => {
    const content = prompt("Paste your resume text (you can format/improve it later in CV Store):");
    if (!content?.trim()) return;
    try {
      await api("/cvs", { method: "POST", body: { label: "My resume", content, isMaster: true } });
      step = 2;
      renderOnboarding();
    } catch (err) {
      showError(main, err);
    }
  };
}

function renderStep2() {
  document.getElementById("stepTitle").textContent = "What are you looking for?";
  document.getElementById("stepSubtitle").textContent = "This tunes Job Search results and doesn't have to be exact -- you can change it any time.";
  document.getElementById("stepBody").innerHTML = `
    <div class="grid cols-3">
      <div><label>City</label><input type="text" id="p-city" /></div>
      <div><label>Region/State</label><input type="text" id="p-region" /></div>
      <div><label>Country</label><input type="text" id="p-country" /></div>
    </div>
    <label><input type="checkbox" id="p-remote" style="width:auto; display:inline-block;" /> Include / prefer fully remote roles</label>
    <label>Minimum target compensation (optional)</label>
    <input type="text" id="p-minComp" placeholder="e.g. €80,000" />
  `;
  document.querySelector('[data-step-continue]')?.remove();
  const footer = document.querySelector("#profileMain .row.between");
  const cont = document.createElement("button");
  cont.className = "btn";
  cont.textContent = "Continue";
  cont.dataset.stepContinue = "";
  cont.onclick = async () => {
    await api("/profile", {
      method: "PUT",
      body: {
        city: document.getElementById("p-city").value.trim(),
        region: document.getElementById("p-region").value.trim(),
        country: document.getElementById("p-country").value.trim(),
        remote: document.getElementById("p-remote").checked,
        minComp: document.getElementById("p-minComp").value.trim(),
        notes: "",
      },
    }).catch((err) => showError(main, err));
    step = 3;
    renderOnboarding();
  };
  footer.insertBefore(cont, document.getElementById("skipBtn"));
}

function renderStep3() {
  document.getElementById("stepTitle").textContent = "You're all set.";
  document.getElementById("stepSubtitle").textContent = "Head to Job Search to find roles, or Applications to see your tracker.";
  document.getElementById("stepBody").innerHTML = `
    <div class="row" style="justify-content:center; gap: 12px; padding: 20px 0;">
      <a class="btn" href="job-search.html">${icon("search")} Find jobs</a>
      <a class="btn secondary" href="index.html">${icon("list")} Go to tracker</a>
    </div>`;
  document.getElementById("skipBtn").style.display = "none";
  document.getElementById("backBtn").style.display = "none";
}

// --- Settled profile / settings view (has at least one CV) -----------------

async function renderSettled(cvs) {
  const profile = await api("/profile").catch(() => ({}));
  const master = cvs.find((cv) => cv.isMaster) || cvs[0];

  main.innerHTML = `
    <div class="row between"><div><h1>Profile</h1><p class="subtitle">Your job-search preferences and master resume.</p></div></div>
    <div class="grid cols-2">
      <div class="card">
        <h2>Master resume</h2>
        <p class="muted">${escapeHtml(master.label)} ${master.isMaster ? "(master)" : ""}</p>
        <a class="btn secondary small" href="cv-store.html">Manage in CV Store</a>
      </div>
      <div class="card">
        <h2>Job search preferences</h2>
        <label>City</label><input type="text" id="s-city" value="${escapeHtml(profile.city || "")}" />
        <label>Region/State</label><input type="text" id="s-region" value="${escapeHtml(profile.region || "")}" />
        <label>Country</label><input type="text" id="s-country" value="${escapeHtml(profile.country || "")}" />
        <label><input type="checkbox" id="s-remote" style="width:auto; display:inline-block;" ${profile.remote ? "checked" : ""} /> Prefer remote roles</label>
        <label>Minimum target compensation</label><input type="text" id="s-minComp" value="${escapeHtml(profile.minComp || "")}" />
        <div class="row" style="margin-top: 12px;"><button class="btn" id="saveProfileBtn">Save</button><span id="saveStatus" class="muted"></span></div>
      </div>
    </div>
    <div class="card"><button class="btn secondary" id="logoutBtn">Log out</button></div>
  `;

  document.getElementById("saveProfileBtn").onclick = async () => {
    const status = document.getElementById("saveStatus");
    status.textContent = "saving…";
    try {
      await api("/profile", {
        method: "PUT",
        body: {
          city: document.getElementById("s-city").value.trim(),
          region: document.getElementById("s-region").value.trim(),
          country: document.getElementById("s-country").value.trim(),
          remote: document.getElementById("s-remote").checked,
          minComp: document.getElementById("s-minComp").value.trim(),
          notes: profile.notes || "",
        },
      });
      status.textContent = "saved";
      setTimeout(() => (status.textContent = ""), 1500);
    } catch (err) {
      status.textContent = "";
      showError(main, err);
    }
  };
  document.getElementById("logoutBtn").onclick = () => (location.href = "/cdn-cgi/access/logout");
}

init();
```

- [ ] **Step 3: Add dropzone CSS**

Append to `public/css/styles.css`:

```css
.dropzone {
  border: 2px dashed var(--advocate-outline-variant); border-radius: var(--radius);
  padding: 40px 24px; text-align: center;
}
.dropzone .icon { width: 48px; height: 48px; margin: 0 auto 12px; color: var(--advocate-primary); background: var(--advocate-surface-container-low); border-radius: 50%; padding: 12px; box-sizing: content-box; }
.dropzone h2 { margin-bottom: 4px; }
.dropzone .btn { margin-top: 14px; }
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, then:
1. With a DB that has zero CVs (`npm run db:reset:local` first), open `profile.html`. Expect Step 1 of 3 with the upload dropzone and "Fill out details manually" button.
2. Upload a resume file (or use manual entry). Expect it to advance to Step 2 (location/remote/comp fields).
3. Click Continue. Expect Step 3's "You're all set" screen with links to Job Search and the tracker.
4. Reload `profile.html`. Expect the settled view (master resume card + editable preferences), not the wizard.

- [ ] **Step 5: Commit**

```bash
git add public/profile.html public/js/profile.js public/css/styles.css
git commit -m "feat: add onboarding wizard and settled Profile page"
```

---

## Task 10: Applications dashboard — stat tiles + restyled Kanban

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/index.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: `GET /api/applications/stats` (Task 4), `icon` (Task 2).
- Preserves: all existing dialog/create-application logic in `index.js` untouched except where noted.

- [ ] **Step 1: Add the stat tiles container to `index.html`**

In `public/index.html`, insert a new `<div id="statTiles" class="stat-grid"></div>` right after the `<div class="row between">...</div>` header block and before `<div id="staleNotice"></div>`:

```html
    <div id="statTiles" class="stat-grid"></div>

    <div id="staleNotice"></div>
```

- [ ] **Step 2: Render stat tiles in `index.js`**

In `public/js/index.js`, add the import:

```js
import { icon } from "./icons.js";
```

Add a render function, and call it from `load()`:

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

In `load()`, after `apps = await api("/applications");` succeeds, add:

```js
  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(apps, stats);
```

- [ ] **Step 3: Restyle the card markup with status color + match badge**

In `index.js`, replace the `app-card` template inside the `body.innerHTML = items.map(...)` block (around line 109-116) with:

```js
      <div class="app-card app-card-${a.stage}" data-id="${a.id}">
        <div class="row between">
          <span class="status-chip ${a.stage}">${a.stage}</span>
          ${a.matchScore != null ? `<span class="match-badge ${a.matchScore >= 80 ? "high" : a.matchScore >= 50 ? "mid" : "low"}">${a.matchScore}%</span>` : ""}
        </div>
        <div class="company">${escapeHtml(a.role)}</div>
        <div class="role">${escapeHtml(a.company)}</div>
        <div class="meta">${escapeHtml(a.location || "")} ${isStale(a) ? '<span class="pill warn">stalled</span>' : ""}</div>
        <div class="meta">${icon("clock")} updated ${timeAgo(a.updatedAt)}</div>
      </div>`
```

(Note role/company swap vs. the old markup — the mockup puts the role title first in bold, company as the subtitle, matching `dashboard_top_nav/screen.png`.) Add the `icon` import already done in Step 2; this line uses it too.

- [ ] **Step 4: Add stage-colored left border to `.app-card`**

Append to `public/css/styles.css`:

```css
.app-card { border-left: 3px solid var(--advocate-outline-variant); }
.app-card.app-card-applied, .app-card.app-card-saved { border-left-color: var(--advocate-primary); }
.app-card.app-card-screening { border-left-color: var(--advocate-primary); }
.app-card.app-card-interview { border-left-color: var(--advocate-warn); }
.app-card.app-card-offer { border-left-color: var(--advocate-success); }
.app-card.app-card-rejected, .app-card.app-card-withdrawn { border-left-color: var(--danger); }
```

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, open `index.html`.
Expected: four stat tiles above the board (Total/Interviews/Offers/Avg Match), each application card shows a colored status chip top-left and (if tailored at least once) a match % badge top-right, and the card's left edge is colored by stage.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/index.js public/css/styles.css
git commit -m "feat: add stat tiles and restyle Kanban cards to Advocate design"
```

---

## Task 11: Application Detail View — status card, activity timeline, vault, reminders

**Files:**
- Modify: `public/application.html`
- Modify: `public/js/application.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: `GET /api/applications/:id/activity`, `POST /api/applications/:id/activity` (Task 4), `matchScore` on the application object (Task 3/4), `icon` (Task 2).

- [ ] **Step 1: Rewrite `application.html`'s layout**

Replace the body of `public/application.html` (everything inside `<main>...</main>`) with:

```html
  <main>
    <a href="index.html" class="muted">&larr; Back to Applications</a>
    <div id="header" style="margin-top:10px;"></div>

    <div class="grid cols-2" style="grid-template-columns: 360px 1fr;">
      <div>
        <div class="card">
          <h2>Current Status</h2>
          <div id="statusBlock"></div>
        </div>
        <div class="card">
          <h2>Activity</h2>
          <div id="activityTimeline"></div>
          <button class="btn secondary small" id="addReminderBtn" style="margin-top:10px;">Add Reminder</button>
        </div>
        <div class="card">
          <h2>Details</h2>
          <label>Location</label>
          <input type="text" id="location" />
          <label>Posting link</label>
          <input type="text" id="link" />
          <label>Job post text</label>
          <textarea id="jobPost" rows="6"></textarea>
          <label>Notes</label>
          <textarea id="notes" rows="4" placeholder="Interviewer names, impressions, follow-ups..."></textarea>
          <div class="row" style="margin-top:12px;">
            <button class="btn" id="saveDetails">Save</button>
            <span id="saveStatus" class="muted"></span>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="row between">
            <h2>Application Vault</h2>
            <div class="row" id="docButtons"></div>
          </div>
          <p class="muted">Specific documents and assets generated for this role.</p>
          <div id="vaultGrid" class="vault-grid"></div>
        </div>

        <div class="card">
          <h2>Tailored CV</h2>
          <div id="cvStatus" class="muted">No tailored CV yet.</div>
          <label>Role flavor</label>
          <select id="flavor">
            <option value="">General</option>
            <option value="tech">Tech / Engineering / PM</option>
            <option value="executive">Executive / C-suite</option>
            <option value="academic">Academic</option>
            <option value="creative">Creative / Design</option>
            <option value="careerChange">Career change</option>
          </select>
          <div class="row" style="margin-top:12px;">
            <button class="btn" id="tailorBtn">Tailor CV to this posting</button>
          </div>
          <div id="tailorResult"></div>
        </div>
      </div>
    </div>
  </main>

  <dialog id="reminderDialog">
    <div class="card">
      <h2>Add reminder</h2>
      <label>Title</label>
      <input type="text" id="r-title" placeholder="Follow up with recruiter" />
      <label>Date</label>
      <input type="date" id="r-date" />
      <div class="row" style="margin-top:16px; justify-content:flex-end;">
        <button class="btn secondary" id="cancelReminder">Cancel</button>
        <button class="btn" id="saveReminder">Add</button>
      </div>
    </div>
  </dialog>
```

Keep the `<script type="module" src="js/application.js"></script>` line and closing tags as before.

- [ ] **Step 2: Render the status block, activity timeline, and vault grid in `application.js`**

In `public/js/application.js`, add the import:

```js
import { icon } from "./icons.js";
```

Replace `renderDetails()` — keep it as-is for the form fields, but add three new render functions and call them from `load()`:

```js
async function load() {
  app = await api(`/applications/${appId}`);
  renderHeader();
  renderStatusBlock();
  renderDetails();
  renderCvStatus();
  renderDocButtons();
  renderDocs();
  renderActivity();
  if (app.cvId) {
    const cv = await api(`/cvs/${app.cvId}`);
    renderTailoredCv(cv.content, "");
  }
}

function renderStatusBlock() {
  document.getElementById("statusBlock").innerHTML = `
    <span class="status-chip ${app.stage}">${escapeHtml(app.stage)}</span>
    <p class="muted" style="margin: 8px 0 16px;">Updated ${timeAgoLabel(app.updatedAt)}</p>
    <div class="row between"><label style="margin:0;">Match Score</label><strong>${app.matchScore != null ? app.matchScore + "%" : "—"}</strong></div>
    ${app.matchScore != null ? `<div class="match-bar"><div class="match-bar-fill" style="width:${app.matchScore}%;"></div></div>` : ""}
    <div class="row between" style="margin-top:14px;">
      <label style="margin:0;">Applied via</label><span>${escapeHtml(app.source === "job-search" ? "Job Search" : app.source === "manual" ? "Manual" : app.source)}</span>
    </div>
    <label style="margin-top:16px;">Stage</label>
    <select id="stageSelect"></select>
  `;
  const sel = document.getElementById("stageSelect");
  sel.innerHTML = STAGES.map((s) => `<option value="${s}" ${app.stage === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("");
  sel.onchange = async () => {
    app = await api(`/applications/${appId}`, { method: "PATCH", body: { stage: sel.value } });
    renderStatusBlock();
    renderActivity();
  };
}

function timeAgoLabel(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const ACTIVITY_ICON = { created: "file", stage_change: "checkCircle", tailored: "sparkle", document: "mail", reminder: "calendar" };

async function renderActivity() {
  const events = await api(`/applications/${appId}/activity`).catch(() => []);
  const el = document.getElementById("activityTimeline");
  if (!events.length) { el.innerHTML = `<p class="muted">Nothing yet.</p>`; return; }
  el.innerHTML = events
    .map(
      (e) => `
    <div class="activity-row">
      <span class="activity-icon">${icon(ACTIVITY_ICON[e.type] || "clock")}</span>
      <div>
        <div class="activity-title">${escapeHtml(e.title)}</div>
        ${e.detail ? `<div class="muted">${escapeHtml(e.detail)}</div>` : ""}
        <div class="muted" style="font-size:11.5px;">${escapeHtml(new Date(e.occurredAt).toLocaleString())}</div>
      </div>
    </div>`
    )
    .join("");
}

document.getElementById("addReminderBtn").onclick = () => document.getElementById("reminderDialog").showModal();
document.getElementById("cancelReminder").onclick = () => document.getElementById("reminderDialog").close();
document.getElementById("saveReminder").onclick = async () => {
  const title = document.getElementById("r-title").value.trim();
  const date = document.getElementById("r-date").value;
  if (!title) return alert("Give the reminder a title.");
  await api(`/applications/${appId}/activity`, {
    method: "POST",
    body: { title, occurredAt: date ? new Date(date).toISOString() : new Date().toISOString() },
  }).catch((err) => showError(main, err));
  document.getElementById("reminderDialog").close();
  document.getElementById("r-title").value = "";
  renderActivity();
};
```

- [ ] **Step 3: Restyle the vault as tagged document cards**

Replace `renderDocs()` in `application.js`:

```js
async function renderDocs() {
  const docs = await api(`/applications/${appId}/documents`);
  const grid = document.getElementById("vaultGrid");
  if (!docs.length) {
    grid.innerHTML = `<p class="muted">Nothing generated yet — use the buttons above.</p>`;
    return;
  }
  const labelFor = (key) => DOC_TYPES.find((d) => d[0] === key)?.[1] || key;
  grid.innerHTML = docs
    .slice()
    .reverse()
    .map(
      (d) => `
    <div class="vault-card">
      <div class="row between">
        <span class="icon">${icon(d.type === "coldEmail" ? "mail" : "file")}</span>
        <button class="btn secondary small" data-del="${d.id}">Delete</button>
      </div>
      <div class="vault-card-title">${escapeHtml(labelFor(d.type))}</div>
      <div class="doc-content" style="max-height:140px; overflow:auto;">${escapeHtml(d.content)}</div>
      <button class="btn secondary small" data-copy="${d.id}" style="margin-top:8px;">Copy</button>
    </div>`
    )
    .join("");

  grid.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.onclick = () => {
      const doc = docs.find((d) => d.id === btn.dataset.copy);
      navigator.clipboard.writeText(doc.content);
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    };
  });
  grid.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/applications/${appId}/documents/${btn.dataset.del}`, { method: "DELETE" });
      renderDocs();
    };
  });
}
```

Remove the now-unused `saveDetails` stage-select handling from the old `renderDetails()`/`saveDetails` click handler (stage is now driven by the new `#stageSelect` in `renderStatusBlock()`) — update the existing `document.getElementById("saveDetails").onclick` body to drop `stage: document.getElementById("stageSelect").value,` from its PATCH body (that element id now lives inside `renderStatusBlock` and already PATCHes stage on its own `onchange`), keeping only `location`, `link`, `jobPostText`, `notes`.

- [ ] **Step 4: Add CSS for the match bar, activity rows, and vault grid**

Append to `public/css/styles.css`:

```css
.match-bar { height: 6px; border-radius: 3px; background: var(--advocate-surface-container); margin: 6px 0 0; overflow: hidden; }
.match-bar-fill { height: 100%; background: var(--advocate-primary); }

.activity-row { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.activity-row:last-child { border-bottom: none; }
.activity-icon { width: 28px; height: 28px; border-radius: 50%; background: var(--advocate-surface-container-low); color: var(--advocate-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.activity-icon .icon { width: 16px; height: 16px; }
.activity-title { font-weight: 600; font-size: 13.5px; }

.vault-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; }
.vault-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; background: var(--advocate-surface-container-low); }
.vault-card-title { font-weight: 700; margin: 8px 0 6px; }
```

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, open an existing application's detail page (`application.html?id=<id>`).
Expected: left column shows a status chip + match bar + stage dropdown (changing it updates the chip and adds an Activity row immediately) and an Activity feed with icons; "Add Reminder" opens a dialog and, after saving, a new reminder row appears in Activity; right column's Application Vault shows generated documents as cards with a type icon and Copy/Delete actions.

- [ ] **Step 6: Commit**

```bash
git add public/application.html public/js/application.js public/css/styles.css
git commit -m "feat: redesign Application Detail view with status, activity, and vault"
```

---

## Task 12: Job Search — filters and match score badges

**Files:**
- Modify: `public/job-search.html`
- Modify: `public/js/job-search.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: the `matchScore` field added to job search results in Task 5.

- [ ] **Step 1: Add filter chips to `job-search.html`**

In `public/job-search.html`, after the existing `<label>Other preferences...</label><input ... id="notes" />` line and before the search button row, add:

```html
      <label>Job type</label>
      <div class="row" id="jobTypeChips">
        <button type="button" class="chip active" data-type="full-time">Full-time</button>
        <button type="button" class="chip" data-type="contract">Contract</button>
        <button type="button" class="chip" data-type="remote">Remote</button>
      </div>
```

- [ ] **Step 2: Wire chip state and fold it into `notes`, render match badges**

In `public/js/job-search.js`, add near the top (after existing `const` declarations):

```js
const chipEls = document.querySelectorAll("#jobTypeChips .chip");
chipEls.forEach((chip) => {
  chip.onclick = () => chip.classList.toggle("active");
});
function selectedJobTypes() {
  return [...chipEls].filter((c) => c.classList.contains("active")).map((c) => c.dataset.type);
}
```

In the `searchBtn.onclick` handler, change the `notes` sent in the request body from just the raw field value to fold in the selected job types:

```js
        notes: [document.getElementById("notes").value.trim(), selectedJobTypes().length ? `Job type preference: ${selectedJobTypes().join(", ")}` : ""].filter(Boolean).join(". "),
```

In `render()`, replace the job-listing `.map((j, i) => ...)` block to show a match badge and restyle as a card grid instead of rows:

```js
        ? `<div class="job-grid">${jobs
            .map(
              (j, i) => `
          <div class="card job-card">
            <div class="row between">
              <div>
                <h2 style="margin-bottom:2px;">${escapeHtml(j.title)}</h2>
                <p class="muted" style="margin:0;">${escapeHtml(j.company)}</p>
              </div>
              ${j.matchScore != null ? `<span class="match-badge ${j.matchScore >= 80 ? "high" : j.matchScore >= 50 ? "mid" : "low"}">${j.matchScore}% MATCH</span>` : ""}
            </div>
            <p class="muted" style="margin:10px 0;">${icon("mapPin")} ${escapeHtml(j.location || "")} ${j.compEstimate ? `&nbsp;${icon("dollar")} ${escapeHtml(j.compEstimate)}` : ""}</p>
            ${j.fitNote ? `<p style="font-size:13.5px;">${escapeHtml(j.fitNote)}</p>` : ""}
            <div class="row" style="margin-top:12px;">
              <button class="btn" data-idx="${i}" style="flex:1;">Tailor Resume</button>
              ${safeUrl(j.url) ? `<a class="icon-btn" href="${escapeHtml(safeUrl(j.url))}" target="_blank" rel="noopener" title="View posting">${icon("chevronRight")}</a>` : ""}
            </div>
          </div>`
            )
            .join("")}</div>`
        : ""
```

Add the `icon` import at the top of the file:

```js
import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl, ensureCvsOrEmptyState, fetchJobPostFromUrl } from "./app.js";
import { icon } from "./icons.js";
```

- [ ] **Step 3: Add chip and job-grid CSS**

Append to `public/css/styles.css`:

```css
.chip {
  padding: 7px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.chip.active { background: var(--advocate-surface-container); color: var(--advocate-primary); border-color: var(--advocate-primary-container); }

.job-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.job-card { margin-bottom: 0; }
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, open `job-search.html`, run a search.
Expected: job-type chips are clickable/toggleable, results render as a card grid with a colored match % badge per card (when the model returns one), and "Tailor Resume" still creates + tailors an application exactly as the old "Start application" button did (same handler, same `data-idx` wiring — only the visual template changed).

- [ ] **Step 5: Commit**

```bash
git add public/job-search.html public/js/job-search.js public/css/styles.css
git commit -m "feat: add job type filters and match badges to Job Search"
```

---

## Task 13: Resume Tailoring Studio — split-pane redesign + keyword highlighting

**Files:**
- Modify: `src/routes/tailor.js`
- Modify: `src/routes/applications.js`
- Modify: `public/js/cv-doc.js`
- Modify: `public/tailor.html`
- Modify: `public/js/tailor.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Produces: both tailoring endpoints (`POST /api/tailor/quick`, `POST /api/applications/:id/tailor`) now also return `keywords: string[]` — exact phrases from the tailored CV worth highlighting as JD-matched. `mountCvDocument(container, opts)` gains an optional `opts.highlightTerms: string[]` that wraps matches in `<mark class="kw-highlight">`.

- [ ] **Step 1: Request a keywords list from the model in both tailoring prompts**

In `src/routes/tailor.js`'s `router.post("/quick", ...)`, change the `prompt` template's closing instruction from:

```js
    `2. "## Tailored CV" -- the full tailored CV text, inside a fenced block ` +
    `that starts with \`\`\`CV and ends with \`\`\`.`;
```

to:

```js
    `2. "## Tailored CV" -- the full tailored CV text, inside a fenced block ` +
    `that starts with \`\`\`CV and ends with \`\`\`.\n\n` +
    `Then output a fenced block starting with \`\`\`KEYWORDS and ending with ` +
    `\`\`\` containing a JSON array of 5-12 short exact phrases (copied verbatim ` +
    `from the Tailored CV text) that most directly reflect the job posting's ` +
    `requirements -- these get highlighted in the UI.`;
```

Then update the return statement to extract and include them:

```js
  return c.json({
    analysis: text,
    tailoredText: text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null,
    keywords: (() => {
      try { return JSON.parse(text.match(/```KEYWORDS\n([\s\S]*?)\n```/)?.[1] || "[]"); }
      catch { return []; }
    })(),
    baseCvId: baseCv.id,
  });
```

Apply the identical two edits to `src/routes/applications.js`'s `router.post("/:id/tailor", ...)`: extend its `prompt` the same way, and extend its final `return c.json({ analysis: text, tailoredCv: newCv });` to `return c.json({ analysis: text, tailoredCv: newCv, keywords: (() => { try { return JSON.parse(text.match(/\`\`\`KEYWORDS\n([\s\S]*?)\n\`\`\`/)?.[1] || "[]"); } catch { return []; } })() });` (same IIFE pattern).

- [ ] **Step 2: Add `highlightTerms` support to `mountCvDocument`**

In `public/js/cv-doc.js`, modify `renderDocHtml` to accept an optional second argument and wrap matches:

```js
function renderDocHtml(text, highlightTerms = []) {
```

At the very end of the function, before `return html || ...`, apply highlighting if any terms were given:

```js
  if (highlightTerms.length) {
    // Longest-first so a shorter term that's a substring of a longer one
    // (e.g. "React" inside "React and modern JavaScript ecosystems") doesn't
    // fragment the longer match.
    const sorted = [...highlightTerms].sort((a, b) => b.length - a.length).filter(Boolean);
    for (const term of sorted) {
      const escaped = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!escaped) continue;
      html = html.replace(new RegExp(`(?![^<]*>)${escaped}`, "g"), (m) => `<mark class="kw-highlight">${m}</mark>`);
    }
  }

  return html || `<p class="muted">Nothing here yet.</p>`;
```

Then update `mountCvDocument` to accept and thread through `highlightTerms`:

```js
export function mountCvDocument(container, opts) {
  const {
    content,
    editable = true,
    saveLabel = "Save as new version",
    onSave,
    assistant = false,
    onAssistantSend,
    highlightTerms = [],
  } = opts;
```

And change the two `docBody.innerHTML = renderDocHtml(...)` call sites that render the *initial/baseline* content (the one right after `docBody.innerHTML = renderDocHtml(baseline);` near the top, and the one inside `editToggle.onclick`'s "leaving edit mode" branch) to pass it through: `renderDocHtml(baseline, highlightTerms)` and `renderDocHtml(text, highlightTerms)` respectively. Leave `setContent`/`showProposed`'s calls unhighlighted (new content being set programmatically has no known keyword list) unless a future task needs it — this is a display nicety, not required everywhere.

- [ ] **Step 3: Add `.kw-highlight` CSS**

Append to `public/css/styles.css`:

```css
mark.kw-highlight { background: var(--advocate-success-soft); color: var(--advocate-success); padding: 0 2px; border-radius: 3px; }
```

- [ ] **Step 4: Rework `tailor.html` into a split-pane layout**

Replace the body of `public/tailor.html` (everything inside `<main>`) with:

```html
  <main style="max-width: none; padding: 24px 28px;">
    <div class="row between">
      <h1>Resume Tailoring Studio</h1>
      <span class="pill" id="matchPill" style="display:none;"></span>
    </div>
    <div class="studio-split">
      <div class="card studio-pane">
        <h2>Target Job Description</h2>
        <label>Base CV</label>
        <select id="cvSelect"></select>
        <label>Role flavor</label>
        <select id="flavor">
          <option value="">General</option>
          <option value="tech">Tech / Engineering / PM</option>
          <option value="executive">Executive / C-suite</option>
          <option value="academic">Academic</option>
          <option value="creative">Creative / Design</option>
          <option value="careerChange">Career change</option>
        </select>
        <label>Job posting link (optional)</label>
        <div class="row">
          <input type="text" id="jobPostLink" style="flex:1;" placeholder="https://..." />
          <button type="button" class="btn secondary small" id="fetchJobPost">Fetch job post</button>
        </div>
        <span id="fetchStatus" class="muted"></span>
        <label>Job posting text</label>
        <textarea id="jobPost" rows="14" placeholder="Paste the full job description here, or fetch it from the link above" style="flex:1;"></textarea>
        <div class="row" style="margin-top:12px;">
          <button class="btn" id="runBtn">Analyze &amp; Tailor</button>
          <span id="status" class="muted"></span>
        </div>
        <a class="muted" href="outreach.html" style="display:inline-block; margin-top:14px;">Need a cover letter or cold email instead? Open the Outreach Studio &rarr;</a>
      </div>
      <div class="studio-pane" id="result"></div>
    </div>
  </main>
```

- [ ] **Step 5: Add split-pane CSS**

Append to `public/css/styles.css`:

```css
.studio-split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; margin-top: 16px; }
@media (max-width: 1000px) { .studio-split { grid-template-columns: 1fr; } }
.studio-pane { display: flex; flex-direction: column; min-height: 60vh; }
.studio-pane textarea { flex: 1; }
```

- [ ] **Step 6: Pass `keywords` into the mount call and show the match pill**

In `public/js/tailor.js`'s `render(data)` function, update the `mountCvDocument` call to add `highlightTerms: data.keywords || []`:

```js
  const doc = mountCvDocument(document.getElementById("tailoredCvMount"), {
    content: data.tailoredText,
    editable: true,
    saveLabel: "Save as new CV version",
    highlightTerms: data.keywords || [],
    onSave: (text) => api("/tailor/quick/save", { method: "POST", body: { baseCvId: data.baseCvId, content: text } }),
  });
```

Add, right before that call, code to populate the header's match pill from the analysis text (reuse the same regex idea as the backend's `parseMatchScore`, kept client-side since this page doesn't hit `applications.js`):

```js
  const scoreMatch = data.analysis.match(/match\s*score[:\s]*[^\d]{0,10}(\d{1,3})/i);
  const pill = document.getElementById("matchPill");
  if (scoreMatch) { pill.textContent = `${scoreMatch[1]}% Match`; pill.style.display = "inline-block"; }
```

- [ ] **Step 7: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, open `tailor.html`, paste a job posting, click "Analyze & Tailor".
Expected: two-pane layout (JD on the left, results on the right), a "NN% Match" pill appears next to the page title, and phrases the model chose as keywords appear highlighted (green background) in the tailored CV preview.

- [ ] **Step 8: Commit**

```bash
git add src/routes/tailor.js src/routes/applications.js public/js/cv-doc.js public/tailor.html public/js/tailor.js public/css/styles.css
git commit -m "feat: split-pane Resume Tailoring Studio with match score and keyword highlighting"
```

---

## Task 14: Outreach Communication Studio

**Files:**
- Create: `public/outreach.html`
- Create: `public/js/outreach.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: `POST /api/outreach/generate` (Task 7), templates CRUD (Task 8), `ensureCvsOrEmptyState`, `icon`.

- [ ] **Step 1: Write `public/outreach.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Outreach Studio · Advocate</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <div id="topnav"></div>
  <main style="max-width: none; padding: 24px 28px;">
    <div class="studio-split" style="grid-template-columns: 320px 1fr;">
      <div>
        <h1 style="margin-bottom: 14px;">Studio</h1>
        <div class="row" id="kindTabs" style="margin-bottom: 16px;">
          <button type="button" class="chip active" data-kind="coverLetter">Cover Letters</button>
          <button type="button" class="chip" data-kind="coldEmail">Cold Emails</button>
        </div>

        <div class="card">
          <h2>AI Assistant</h2>
          <label>CV to draft from</label>
          <select id="cvSelect"></select>
          <label>Target Role / Company</label>
          <input type="text" id="targetRoleCompany" placeholder="e.g. Senior Designer at Acme Corp" />
          <label>Tone</label>
          <div class="grid cols-2" id="toneGrid">
            <button type="button" class="chip tone active" data-tone="professional">Professional</button>
            <button type="button" class="chip tone" data-tone="casual">Casual</button>
            <button type="button" class="chip tone" data-tone="confident">Confident</button>
            <button type="button" class="chip tone" data-tone="referral">Referral</button>
          </div>
          <button class="btn" id="generateBtn" style="width:100%; justify-content:center; margin-top:14px;">Generate Draft</button>
          <span id="genStatus" class="muted"></span>
        </div>

        <div class="row between" style="margin-top:20px;">
          <h2 style="margin:0;">Saved Templates</h2>
          <button class="icon-btn" id="saveTemplateBtn" title="Save current draft as a template"></button>
        </div>
        <div id="templatesList"></div>
      </div>

      <div class="card" id="editorPane">
        <div class="row between">
          <div class="row" style="gap:6px;">
            <button class="icon-btn" title="Bold" disabled>B</button>
            <button class="icon-btn" title="Italic" disabled>I</button>
          </div>
          <div class="row">
            <span class="muted" id="savedIndicator"></span>
            <button class="btn secondary small" id="exportPdfBtn">Export PDF</button>
            <button class="btn small" id="copyBtn">Copy to Clipboard</button>
          </div>
        </div>
        <div id="editorTitle" style="font-family:var(--font-display); font-size:24px; font-weight:700; margin: 16px 0 10px;">Untitled draft</div>
        <div id="editorBody" contenteditable="true" class="outreach-editor"></div>
      </div>
    </div>
  </main>

  <script type="module" src="js/outreach.js"></script>
</body>
</html>
```

`#saveTemplateBtn` is left empty here deliberately — Step 2's `outreach.js` sets its icon via `icon("folder")` on load, the same way `renderNav()` already injects icons into nav markup it owns.

- [ ] **Step 2: Write `public/js/outreach.js`**

```js
import { api, escapeHtml, renderNav, showError, ensureCvsOrEmptyState } from "./app.js";
import { icon } from "./icons.js";

renderNav("tailor.html"); // Outreach Studio is reached from the Tailor tab; keep that tab highlighted.
document.getElementById("saveTemplateBtn").innerHTML = icon("folder");

const main = document.querySelector("main");
let kind = "coverLetter";
let tone = "professional";
let draftContent = "";

document.querySelectorAll("#kindTabs .chip").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#kindTabs .chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    kind = btn.dataset.kind;
    loadTemplates();
  };
});

document.querySelectorAll("#toneGrid .chip").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#toneGrid .chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tone = btn.dataset.tone;
  };
});

async function loadCvs() {
  const cvs = await ensureCvsOrEmptyState(main, "Outreach drafting needs a CV to work from — add one first.");
  if (!cvs) return;
  document.getElementById("cvSelect").innerHTML = cvs
    .map((cv) => `<option value="${cv.id}" ${cv.isMaster ? "selected" : ""}>${escapeHtml(cv.label)}${cv.isMaster ? " (master)" : ""}</option>`)
    .join("");
}

document.getElementById("generateBtn").onclick = async () => {
  const targetRoleCompany = document.getElementById("targetRoleCompany").value.trim();
  if (!targetRoleCompany) return alert("Enter a target role / company first.");
  const status = document.getElementById("genStatus");
  status.innerHTML = `<span class="spinner"></span> drafting…`;
  try {
    const { content } = await api("/outreach/generate", {
      method: "POST",
      body: { type: kind, targetRoleCompany, tone, cvId: document.getElementById("cvSelect").value },
    });
    draftContent = content;
    document.getElementById("editorTitle").textContent = `${targetRoleCompany} – ${kind === "coverLetter" ? "Cover Letter" : "Cold Email"}`;
    document.getElementById("editorBody").innerText = content;
    document.getElementById("savedIndicator").textContent = "";
  } catch (err) {
    showError(main, err);
  } finally {
    status.textContent = "";
  }
};

document.getElementById("copyBtn").onclick = () => {
  navigator.clipboard.writeText(document.getElementById("editorBody").innerText);
  const btn = document.getElementById("copyBtn");
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = "Copy to Clipboard"), 1200);
};

document.getElementById("exportPdfBtn").onclick = () => {
  // No PDF library in this project's dependencies -- the browser's own
  // print-to-PDF (triggered via window.print(), scoped to #editorPane by the
  // @media print rule in styles.css) is a zero-dependency way to get there.
  window.print();
};

document.getElementById("saveTemplateBtn").onclick = async () => {
  const content = document.getElementById("editorBody").innerText.trim();
  if (!content) return alert("Generate or write a draft first.");
  const label = prompt("Name this template:", document.getElementById("targetRoleCompany").value || "Untitled template");
  if (!label) return;
  await api("/templates", {
    method: "POST",
    body: { kind, label, tone, targetRoleCompany: document.getElementById("targetRoleCompany").value.trim(), content },
  }).catch((err) => showError(main, err));
  loadTemplates();
};

async function loadTemplates() {
  const templates = await api("/templates").catch(() => []);
  const list = document.getElementById("templatesList");
  const filtered = templates.filter((t) => t.kind === kind);
  if (!filtered.length) { list.innerHTML = `<p class="muted">No saved templates yet.</p>`; return; }
  list.innerHTML = filtered
    .map(
      (t) => `
    <div class="template-row" data-id="${t.id}">
      <div>
        <div style="font-weight:600; font-size:13.5px;">${escapeHtml(t.label)}</div>
        <div class="muted" style="font-size:11.5px;">Last used ${new Date(t.lastUsedAt).toLocaleDateString()}</div>
      </div>
      ${icon("chevronRight")}
    </div>`
    )
    .join("");
  list.querySelectorAll(".template-row").forEach((row) => {
    row.onclick = async () => {
      const t = filtered.find((x) => x.id === row.dataset.id);
      document.getElementById("editorTitle").textContent = t.label;
      document.getElementById("editorBody").innerText = t.content;
      document.getElementById("targetRoleCompany").value = t.targetRoleCompany;
      await api(`/templates/${t.id}/use`, { method: "POST" }).catch(() => {});
      loadTemplates();
    };
  });
}

loadCvs();
loadTemplates();
```

- [ ] **Step 3: Add outreach editor + template row + print CSS**

Append to `public/css/styles.css`:

```css
.outreach-editor {
  min-height: 400px; font-size: 15px; line-height: 1.7; outline: none;
  padding: 4px 2px; white-space: pre-wrap;
}
.template-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; margin-top: 8px;
  cursor: pointer; background: var(--surface);
}
.template-row:hover { border-color: var(--advocate-primary-container); }

@media print {
  header.topbar, #kindTabs, .studio-split > div:first-child, .row.between .btn, .row.between .icon-btn { display: none !important; }
  #editorPane { border: none; box-shadow: none; padding: 0; }
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no errors.

Run: `npm run dev`, open `outreach.html`.
Expected: Cover Letters/Cold Emails tabs toggle; entering a target role/company, picking a tone, and clicking "Generate Draft" populates the right-hand editor; "Copy to Clipboard" copies the editor's text; "Export PDF" opens the browser print dialog with only the document content visible; clicking the folder icon saves the current draft as a template, which then appears in the Saved Templates list and can be reopened by clicking it.

- [ ] **Step 5: Commit**

```bash
git add public/outreach.html public/js/outreach.js public/css/styles.css
git commit -m "feat: add Outreach Communication Studio with tone control and saved templates"
```

---

## Task 15: CV Store visual pass

**Files:**
- Modify: `public/cv-store.html`
- Modify: `public/css/styles.css`

**Interfaces:**
- None new — this is a pure visual-consistency pass. `public/js/cv-store.js`'s logic and DOM ids are untouched; only container markup/classes in `cv-store.html` and any new CSS may change.

- [ ] **Step 1: Confirm current structure before touching it**

Run: `grep -n 'id="' public/cv-store.html` and cross-reference every id against `public/js/cv-store.js`'s `document.getElementById(...)` / `querySelector(...)` calls.
Expected: a full list of ids `cv-store.js` depends on — none of them may be renamed or removed in Step 2, only wrapped in new classes/containers.

- [ ] **Step 2: Apply Advocate card/list styling**

Since `cv-store.js` renders CV list items and the improve-flow document view dynamically (not visible in static HTML), this task is CSS-only: add classes already defined in prior tasks (`.card`, `.pill`, `.status-chip`) are already picked up automatically via the token repoint in Task 1 — verify visually rather than re-deriving new markup. If `cv-store.js`'s rendered CV list items use a bespoke class not covered by existing `.app-card`/`.card` styles, add a small `.cv-list-item` rule to `public/css/styles.css` matching the Advocate look (12px radius, 1px `var(--border)`, `var(--shadow)`), reusing the same visual language as `.vault-card` from Task 11 rather than inventing a new pattern.

- [ ] **Step 3: Verify**

Run: `npm run dev`, open `cv-store.html`, and walk through: viewing the CV list, opening a CV, using the chat/improve panel, uploading a new file.
Expected: every one of those interactions still works exactly as before (this task must not change behavior), and the visual language (colors, fonts, radii, buttons) now matches the rest of the redesigned app.

- [ ] **Step 4: Commit**

```bash
git add public/cv-store.html public/css/styles.css
git commit -m "style: bring CV Store visuals in line with the Advocate redesign"
```

---

## Task 16: End-to-end walkthrough and cleanup pass

**Files:**
- No new files — this task verifies Tasks 1-15 together and fixes anything that only surfaces in combination.

- [ ] **Step 1: Full lint pass**

Run: `npm run lint`
Expected: zero errors across the whole repo.

- [ ] **Step 2: Fresh-account walkthrough**

Run: `npm run db:reset:local && npm run dev`. In a browser:
1. Open `index.html` — with zero applications, expect the empty board state; with zero CVs, `renderNav` still works but `+ New Application`'s dialog should show the "no CV yet" hint.
2. Open `profile.html` — expect the onboarding wizard (Step 1 of 3). Upload a real resume file, fill in a location on Step 2, land on Step 3.
3. Open `job-search.html` — run a real search, confirm match badges render, click "Tailor Resume" on a result, confirm it lands on `application.html?id=...` with a tailored CV already present, a match score badge on the status card, and `created` + `tailored` rows in the Activity feed.
4. On that application page, change its stage via the dropdown — confirm the stat tiles on `index.html` (Interviews/Offers) update after navigating back, and a `stage_change` Activity row appears.
5. Generate a cover letter from the Application Vault's doc buttons — confirm it appears as a vault card.
6. Open `outreach.html`, generate a cold email with a non-default tone, save it as a template, reload the page, and confirm the template is still listed and reopens correctly.
7. Open `tailor.html` directly (not via an application), paste a job posting, confirm the split-pane layout, the match pill, and keyword highlighting all render.

Expected: no console errors at any step; every flow above completes without a dead end or broken link.

- [ ] **Step 3: Commit only if Step 2 surfaced fixes**

If Step 2 required any code changes, commit them with a message describing what broke and why (e.g. `fix: application detail page 404'd on the new /activity route when...`). If nothing needed fixing, this task ends at Step 2 with no commit.
