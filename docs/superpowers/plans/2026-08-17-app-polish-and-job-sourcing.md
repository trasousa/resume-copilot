# App Polish, Job Sourcing, and Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "Advocate" branding leak, give the app a distinctive, deliberately-chosen palette (replacing the generic blue-indigo scheme), add a favicon, turn the profile avatar into a working Profile/Settings menu, parse uploaded resumes into a structured, rendered preview instead of just storing raw text, add a real account-deletion flow, and add a second, deterministic job-search source (Apify's `fantastic-jobs/jobs-scraper` actor) alongside the existing LLM web search.

**Architecture:** Nine independent-ish improvements to the existing single-Worker resume-copilot app (Hono, D1, R2, plain ES-module frontend, no build step). Most tasks touch 1-3 files; the two larger ones (resume parsing, job-search sourcing) each add one new backend capability plus its frontend consumer. Nothing here changes the app's fundamental architecture — no new hosting, no new runtime, one exception: the Apify job source is an outbound `fetch()` call to a third-party hosted API (Apify's own infrastructure runs the actual scraper), not a new service this project has to run or deploy.

**Tech Stack:** Hono, Cloudflare Workers + D1 + R2, vanilla ES modules, hand-written CSS. New: one outbound REST integration (Apify).

**Spec:** No separate spec doc — this plan argues directly from the user's request and the current codebase state, both inspected during planning (see conversation history around 2026-08-17 for the research trail on Apify's `fantastic-jobs/jobs-scraper` actor, which is the concrete choice this plan builds on).

## Global Constraints

- **Single-tenant data model, currently.** Every table in `schema.sql` has zero `user_id`/`owner` columns — authentication (Cloudflare Access) gates *who can reach* the app, but every row is globally shared once inside. This plan's account-deletion task therefore wipes **all** application data, not "just one user's rows" — there is no per-user row to isolate. This is called out explicitly in that task; if the app is ever meant to support multiple genuinely separate users, that's a much larger retrofit (a `user_sub` column on every table plus every query filtered by it) and is out of scope here.
- **No test framework in this repo** (confirmed: no `test` script in `package.json`). Verify each task with `npm run lint` plus `npm run dev` + live `curl`/browser checks, not a fabricated test suite.
- **No build step for CSS/JS.** Keep hand-written vanilla JS modules and plain CSS custom properties — no bundler, no framework, consistent with every existing file in `public/`.
- **Escaping discipline:** every render function touching user- or LLM-derived text must go through `escapeHtml()` (and `safeUrl()` for links) from `public/js/app.js` — this codebase has held that line through the whole prior redesign; keep holding it.
- **New color tokens:** the palette below is a deliberate, non-default choice (see Task 2's rationale) — implement its exact hex values, don't substitute a different scheme.
  - `--advocate-primary: #1D4E4B` (deep teal — brand, nav active state, links)
  - `--advocate-primary-container: #D7E8E5` (soft teal — hover/active backgrounds)
  - `--advocate-secondary: #E8543D` (warm coral — the ONE accent color, reserved for primary buttons/CTAs, the match-score ring, and nothing else)
  - `--advocate-success: #2F9E5C` / `--advocate-success-soft: #E1F5E9`
  - `--advocate-warn: #C98A1D` / `--advocate-warn-soft: #FBECD3`
  - `--advocate-danger: #C1392B` / `--advocate-danger-soft: #F8DFDB`
  - `--advocate-surface: #F6F7F6` (cool neutral off-white — NOT the cream/ivory of a generic "warm palette" default)
  - `--advocate-surface-container-low: #EFF1F0`
  - `--advocate-surface-container: #EAEDEC`
  - `--advocate-surface-container-high: #DEE3E1`
  - `--advocate-surface-container-lowest: #FFFFFF`
  - `--advocate-on-surface: #142524` (near-black with a cool teal undertone)
  - `--advocate-on-surface-variant: #4B5B59`
  - `--advocate-outline-variant: #C7D0CE`
  - The existing `--advocate-*` CSS variable *names* stay as-is (only their hex values change) — renaming the variables themselves is unnecessary churn across ~15 files for zero user-visible benefit. Only user-facing *text* referencing "Advocate" gets removed (Task 1).
- **APIFY_API_TOKEN** is a new required secret for Task 9 (job sourcing) only — every other task needs no new environment variables.

---

## Task 1: Remove "Advocate" branding, standardize on "Resume Copilot"

**Files:**
- Modify: `public/js/app.js:109` (nav brand link text)
- Modify: `public/js/profile.js:24,31,46` (progress-dot color var references are fine to keep as-is since they're the CSS var name not brand text; only line 46's copy string changes)
- Modify: `public/profile.html:6`, `public/outreach.html:6` (page `<title>`)

**Interfaces:** None — this is a text-only change, no function signatures affected.

- [ ] **Step 1: Fix the nav brand text**

In `public/js/app.js`, find the `renderNav` function's template (currently around line 109):
```js
<a href="index.html" class="brand"><span class="brand-mark">A</span> Advocate</a>
```
Change to:
```js
<a href="index.html" class="brand"><span class="brand-mark">R</span> Resume Copilot</a>
```

- [ ] **Step 2: Fix the onboarding wizard's welcome copy**

In `public/js/profile.js`, `renderStep1()` (currently around line 46):
```js
document.getElementById("stepTitle").textContent = "Welcome to Advocate. Let's build your profile.";
```
Change to:
```js
document.getElementById("stepTitle").textContent = "Welcome to Resume Copilot. Let's build your profile.";
```

- [ ] **Step 3: Fix page titles**

In `public/profile.html`, change `<title>Profile · Advocate</title>` to `<title>Profile · Resume Copilot</title>`.
In `public/outreach.html`, change `<title>Outreach Studio · Advocate</title>` to `<title>Outreach Studio · Resume Copilot</title>`.

- [ ] **Step 4: Verify no "Advocate" text remains anywhere user-visible**

Run: `grep -rniI "advocate" public/ --include="*.html" --include="*.js" | grep -v "advocate-"`
Expected: no output (the only remaining hits should be the `--advocate-*` CSS variable *names*, which this grep excludes via the `advocate-` filter — those are internal token names, not user-facing text, and stay unchanged per Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js public/js/profile.js public/profile.html public/outreach.html
git commit -m "fix: remove leftover Advocate branding, standardize on Resume Copilot"
```

---

## Task 2: New color palette

**Files:**
- Modify: `public/css/styles.css` (the `:root { --advocate-*: ...; }` token block from the original redesign, plus the second `:root` block that repoints semantic tokens like `--accent`/`--accent-soft`)

**Interfaces:** None — same CSS variable names, new hex values. Every component built against `var(--advocate-*)` or the semantic `--accent`/`--success`/etc. tokens picks up the new palette automatically, exactly like the original Advocate redesign's token-repoint strategy worked.

**Rationale (for context, not to paste into the CSS as a giant comment — a short one-line comment per changed block is enough):** The prior palette was blue-indigo Material-style — professional but generic, indistinguishable from a hundred other SaaS dashboards, and named after a mockup ("Advocate") that was never the app's real identity. This palette leans into what the app actually is — a personal tool for tracking a job search — with a deep teal (calm, focused, distinct from both "corporate blue" and "AI-generated near-black") as the dominant brand color, and reserves a single warm coral accent exclusively for the moments that matter: primary call-to-action buttons and the match-score indicator. Status colors (success/warn/danger) stay in their own distinct hue family so they never compete visually with the coral action color.

- [ ] **Step 1: Replace the Advocate token block's hex values**

In `public/css/styles.css`, find the `:root { --advocate-primary: #0050cb; ... }` block (added in the original redesign's Task 1) and replace every value with the Global Constraints palette above:

```css
:root {
  --advocate-primary: #1D4E4B;
  --advocate-primary-container: #D7E8E5;
  --advocate-secondary: #E8543D;
  --advocate-success: #2F9E5C;
  --advocate-success-soft: #E1F5E9;
  --advocate-warn: #C98A1D;
  --advocate-warn-soft: #FBECD3;
  --advocate-danger: #C1392B;
  --advocate-danger-soft: #F8DFDB;
  --advocate-surface: #F6F7F6;
  --advocate-surface-container: #EAEDEC;
  --advocate-surface-container-low: #EFF1F0;
  --advocate-surface-container-lowest: #FFFFFF;
  --advocate-surface-container-high: #DEE3E1;
  --advocate-on-surface: #142524;
  --advocate-on-surface-variant: #4B5B59;
  --advocate-outline-variant: #C7D0CE;
}
```

- [ ] **Step 2: Check the semantic-token repoint block for any hardcoded values that need updating too**

The second `:root` block (added in the original redesign, repointing `--bg`, `--surface`, `--accent`, etc. at `var(--advocate-*)`) should already reference the token names rather than raw hex values for most properties — verify this by reading the block. One value was hardcoded rather than tokenized: `--accent-soft: #eeecff;`. Change it to derive from the new coral accent instead:
```css
--accent-soft: #FCE4E0;
```
(A light coral tint consistent with `--advocate-secondary: #E8543D`, replacing the old light-indigo tint that no longer matches.)

- [ ] **Step 3: Check for other hardcoded hex values that escaped the token system**

Run: `grep -n "#[0-9a-fA-F]\{6\}\|#[0-9a-fA-F]\{3\}\b" public/css/styles.css`
Review the output. Two values are already known and expected to need a manual update (from the prior redesign's final review, which flagged them as "escaped the token system"):
- `.status-chip.applied` and `.status-chip.screening`'s background `#dae1ff` — change both to `var(--advocate-primary-container)` (the new soft teal) instead of a hardcoded hex.
- `.match-badge.mid`'s background, also `#dae1ff` — same change, to `var(--advocate-primary-container)`.

Any other hardcoded hex values found by the grep that aren't one of these three and aren't inside a `box-shadow`/`rgba()` (which legitimately need raw color math) should be flagged in your report as a concern rather than guessed at — don't invent a new color for something the plan didn't anticipate.

- [ ] **Step 4: Verify visually**

Run: `npm run lint` (expect clean — this is CSS, lint won't catch color issues, but confirms nothing else broke).
Run: `npm run dev`, open `index.html`, `tailor.html`, and `application.html` in a browser if available. Expected: the app now reads as deep teal (nav, active states, links) with a single warm coral color appearing only on primary buttons and match-score indicators — no more blue-indigo. If no browser is available, do a careful static read of `styles.css` confirming every `.btn` (non-secondary), `.match-badge` fill colors, and nav active-state rules resolve to the new tokens, and note in your report that visual confirmation is pending a browser session.

- [ ] **Step 5: Commit**

```bash
git add public/css/styles.css
git commit -m "style: replace the blue-indigo Advocate palette with a deep teal + coral scheme"
```

---

## Task 3: Favicon

**Files:**
- Modify: `public/index.html`, `public/application.html`, `public/cv-store.html`, `public/tailor.html`, `public/job-search.html`, `public/profile.html`, `public/outreach.html` (each file's `<head>`)

**Interfaces:** None.

- [ ] **Step 1: Design the favicon as an inline SVG data URI**

No build step exists for image assets, so rather than adding a binary `.ico`/`.png` file (which would need its own fetch, its own cache-busting story, and doesn't fit this project's zero-asset-pipeline convention), use an inline SVG data URI directly in each page's `<head>` — this is a single line, no new file, and renders crisply at any size. The mark: a simple rounded-square with a stylized "R" monogram matching the nav's `brand-mark` treatment (`public/css/styles.css`'s `.brand-mark` rule — 8px-radius teal square, white letter), so the browser tab icon and the in-app logo read as the same mark.

Add this exact line inside every page's `<head>`, right after the `<meta name="viewport" ...>` line:

```html
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231D4E4B'/%3E%3Ctext x='16' y='23' font-family='Arial,sans-serif' font-size='19' font-weight='700' fill='white' text-anchor='middle'%3ER%3C/text%3E%3C/svg%3E" />
```

- [ ] **Step 2: Add it to all 7 HTML files**

Add the exact line from Step 1 to `public/index.html`, `public/application.html`, `public/cv-store.html`, `public/tailor.html`, `public/job-search.html`, `public/profile.html`, and `public/outreach.html` — same line, same position (right after the viewport meta tag), in every file.

- [ ] **Step 3: Verify**

Run: `npm run dev`, open any page. Expected: the browser tab shows a small teal square with a white "R" instead of the default blank-document icon. Run `grep -c "rel=\"icon\"" public/*.html` — expected: `1` for each of the 7 files.

- [ ] **Step 4: Commit**

```bash
git add public/*.html
git commit -m "feat: add a favicon (inline SVG monogram matching the nav brand mark)"
```

---

## Task 4: Nav avatar becomes a Profile/Settings menu

**Files:**
- Modify: `public/js/app.js` (`renderNav`, and its top-level nav CSS in `public/css/styles.css`)
- Modify: `public/js/profile.js` (`renderSettled` — remove the now-redundant standalone Log out button)

**Interfaces:**
- `renderNav(active)`'s signature and call sites are unchanged. Its markup changes: the 4-tab nav (Search/Tailor/Applications/Profile) becomes 3 tabs (Search/Tailor/Applications); the separate gear icon button is removed (the dropdown replaces its function); the avatar circle becomes a `<button>` that toggles a dropdown menu with two items: "Profile & Settings" (→ `profile.html`) and "Log out" (→ `/cdn-cgi/access/logout`).

- [ ] **Step 1: Rewrite `renderNav`'s markup and wiring**

Replace `renderNav` in `public/js/app.js` (currently defined with a `links` array of 4 entries and a separate gear icon button):

```js
export function renderNav(active) {
  const links = [
    ["job-search.html", "Search", "search"],
    ["tailor.html", "Tailor", "edit"],
    ["index.html", "Applications", "list"],
  ];
  const el = document.getElementById("topnav");
  if (!el) return;
  el.innerHTML = `
    <header class="topbar">
      <a href="index.html" class="brand"><span class="brand-mark">R</span> Resume Copilot</a>
      <nav class="tabs">
        ${links
          .map(
            ([href, label, iconName]) =>
              `<a href="${href}" class="${active === href ? "active" : ""}">${icon(iconName)}${label}</a>`
          )
          .join("")}
      </nav>
      <div class="row" style="gap: 10px; position: relative;">
        <a class="btn" href="index.html?new=1" id="topnavNewApp">${icon("plus")} New Application</a>
        <button class="icon-btn" title="Notifications" disabled>${icon("bell")}</button>
        <button class="avatar-circle" id="avatarMenuBtn" title="Profile & Settings" style="border:none; cursor:pointer;">?</button>
        <div class="avatar-menu" id="avatarMenu" style="display:none;">
          <a href="profile.html">${icon("user")} Profile &amp; Settings</a>
          <button type="button" id="navLogoutBtn">Log out</button>
        </div>
      </div>
    </header>`;

  const menuBtn = document.getElementById("avatarMenuBtn");
  const menu = document.getElementById("avatarMenu");
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "flex" : "none";
  };
  document.addEventListener("click", () => { menu.style.display = "none"; });

  document.getElementById("navLogoutBtn").onclick = () => {
    location.href = "/cdn-cgi/access/logout";
  };

  fetch("/api/auth/me")
    .then((r) => r.json())
    .then(({ email }) => {
      if (email) {
        menuBtn.textContent = email[0].toUpperCase();
        menuBtn.title = email;
      }
    })
    .catch(() => {});
}
```

Note the removed `#logoutBtn` optional-chaining line from the previous version is gone entirely now — logout is wired directly above via `#navLogoutBtn`, which this same function creates, so there's no stale-reference risk.

- [ ] **Step 2: Add avatar-menu CSS**

Append to `public/css/styles.css`:

```css
.avatar-menu {
  position: absolute; top: 44px; right: 0; z-index: 20;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: var(--shadow); min-width: 190px; padding: 6px; flex-direction: column; gap: 2px;
}
.avatar-menu a, .avatar-menu button {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px;
  text-decoration: none; color: var(--ink); font-size: 13.5px; font-weight: 500;
  background: none; border: none; text-align: left; cursor: pointer; font-family: inherit;
}
.avatar-menu a:hover, .avatar-menu button:hover { background: var(--advocate-surface-container-low); }
```

- [ ] **Step 3: Remove the now-redundant Log out button from the settled Profile view**

In `public/js/profile.js`'s `renderSettled` function, remove this line from the template (the standalone logout card, now redundant since the nav dropdown provides it everywhere):
```html
    <div class="card"><button class="btn secondary" id="logoutBtn">Log out</button></div>
```
And remove its corresponding wiring line:
```js
  document.getElementById("logoutBtn").onclick = () => (location.href = "/cdn-cgi/access/logout");
```

- [ ] **Step 4: Verify**

Run: `npm run lint`. Run: `npm run dev`, open any page. Expected: nav shows 3 tabs (Search/Tailor/Applications), no separate Profile tab, no separate gear icon; clicking the avatar circle opens a small dropdown with "Profile & Settings" and "Log out"; clicking elsewhere closes it; clicking "Profile & Settings" navigates to `profile.html`. Audit every `getElementById`/`querySelector` call in the new code for uniqueness (this codebase has a documented history of exactly this class of bug — see `public/js/profile.js`'s `wizardFooter` fix from the prior redesign) and report the audit result explicitly.

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js public/js/profile.js public/css/styles.css
git commit -m "feat: turn the nav avatar into a working Profile/Settings menu"
```

---

## Task 5: Schema — structured resume parsing storage

**Files:**
- Modify: `schema.sql`
- Modify: `src/lib/db.js`

**Interfaces:**
- `cvFromRow` gains `parsedJson: r.parsed_json ? JSON.parse(r.parsed_json) : null` in its returned object.
- `createCv(db, cv)` accepts an optional `cv.parsedJson` (a plain object or `null`) and stores it JSON-stringified.
- New: `updateCvParsedJson(db, id, parsedJson) -> Promise<cv>` — sets `parsed_json` on an existing row (used when parsing happens as a follow-up call after upload, not at insert time).

- [ ] **Step 1: Add the column to `schema.sql`**

In `schema.sql`, add `parsed_json TEXT` to the `cvs` table definition, right after `original_filename`:

```sql
  original_filename TEXT,
  parsed_json       TEXT,
  created_at        TEXT NOT NULL
```

- [ ] **Step 2: Apply the migration to local and remote D1**

Local:
```bash
npx wrangler d1 execute resume-copilot --local --command="ALTER TABLE cvs ADD COLUMN parsed_json TEXT;"
npm run db:init:local
```

Remote (this app is live — the prior redesign's migration note about running `ALTER TABLE` before `db:init` against remote applies here too):
```bash
npx wrangler d1 execute resume-copilot --remote --command="ALTER TABLE cvs ADD COLUMN parsed_json TEXT;"
npm run db:init
```

Expected: both commands succeed. If either `ALTER TABLE` errors with "duplicate column name," it's already been applied — safe to ignore and continue.

- [ ] **Step 3: Update `cvFromRow`, `createCv`, and add `updateCvParsedJson` in `src/lib/db.js`**

Update `cvFromRow` (add one field):
```js
const cvFromRow = (r) =>
  r && {
    id: r.id,
    label: r.label,
    content: r.content,
    isMaster: !!r.is_master,
    parentId: r.parent_id,
    sourceFile: r.source_file ?? undefined,
    originalKey: r.original_key ?? null,
    originalFilename: r.original_filename ?? null,
    parsedJson: r.parsed_json ? JSON.parse(r.parsed_json) : null,
    createdAt: r.created_at,
  };
```

Update `createCv`'s INSERT to include the new column:
```js
export async function createCv(db, cv) {
  const stmts = [];
  if (cv.isMaster) stmts.push(db.prepare("UPDATE cvs SET is_master = 0"));
  stmts.push(
    db
      .prepare(
        `INSERT INTO cvs
           (id, label, content, is_master, parent_id, source_file,
            original_key, original_filename, parsed_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        cv.id,
        cv.label,
        cv.content,
        cv.isMaster ? 1 : 0,
        cv.parentId ?? null,
        cv.sourceFile ?? null,
        cv.originalKey ?? null,
        cv.originalFilename ?? null,
        cv.parsedJson ? JSON.stringify(cv.parsedJson) : null,
        cv.createdAt
      )
  );
  await db.batch(stmts);
  return cv;
}
```

Add a new function right after `createCv`:
```js
export async function updateCvParsedJson(db, id, parsedJson) {
  await db
    .prepare("UPDATE cvs SET parsed_json = ? WHERE id = ?")
    .bind(JSON.stringify(parsedJson), id)
    .run();
  return getCv(db, id);
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint`. Run:
```bash
npx wrangler d1 execute resume-copilot --local --command="PRAGMA table_info(cvs);"
```
Expected: a `parsed_json` row in the output.

- [ ] **Step 5: Commit**

```bash
git add schema.sql src/lib/db.js
git commit -m "feat: add parsed_json column and helpers for structured resume data"
```

---

## Task 6: Backend — parse an uploaded resume into structured fields

**Files:**
- Modify: `src/routes/cvs.js`

**Interfaces:**
- New route: `POST /api/cvs/:id/parse` — no request body. Reads the CV's existing `content`, asks the LLM to extract structured fields, saves them via `db.updateCvParsedJson`, and returns `{ ...cv, parsedJson }`.
- Response shape for `parsedJson` (the exact JSON structure the LLM is asked to return, and what Task 7's frontend renders):
  ```
  {
    name: string,
    title: string,          // e.g. "Senior Frontend Developer"
    email: string,          // "" if not found
    phone: string,          // "" if not found
    location: string,       // "" if not found
    links: string[],        // e.g. ["github.com/alexm", "linkedin.com/in/alexm"]
    summary: string,        // 1-3 sentence professional summary
    experience: [{ role: string, company: string, dates: string, bullets: string[] }],
    education: [{ degree: string, school: string, dates: string }],
    skills: string[]
  }
  ```

- [ ] **Step 1: Add the parse route**

In `src/routes/cvs.js`, add this route after the existing `router.post("/upload", ...)` route (both create/modify a CV, so grouping them is consistent with the file's existing organization):

```js
router.post("/:id/parse", async (c) => {
  const id = c.req.param("id");
  const cv = await db.getCv(c.env.DB, id);
  if (!cv) return c.json({ error: "CV not found" }, 404);

  const stable =
    `You extract structured data from resumes. Return ONLY the requested ` +
    `JSON -- no commentary, no markdown fencing outside the one code block ` +
    `asked for. Never invent information that isn't in the source text; use ` +
    `an empty string or empty array for anything you can't find.`;

  const prompt =
    `Resume text:\n"""\n${cv.content}\n"""\n\n` +
    `Extract this exact JSON shape, inside a fenced block starting with ` +
    `\`\`\`JSON and ending with \`\`\`:\n` +
    `{"name": string, "title": string, "email": string, "phone": string, ` +
    `"location": string, "links": string[], "summary": string, ` +
    `"experience": [{"role": string, "company": string, "dates": string, ` +
    `"bullets": string[]}], "education": [{"degree": string, "school": ` +
    `string, "dates": string}], "skills": string[]}`;

  const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 4000 });

  let parsedJson;
  try {
    parsedJson = JSON.parse(text.match(/```JSON\n([\s\S]*?)\n```/)?.[1] || "{}");
  } catch {
    parsedJson = null;
  }
  if (!parsedJson) return c.json({ error: "Couldn't parse the resume into structured fields. Try again, or continue without it." }, 502);

  await db.updateCvParsedJson(c.env.DB, id, parsedJson);
  return c.json({ ...cv, parsedJson });
});
```

Add the missing imports at the top of the file if not already present: `import { runTask } from "../lib/llm.js";` (check the existing import block first — this file may already import it for another route; if it does, don't duplicate the import).

- [ ] **Step 2: Verify**

Run: `npm run lint`. Run: `npm run dev`, upload a test resume via `curl -F "file=@some-resume.docx" localhost:8787/api/cvs/upload` to get a CV id, then:
```bash
curl -s -X POST localhost:8787/api/cvs/<id>/parse | jq
```
Expected: `200` with a `parsedJson` object matching the shape above, populated with real extracted fields from the test resume (requires a working LLM provider key locally).

- [ ] **Step 3: Commit**

```bash
git add src/routes/cvs.js
git commit -m "feat: add resume parsing endpoint that extracts structured fields"
```

---

## Task 7: Frontend — render the parsed resume during onboarding

**Files:**
- Create: `public/js/resume-view.js`
- Modify: `public/js/profile.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- `renderResumeView(container, parsedJson) -> void` — renders the structured resume shape from Task 6 as a clean, read-only preview card into `container`. Exported for reuse (this plan only wires it into onboarding, but it's written generically enough that a future task could reuse it in CV Store without changes).
- `renderStep1()` in `profile.js` no longer auto-advances straight to step 2 after a successful upload/manual entry — it now calls the parse endpoint, shows a loading state, then renders the structured preview with a "Looks good — continue" action before advancing.

- [ ] **Step 1: Write the resume-view renderer**

```js
// public/js/resume-view.js
//
// Renders the structured JSON shape produced by POST /api/cvs/:id/parse
// (see src/routes/cvs.js) as a read-only resume preview -- used right after
// upload/manual entry in onboarding so the user can confirm what was
// captured before moving on.

import { escapeHtml, safeUrl } from "./app.js";

export function renderResumeView(container, parsed) {
  if (!parsed) {
    container.innerHTML = `<p class="muted">Nothing parsed yet.</p>`;
    return;
  }

  const links = (parsed.links || [])
    .map((l) => {
      const url = safeUrl(l.startsWith("http") ? l : `https://${l}`);
      return url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(l)}</a>`
        : escapeHtml(l);
    })
    .join(" · ");

  const experience = (parsed.experience || [])
    .map(
      (job) => `
      <div style="margin-bottom:14px;">
        <div class="row between">
          <strong>${escapeHtml(job.role || "")}</strong>
          <span class="muted">${escapeHtml(job.dates || "")}</span>
        </div>
        <div class="muted">${escapeHtml(job.company || "")}</div>
        ${
          job.bullets?.length
            ? `<ul style="margin:6px 0 0 20px;">${job.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
            : ""
        }
      </div>`
    )
    .join("");

  const education = (parsed.education || [])
    .map(
      (ed) => `
      <div class="row between" style="margin-bottom:6px;">
        <span>${escapeHtml(ed.degree || "")} ${ed.school ? "&mdash; " + escapeHtml(ed.school) : ""}</span>
        <span class="muted">${escapeHtml(ed.dates || "")}</span>
      </div>`
    )
    .join("");

  const skills = (parsed.skills || [])
    .map((s) => `<span class="pill muted">${escapeHtml(s)}</span>`)
    .join(" ");

  container.innerHTML = `
    <div class="resume-view">
      <h2 style="margin-bottom:2px;">${escapeHtml(parsed.name || "")}</h2>
      ${parsed.title ? `<p style="color:var(--advocate-primary); font-weight:600; margin:0 0 6px;">${escapeHtml(parsed.title)}</p>` : ""}
      <p class="muted" style="margin:0 0 14px;">
        ${[parsed.location, parsed.email, parsed.phone].filter(Boolean).map(escapeHtml).join(" · ")}
        ${links ? " · " + links : ""}
      </p>
      ${parsed.summary ? `<p style="margin-bottom:16px;">${escapeHtml(parsed.summary)}</p>` : ""}
      ${experience ? `<h3 class="muted" style="text-transform:uppercase; font-size:12px; letter-spacing:0.04em;">Experience</h3>${experience}` : ""}
      ${education ? `<h3 class="muted" style="text-transform:uppercase; font-size:12px; letter-spacing:0.04em;">Education</h3>${education}` : ""}
      ${skills ? `<h3 class="muted" style="text-transform:uppercase; font-size:12px; letter-spacing:0.04em;">Skills</h3><div class="tag-list">${skills}</div>` : ""}
    </div>`;
}
```

- [ ] **Step 2: Add resume-view CSS**

Append to `public/css/styles.css`:
```css
.resume-view {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 24px; max-height: 420px; overflow-y: auto;
}
.resume-view h3 { margin: 16px 0 8px; }
.resume-view h3:first-of-type { margin-top: 4px; }
```

- [ ] **Step 3: Wire parsing + preview into the onboarding flow**

In `public/js/profile.js`, add the import:
```js
import { renderResumeView } from "./resume-view.js";
```

Replace `renderStep1`'s two success handlers (the file upload `onchange` and the manual-entry `onclick`) so that instead of immediately setting `step = 2; renderOnboarding();`, they call a new shared function that parses and previews first:

```js
async function parseAndPreview(cvId) {
  const status = document.getElementById("uploadStatus");
  if (status) status.innerHTML = `<span class="spinner"></span> reading your resume…`;
  document.getElementById("stepBody").innerHTML = `<p class="muted"><span class="spinner"></span> Parsing your resume…</p>`;
  let parsedJson = null;
  try {
    const result = await api(`/cvs/${cvId}/parse`, { method: "POST" });
    parsedJson = result.parsedJson;
  } catch {
    // Parsing is a nice-to-have preview, not a hard requirement -- fall
    // through to manual continue below even if it failed.
  }

  document.getElementById("stepBody").innerHTML = `<div id="resumePreview"></div>`;
  if (parsedJson) {
    renderResumeView(document.getElementById("resumePreview"), parsedJson);
  } else {
    document.getElementById("resumePreview").innerHTML =
      `<p class="muted">We saved your resume, but couldn't generate a structured preview. You can still continue.</p>`;
  }

  const footer = document.getElementById("wizardFooter");
  const cont = document.createElement("button");
  cont.className = "btn";
  cont.textContent = "Looks good — continue";
  cont.onclick = () => { step = 2; renderOnboarding(); };
  footer.insertBefore(cont, document.getElementById("skipBtn"));
}
```

Change the file-upload handler's success path from:
```js
      await api("/cvs/upload", { method: "POST", body: form });
      step = 2;
      renderOnboarding();
```
to:
```js
      const cv = await api("/cvs/upload", { method: "POST", body: form });
      await parseAndPreview(cv.id);
```

Change the manual-entry handler's success path from:
```js
      await api("/cvs", { method: "POST", body: { label: "My resume", content, isMaster: true } });
      step = 2;
      renderOnboarding();
```
to:
```js
      const cv = await api("/cvs", { method: "POST", body: { label: "My resume", content, isMaster: true } });
      await parseAndPreview(cv.id);
```

- [ ] **Step 4: Verify**

Run: `npm run lint`. Run: `npm run dev`, reset the local DB (`npm run db:reset:local`), open `profile.html`, upload a real resume file. Expected: after upload, a loading spinner, then a rendered resume preview (name, title, contact, experience, education, skills) with a "Looks good — continue" button that advances to Step 2. If parsing fails (e.g. no LLM key locally), expected: the fallback "couldn't generate a preview" message with the continue button still present and functional.

- [ ] **Step 5: Commit**

```bash
git add public/js/resume-view.js public/js/profile.js public/css/styles.css
git commit -m "feat: parse uploaded resumes into structured fields and render a preview during onboarding"
```

---

## Task 8: Delete-account procedure

**Files:**
- Modify: `src/lib/db.js`
- Create: `src/routes/account.js`
- Modify: `src/index.js`
- Modify: `public/js/profile.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- New `db.js` function: `deleteAllData(db) -> Promise<{ cvIds: string[] }>` — deletes every row from every table (in FK-safe order) and returns the list of CV ids that existed, so the route layer can clean up their R2 originals (R2 access lives in the route, not `db.js`, consistent with this codebase's existing separation — `db.js` never touches R2).
- New route: `DELETE /api/account` — body `{ confirm: "DELETE" }` (a simple typed-confirmation guard against an accidental call; this is NOT a security boundary, just a UX safety net against misclicks, since the route is already behind `requireAuth()`). Wipes D1 (via `deleteAllData`) and every R2 original file, returns `204`.

- [ ] **Step 1: Add `deleteAllData` to `src/lib/db.js`**

Append to `src/lib/db.js`:

```js
// --- Account deletion --------------------------------------------------------
//
// This app has no per-user data model (every table is globally shared once
// past Cloudflare Access) -- see the plan's Global Constraints. "Delete my
// account" therefore means "wipe everything," the same scope db:reset:local
// already covers for local dev, just against the live database and also
// clearing R2 originals (handled by the route layer, which owns the R2
// binding -- this module never touches R2).
export async function deleteAllData(db) {
  const { results } = await db.prepare("SELECT id FROM cvs").all();
  const cvIds = results.map((r) => r.id);

  await db.batch([
    db.prepare("DELETE FROM chat_messages"),
    db.prepare("DELETE FROM documents"),
    db.prepare("DELETE FROM activity_events"),
    db.prepare("DELETE FROM templates"),
    db.prepare("DELETE FROM applications"),
    db.prepare("DELETE FROM cvs"),
    db.prepare("DELETE FROM profile"),
    db.prepare("DELETE FROM token_usage"),
  ]);

  return { cvIds };
}
```

- [ ] **Step 2: Create the account route**

```js
// src/routes/account.js
//
// Account deletion. See db.js's deleteAllData for why this wipes
// everything rather than scoping to "one user's rows" -- there is no
// per-user row to scope to in this app's current data model.

import { Hono } from "hono";
import * as db from "../lib/db.js";
import { deleteOriginal } from "../lib/r2.js";

const router = new Hono();

router.delete("/", async (c) => {
  const { confirm } = await c.req.json().catch(() => ({}));
  if (confirm !== "DELETE")
    return c.json({ error: 'Send {"confirm":"DELETE"} to confirm this irreversible action.' }, 400);

  const cvs = await db.listCvs(c.env.DB);
  const { cvIds } = await db.deleteAllData(c.env.DB);

  if (c.env.ORIGINALS) {
    for (const cv of cvs) {
      if (cv.hasOriginal) {
        // listCvs() summarizes rows and doesn't expose the raw R2 key, so
        // re-fetch each full row to get it -- account deletion is rare
        // enough that N+1 here is the right tradeoff over widening
        // listCvs()'s return shape for every other caller.
        const full = await db.getCv(c.env.DB, cv.id).catch(() => null);
        if (full?.originalKey) await deleteOriginal(c.env.ORIGINALS, full.originalKey).catch(() => {});
      }
    }
  }

  return c.body(null, 204);
});

export default router;
```

Note: this route runs its DB wipe (`deleteAllData`) *before* attempting the R2 cleanup, deliberately -- if R2 cleanup partially fails, the user's data is still gone from D1 (the part that matters most for "delete my account"), and a few orphaned R2 objects are a cheap, non-sensitive leftover rather than a correctness problem the user would notice.

- [ ] **Step 3: Mount the route**

In `src/index.js`, add the import next to the other route imports:
```js
import accountRouter from "./routes/account.js";
```
And mount it next to the other `app.route(...)` calls:
```js
app.route("/api/account", accountRouter);
```

- [ ] **Step 4: Add a Danger Zone to the settled Profile view, with typed confirmation**

In `public/js/profile.js`'s `renderSettled` function, add this block to the end of the template string (after the existing `<div class="grid cols-2">...</div>`, before the closing backtick):

```html
    <div class="card" style="border-color: var(--danger);">
      <h2 style="color: var(--danger);">Danger zone</h2>
      <p class="muted">Permanently delete your resume, applications, generated documents, and preferences. This cannot be undone.</p>
      <label>Type DELETE to confirm</label>
      <input type="text" id="deleteConfirmInput" placeholder="DELETE" />
      <button class="btn danger" id="deleteAccountBtn" style="margin-top:12px;" disabled>Delete my account</button>
    </div>
```

Add its wiring at the end of `renderSettled` (after the existing `logoutBtn` removal from Task 4 -- there's no `logoutBtn` reference left in this function to worry about colliding with):

```js
  const deleteInput = document.getElementById("deleteConfirmInput");
  const deleteBtn = document.getElementById("deleteAccountBtn");
  deleteInput.oninput = () => { deleteBtn.disabled = deleteInput.value !== "DELETE"; };
  deleteBtn.onclick = async () => {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting…";
    try {
      await api("/account", { method: "DELETE", body: { confirm: "DELETE" } });
      location.href = "/cdn-cgi/access/logout";
    } catch (err) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete my account";
      showError(main, err);
    }
  };
```

- [ ] **Step 5: Verify**

Run: `npm run lint`. Run: `npm run dev` against a **local** database only (never test this against remote/production data): `npm run db:reset:local` first to get a clean local DB, seed a CV via the UI or `curl`, then in the browser confirm the Delete button stays disabled until "DELETE" is typed exactly, then click it and confirm: the API call succeeds (`204`), you're redirected to the Access logout path, and `curl localhost:8787/api/cvs` (with a fresh auth) now returns `[]`.

**Do not run this against the remote/production database as part of verification** — the button and endpoint being reachable and correctly gated is what this step confirms; actually executing it against live data is not something this task's verification requires or should risk.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.js src/routes/account.js src/index.js public/js/profile.js public/css/styles.css
git commit -m "feat: add a delete-account procedure with typed confirmation"
```

---

## Task 9: Job search — add Apify's ATS scraper as a second source

**Files:**
- Create: `src/lib/apify.js`
- Modify: `src/routes/jobsearch.js`
- Modify: `public/js/job-search.js`
- Modify: `.env.example`
- Modify: `README.md`

**Corrected actor contract (verified against the actor's actual documented input/output — this supersedes an earlier draft of this task that assumed a free-text search API):** `fantastic-jobs/jobs-scraper` does NOT take a `search`/`location` query. Its input is `startUrls`: an explicit list of company career-page URLs on supported ATS platforms (e.g. `https://boards.greenhouse.io/{company}`, `https://jobs.lever.co/{company}`, `https://jobs.ashbyhq.com/{company}`, `https://{company}.wd5.myworkdayjobs.com/...`). It scrapes exactly those companies' listings and returns one object per job: `{title, description, locations: string[], url, date_posted}` — notably **no `company` or `salary` field**. This makes the integration a curated watchlist ("track these specific companies' openings"), not a dynamic search — company name has to come from the caller's own `startUrls` list (paired alongside each URL), not from the actor's output.

**Interfaces:**
- New: `runApifyAtsSearch({ apiToken, watchlist }) -> Promise<{ jobs: Array<{title, company, location, url, compEstimate, source: "ats"}>, error: string|null }>`, where `watchlist` is `Array<{url: string, company: string}>`. Calls the actor via its synchronous "run and get dataset items" REST endpoint with `{ startUrls: watchlist.map(w => ({url: w.url})) }`. Company name for each returned job is resolved by matching the job's `url` against the watchlist entry it came from (prefix match), not read from the actor's output (which doesn't have one). Never throws on a normal API failure (missing token, empty watchlist, actor error, timeout) -- returns `{ jobs: [], error: "<reason>" }` instead (or `{ jobs: [], error: null }` for the "not configured" case), since this is a secondary, best-effort source and a failure here must not break the primary LLM search. `compEstimate` is always `""` — the actor doesn't return compensation data.
- New env var `APIFY_WATCHLIST`: a JSON-encoded array of `{"url": "...", "company": "..."}` objects, parsed once in `src/routes/jobsearch.js`. This is a personal curation list (which companies' career pages to track) — it lives in an env var, not hardcoded in source, so it's editable per-deployment without a code change. An empty/unset value means the ATS source contributes nothing (same graceful no-op as a missing `APIFY_API_TOKEN`).
- `POST /api/jobsearch/search`'s response gains one field: `atsError: string|null` (surfaced only if the Apify call failed, so the frontend can show a small "ATS search unavailable" note rather than silently dropping results). The existing `text`/`sources` fields are unchanged in shape; jobs from both sources are merged into the SAME `\`\`\`JOBS` block already embedded in `text` (deduplicated by URL, ATS-sourced jobs tagged with `"source": "ats"` in that JSON, web-search-sourced jobs keep their existing implicit web-search origin -- the frontend distinguishes them by checking for that field).

- [ ] **Step 1: Write the Apify client**

```js
// src/lib/apify.js
//
// Calls Apify's fantastic-jobs/jobs-scraper actor -- a deterministic
// scraper that reads each ATS's own public JSON/XML endpoint directly
// (Greenhouse, Lever, Workday, Ashby, and others), rather than an LLM
// guessing at web search results. Runs on Apify's own infrastructure, so
// this is a plain outbound fetch() -- no new hosting for this project.
// $1 per 1,000 job results; Apify's $5/month free platform credits cover
// roughly 5,000 results/month, which is generous for personal-use search
// volume.
//
// The actor takes `startUrls` -- explicit company career-page URLs -- not
// a free-text search query, and its output has no `company`/`salary`
// field. Company name comes from matching each returned job's url against
// the watchlist entry it was scraped from.

const ACTOR = "fantastic-jobs~jobs-scraper";
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

export async function runApifyAtsSearch({ apiToken, watchlist }) {
  if (!apiToken || !watchlist?.length) return { jobs: [], error: null }; // Not configured -- silently skip, not an error state.

  let res;
  try {
    res = await fetch(`${RUN_SYNC_URL}?token=${encodeURIComponent(apiToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startUrls: watchlist.map((w) => ({ url: w.url })) }),
      // Apify's own run can take a while; bound it so a slow/stuck scrape
      // never holds up the whole job-search request past a sane wait.
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    return { jobs: [], error: `ATS search request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `ATS search returned ${res.status}` };
  }

  let items;
  try {
    items = await res.json();
  } catch {
    return { jobs: [], error: "ATS search returned an unreadable response." };
  }

  if (!Array.isArray(items)) return { jobs: [], error: null };

  // Resolve each job's company by which watchlist URL prefixes its own
  // url -- e.g. a job at "https://boards.greenhouse.io/stripe/jobs/123"
  // matches the watchlist entry "https://boards.greenhouse.io/stripe".
  const companyFor = (jobUrl) => watchlist.find((w) => jobUrl?.startsWith(w.url))?.company || "";

  const jobs = items
    .filter((item) => item?.url && item?.title)
    .slice(0, 40) // Cap per-search cost/volume -- this is a supplementary source, not the primary one.
    .map((item) => ({
      title: String(item.title),
      company: companyFor(item.url),
      location: String(item.locations?.[0] || ""),
      url: String(item.url),
      compEstimate: "",
      source: "ats",
    }));

  return { jobs, error: null };
}
```

- [ ] **Step 2: Wire it into the job search route, merged with the LLM results**

In `src/routes/jobsearch.js`, add the import:
```js
import { runApifyAtsSearch } from "../lib/apify.js";
```

Add a watchlist parser near the top of the file (module scope, parsed once, not per-request):
```js
// APIFY_WATCHLIST is a JSON array of {"url","company"} objects -- which
// companies' ATS career pages to scrape. A personal curation list, kept in
// an env var (not hardcoded) so it's editable per-deployment. Malformed or
// unset -> empty list -> the ATS source silently contributes nothing.
function parseWatchlist(env) {
  try {
    const parsed = JSON.parse(env.APIFY_WATCHLIST || "[]");
    return Array.isArray(parsed) ? parsed.filter((w) => w?.url && w?.company) : [];
  } catch {
    return [];
  }
}
```

Change `router.post("/search", ...)` to run both sources in parallel and merge. Find the existing line:
```js
  const { text, sources } = await runWebSearchTask({
    env: c.env,
    stable,
    prompt,
    location: { city, region, country },
  });

  return c.json({ text, sources });
```

Replace it with:
```js
  const [{ text, sources }, atsResult] = await Promise.all([
    runWebSearchTask({ env: c.env, stable, prompt, location: { city, region, country } }),
    runApifyAtsSearch({
      apiToken: c.env.APIFY_API_TOKEN,
      watchlist: parseWatchlist(c.env),
    }),
  ]);

  // Merge the ATS-sourced jobs into the same JOBS block the frontend
  // already parses, deduplicated by URL so a job both sources happen to
  // find isn't shown twice.
  const jobsMatch = text.match(/```JOBS\n([\s\S]*?)\n```/);
  let webJobs = [];
  if (jobsMatch) {
    try { webJobs = JSON.parse(jobsMatch[1]); } catch { webJobs = []; }
  }
  const seenUrls = new Set(webJobs.map((j) => j.url));
  const mergedJobs = [...webJobs, ...atsResult.jobs.filter((j) => !seenUrls.has(j.url))];
  const mergedText = jobsMatch
    ? text.replace(jobsMatch[0], "```JOBS\n" + JSON.stringify(mergedJobs, null, 2) + "\n```")
    : text;

  return c.json({ text: mergedText, sources, atsError: atsResult.error });
```

- [ ] **Step 3: Surface the ATS source and any error in the frontend**

In `public/js/job-search.js`, find `render(data, cvId)`. Add an ATS-error notice right after the existing "Results" card in the returned HTML (before the job-grid block):

```js
  ${data.atsError ? `<div class="error-banner" style="background:var(--warn-soft); color:var(--warn);">ATS search unavailable this time (${escapeHtml(data.atsError)}) -- showing web-search results only.</div>` : ""}
```

In the job-card template (inside the `.map((j, i) => ...)` block), add a small source label next to the match badge:
```js
              ${j.source === "ats" ? `<span class="pill muted" title="Found via direct ATS scraping, not web search">ATS listing</span>` : ""}
```
Place it directly after the existing `matchScore` badge span in that card's header row, so both can show together when a job has both.

- [ ] **Step 4: Document the new environment variable**

In `.env.example`, add:
```
# Optional -- enables a second, deterministic job-search source (Apify's
# fantastic-jobs/jobs-scraper actor, reads ATS platforms' public APIs
# directly). Get a token at https://console.apify.com/settings/integrations.
# Job search works without this -- it just falls back to LLM web search only.
APIFY_API_TOKEN=

# Optional, only used if APIFY_API_TOKEN is set -- a JSON array of company
# career pages to scrape via the actor above, e.g.:
# [{"url":"https://boards.greenhouse.io/yourcompany","company":"Your Company"}]
# The actor scrapes specific companies' ATS career pages (Greenhouse, Lever,
# Ashby, Workday, etc.) -- it does not take a free-text search query, so this
# list is how you tell it which companies to track. Leave empty/unset to
# skip the ATS source entirely (same as leaving APIFY_API_TOKEN unset).
APIFY_WATCHLIST=[]
```

In `README.md`, find the environment variables / secrets section (search for where `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` is documented) and add a parallel entry covering both `APIFY_API_TOKEN` and `APIFY_WATCHLIST` together (a paragraph, not just bare variable names -- match the style already used for the other documented secrets in that section). Explicitly explain that this is a curated company watchlist, not a live search — the user needs to populate `APIFY_WATCHLIST` with real career-page URLs for companies they want tracked (e.g. by finding a company's Greenhouse/Lever/Ashby/Workday careers page URL and adding it to the list) for this source to return anything.

- [ ] **Step 5: Verify**

Run: `npm run lint`. Without `APIFY_API_TOKEN`/`APIFY_WATCHLIST` set, run a job search via `npm run dev` and confirm behavior is unchanged from before this task (LLM search only, no `atsError` shown since a missing token or empty watchlist returns `{ jobs: [], error: null }` per Step 1's design, not an error state). If you have a real Apify API token available, set `APIFY_API_TOKEN` and a real `APIFY_WATCHLIST` (with at least one real, currently-live company career-page URL on Greenhouse/Lever/Ashby) in `.dev.vars`, and re-run a search; expected: some results tagged `"ATS listing"` in the UI, sourced from the Apify actor, with the correct company name attached (verifying the url-prefix-matching in `companyFor` actually works against real actor output, not just the happy-path shape).

- [ ] **Step 6: Commit**

```bash
git add src/lib/apify.js src/routes/jobsearch.js public/js/job-search.js .env.example README.md
git commit -m "feat: add Apify's ATS scraper as a second, deterministic job search source"
```
