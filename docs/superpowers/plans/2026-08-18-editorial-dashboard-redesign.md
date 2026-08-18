# Editorial Dashboard Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace resume-copilot's generic rounded-card SaaS-dashboard look with a calm, precise, editorial visual identity (serif headings, warmer paper-toned surfaces, sharper radii, hairline-rule section dividers as a signature motif) while changing zero IA, routes, or functional behavior.

**Architecture:** This is a CSS-token-and-two-selector-rule change, not a rebuild. Nearly every visual change cascades automatically through `public/css/styles.css`'s existing custom-property system (`.card`, `.column`, `h1`/`h2`, etc. already reference `var(--radius)`/`var(--font-display)`/etc. rather than hardcoded values) — most of the 7 pages need zero direct edits. The two places that DO need direct JS/HTML edits are narrow, explicit exceptions to the new global `h2` rule, identified during plan authorship by auditing every `<h2>` use in the codebase.

**Tech Stack:** Plain CSS custom properties, no build step, no new dependencies (matches the existing zero-framework frontend). Verification uses Playwright, installed as scratch tooling (not a project dependency) to drive a real headless Chromium against `npm run dev` — proven working during this session's job-search bug investigation.

**Spec:** `docs/superpowers/specs/2026-08-18-editorial-dashboard-redesign-design.md` — its Token System, Masthead, and "What does NOT change" sections are the authority this plan implements. Also relevant: `docs/superpowers/specs/2026-08-16-resume-agent-core-design.md` is NOT touched by this plan (no LLM/architecture changes here).

## Global Constraints

- No new npm dependencies, no build step change — pure CSS + two small JS/HTML edits.
- No IA changes: no new pages, no route renames, no nav-label changes (spec's Non-goals section).
- No content/copy changes.
- This project has no automated test suite — verification is Playwright-driven visual screenshots plus `npm run lint`, per the spec's Testing section.
- Playwright is scratch tooling only: install it into a scratch directory outside the repo (never add it to `package.json`), same approach already used and proven in this session (`npm install playwright@1.62.1` in a scratch dir, then symlink `node_modules/playwright` and `node_modules/playwright-core` into the repo's gitignored `node_modules/` for the duration of testing, remove the symlinks before committing). Never commit Playwright, screenshots, or scratch scripts.

---

### Task 1: Token system rewrite (color rename + warmth shift, shadow fix, radius, typography)

**Files:**
- Modify: `public/css/styles.css:1` (Google Fonts import)
- Modify: `public/css/styles.css:3-41` (`:root` token blocks)
- Modify: `public/css/styles.css:371` (`.cv-doc-wrap` hardcoded radius — align to token)
- Modify: every other line in `public/css/styles.css` referencing `--advocate-*` (mechanical rename only, ~40 occurrences total — see Step 3)

**Interfaces:**
- Produces: `--rc-primary`, `--rc-primary-container`, `--rc-secondary`, `--rc-success`, `--rc-success-soft`, `--rc-warn`, `--rc-warn-soft`, `--rc-danger`, `--rc-danger-soft`, `--rc-surface`, `--rc-surface-container`, `--rc-surface-container-low`, `--rc-surface-container-lowest`, `--rc-surface-container-high`, `--rc-on-surface`, `--rc-on-surface-variant`, `--rc-outline-variant` (renamed from `--advocate-*`, same names minus the prefix change, consumed by every other CSS rule in the file and by Task 2's new rules).
- Consumes: nothing (this is the first task; `--advocate-*` is the pre-existing baseline it replaces).

- [ ] **Step 1: Replace the Google Fonts import**

Find (`public/css/styles.css:1`):
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap');
```
Replace with:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap');
```

- [ ] **Step 2: Rewrite the `:root` token blocks**

Find (`public/css/styles.css:3-41`):
```css
:root {
  /* Deep teal + coral palette: calm, focused, distinct brand identity */
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

:root {
  --bg: var(--advocate-surface);
  --surface: var(--advocate-surface-container-lowest);
  --border: var(--advocate-outline-variant);
  --ink: var(--advocate-on-surface);
  --ink-soft: var(--advocate-on-surface-variant);
  --accent: var(--advocate-secondary);
  --accent-soft: #FCE4E0;
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
Replace with:
```css
:root {
  /* Deep teal + coral palette: calm, focused, distinct brand identity.
     Neutrals shifted warmer (paper-toned) for the editorial redesign --
     the brand accents themselves (teal/coral/success/warn/danger) are
     unchanged, only the surface/ink scale moved off cool gray. */
  --rc-primary: #1D4E4B;
  --rc-primary-container: #D7E8E5;
  --rc-secondary: #E8543D;
  --rc-success: #2F9E5C;
  --rc-success-soft: #E1F5E9;
  --rc-warn: #C98A1D;
  --rc-warn-soft: #FBECD3;
  --rc-danger: #C1392B;
  --rc-danger-soft: #F8DFDB;
  --rc-surface: #FAF9F6;
  --rc-surface-container: #F0EEE8;
  --rc-surface-container-low: #F5F3EE;
  --rc-surface-container-lowest: #FFFFFF;
  --rc-surface-container-high: #E5E1D8;
  --rc-on-surface: #1A1A18;
  --rc-on-surface-variant: #5C5A52;
  --rc-outline-variant: #D8D4C8;
}

:root {
  --bg: var(--rc-surface);
  --surface: var(--rc-surface-container-lowest);
  --border: var(--rc-outline-variant);
  --ink: var(--rc-on-surface);
  --ink-soft: var(--rc-on-surface-variant);
  --accent: var(--rc-secondary);
  --accent-soft: #FCE4E0;
  --warn: var(--rc-warn);
  --warn-soft: var(--rc-warn-soft);
  --danger: var(--rc-danger);
  --danger-soft: var(--rc-danger-soft);
  --radius: 6px;
  --shadow: 0 1px 2px rgba(29, 78, 75, 0.06), 0 1px 6px rgba(29, 78, 75, 0.06);
  --font-display: "Source Serif 4", Georgia, "Times New Roman", serif;
  --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-family: var(--font-body);
}
```

- [ ] **Step 3: Rename every remaining `--advocate-` reference to `--rc-` throughout the file**

This is a pure string rename (prefix `--advocate-` → `--rc-`, nothing else changes) applied to every remaining occurrence outside the `:root` block just rewritten in Step 2. Confirmed by grep during plan authorship, the remaining occurrences are on these lines (values/selectors around each `--advocate-*` token are otherwise untouched):

`166, 249, 250, 251, 252, 253, 387, 397, 399, 400, 401, 402, 403, 412, 413, 424, 433, 435, 440, 441, 446, 450, 453, 457, 458, 462, 467, 478, 491, 496, 512, 529, 546, 548, 551, 568`

Example of the mechanical change (line 249, before → after):
```css
.app-card { border-left: 3px solid var(--advocate-outline-variant); }
```
```css
.app-card { border-left: 3px solid var(--rc-outline-variant); }
```

Apply the same `--advocate-` → `--rc-` substitution to every line in the list above. Do not change anything else on those lines (property names, other values, selectors all stay exactly as they are).

- [ ] **Step 4: Align `.cv-doc-wrap`'s hardcoded radius to the token**

Find (`public/css/styles.css:371`, inside the `.cv-doc-wrap` rule):
```css
  border-radius: 12px;
```
Replace with:
```css
  border-radius: var(--radius);
```
(This value was hardcoded to `12px` — the exact old `--radius` value in disguise — rather than referencing the variable. Fixing it so it tracks the new `6px` radius like every other card-shaped element does, instead of silently staying at the old rounder value.)

- [ ] **Step 5: Verify zero remaining `--advocate` references**

Run: `grep -c "advocate" public/css/styles.css`
Expected: `0` (no output lines, or a literal `0` count — the grep should find nothing).

- [ ] **Step 6: Lint**

Run: `npm run lint`. Expected: no errors (this is a CSS-only change; lint won't catch CSS issues, but confirms no JS/HTML was accidentally broken by this task since it only touches `styles.css`).

- [ ] **Step 7: Commit**

```bash
git add public/css/styles.css
git commit -m "feat: rewrite color/type tokens for editorial redesign (warmer surfaces, serif headings, sharper radius)"
```

---

### Task 2: Hairline-rule signature motif + masthead treatment

**Files:**
- Modify: `public/css/styles.css:54-71` (`header.topbar` / `.brand`)
- Modify: `public/css/styles.css:94-95` (`h1`/`h2` rules)
- Modify: `public/js/job-search.js:169` (add `.card-title` class to job-card title)
- Modify: `public/js/resume-view.js:60` (add `.card-title` class to résumé name)

**Interfaces:**
- Consumes: `--rc-*`/`--border`/`--ink`/`--font-display` tokens from Task 1.
- Produces: `.card-title` CSS class (opt-out of the new `h2` rule, for repeated in-card titles) — no other task in this plan consumes it, but it's a stable, reusable class name for any future card-title use.

- [ ] **Step 1: Update the masthead**

Find (`public/css/styles.css:54-63`, the `header.topbar` rule):
```css
header.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}
```
Replace with:
```css
header.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  background: var(--surface);
  border-bottom: 1px solid var(--ink);
  position: sticky;
  top: 0;
  z-index: 10;
}
```
(Only the `border-bottom` color changes, from `var(--border)` — a light hairline — to `var(--ink)`, a stronger masthead-weight rule. Everything else in this rule is unchanged.)

Find (`public/css/styles.css:66-71`, the `header.topbar .brand` rule):
```css
header.topbar .brand {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 19px;
  letter-spacing: 0.01em;
}
```
Replace with:
```css
header.topbar .brand {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 20px;
  letter-spacing: 0.01em;
}
```
(`font-size` only: `19px` → `20px`. This rule already used `var(--font-display)`, so it automatically picks up Source Serif 4 from Task 1 with no other change needed here — the 1px bump is a minor optical correction since serif type reads slightly smaller than the sans it's replacing at the same pixel size.)

- [ ] **Step 2: Add the hairline-rule to section headers, with the "inline summary" exception**

Find (`public/css/styles.css:94-95`):
```css
h1 { font-family: var(--font-display); font-size: 27px; font-weight: 600; margin: 0 0 6px; letter-spacing: 0.002em; }
h2 { font-family: var(--font-display); font-size: 18px; font-weight: 600; margin: 0 0 10px; }
```
Replace with:
```css
h1 { font-family: var(--font-display); font-size: 27px; font-weight: 600; margin: 0 0 6px; letter-spacing: 0.002em; }
h2 { font-family: var(--font-display); font-size: 18px; font-weight: 600; margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }

/* h2 inside a <summary> (collapsible card headers on Tailor Studio) is
   rendered inline so it sits next to the disclosure triangle -- a
   full-width border-bottom on an inline element renders broken, so this
   context opts out of the rule entirely. */
summary h2 { border-bottom: none; padding-bottom: 0; }

/* h2 used as a heading WITHIN rendered document/markdown content (a CV
   body, chat replies, LLM analysis text) is content typography, not app
   chrome -- it must not carry the same section-divider treatment as a
   real page/card section header. */
.cv-doc h2, .doc-content h2, .markdown-body h2 { border-bottom: none; padding-bottom: 0; }

/* Small in-card titles that repeat per list item (a job card's title, a
   parsed résumé's name heading) are content within a card, not a section
   header dividing the card from what comes after it -- opt out the same
   way, and consolidate what used to be an ad-hoc inline margin override
   into one reusable class. */
.card-title { margin: 0 0 2px; border-bottom: none; padding-bottom: 0; }
```

- [ ] **Step 3: Apply `.card-title` to the job-card title**

Find (`public/js/job-search.js:169`):
```js
                <h2 style="margin-bottom:2px;">${escapeHtml(j.title)}</h2>
```
Replace with:
```js
                <h2 class="card-title">${escapeHtml(j.title)}</h2>
```

- [ ] **Step 4: Apply `.card-title` to the résumé name heading**

Find (`public/js/resume-view.js:60`):
```js
      <h2 style="margin-bottom:2px;">${escapeHtml(parsed.name || "")}</h2>
```
Replace with:
```js
      <h2 class="card-title">${escapeHtml(parsed.name || "")}</h2>
```

- [ ] **Step 5: Lint**

Run: `npm run lint`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/css/styles.css public/js/job-search.js public/js/resume-view.js
git commit -m "feat: add hairline-rule section-header motif and masthead treatment"
```

---

### Task 3: Visual verification across all 7 pages

**Files:** None modified — this is a verification-only task.

**Interfaces:**
- Consumes: the complete visual redesign from Tasks 1-2.

- [ ] **Step 1: Install Playwright as scratch tooling (not a project dependency)**

```bash
mkdir -p /tmp/pw-verify-editorial
cd /tmp/pw-verify-editorial
npm init -y > /dev/null 2>&1
npm install playwright@1.62.1
npx playwright install chromium
cd -
ln -s /tmp/pw-verify-editorial/node_modules/playwright node_modules/playwright
ln -s /tmp/pw-verify-editorial/node_modules/playwright-core node_modules/playwright-core
```
(If Chromium is already installed from an earlier session, `npx playwright install chromium` is a fast no-op re-check, not a re-download.)

- [ ] **Step 2: Start the dev server**

```bash
npm run dev > /tmp/dev-verify.log 2>&1 &
disown
sleep 6
curl -s http://localhost:8787/api/cvs | head -c 200
```
Expected: a JSON array (confirms the server is up; SKIP_AUTH must already be set in `.dev.vars`, which it is by default in this project).

- [ ] **Step 3: Screenshot all 7 pages**

```bash
cat > /tmp/screenshot-all.mjs << 'EOF'
import { chromium } from "playwright";

const pages = [
  ["index.html", "index"],
  ["cv-store.html", "cv-store"],
  ["tailor.html", "tailor"],
  ["job-search.html", "job-search"],
  ["outreach.html", "outreach"],
  ["profile.html", "profile"],
];

const browser = await chromium.launch();
for (const [path, name] of pages) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:8787/${path}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `/tmp/screenshot-${name}.png`, fullPage: true });
  console.log(`${name}: screenshot saved, ${errors.length} console/page errors`);
  if (errors.length) console.log(errors.join("\n"));
  await page.close();
}
await browser.close();
EOF
node /tmp/screenshot-all.mjs
```
Expected: 6 lines of output (`index`/`cv-store`/`tailor`/`job-search`/`outreach`/`profile`, each "0 console/page errors" — `application.html` needs a real application id via query string so it's checked separately in Step 5, not in this loop).

- [ ] **Step 4: Read each screenshot and visually confirm the redesign landed correctly**

Use the Read tool on each of the 6 PNG files at `/tmp/screenshot-*.png`. For each, confirm:
- Headings render in a serif typeface (Source Serif 4), not the old sans.
- Section headers (e.g. "Your CVs", "Results", card titles like "Current Status") show a visible hairline rule underneath.
- Surface/background tones read as warm off-white/cream, not cool gray.
- Corners are visibly less rounded than before (sharper, not pill-like).
- No layout breakage: no overlapping text, no obviously broken card boundaries, no missing content.

Specifically for `tailor.html`: confirm the "Target Job Description" and "Match analysis" collapsible headers (inside `<summary>`) do NOT show a hairline rule (the `summary h2` exception from Task 2 should be visibly working — no ugly line cutting through the disclosure triangle row).

Specifically for `job-search.html`: this loads with an empty results area (no search has run), so no job cards are visible yet in this static screenshot — that's expected, not a bug. To confirm the `.card-title` exception actually works, this step's screenshot alone isn't sufficient; note this as a known gap and confirm it separately by running one real search (reuse the same live-search approach from this session's job-search bug investigation: `curl` the SSE endpoint with a real CV id, then load the page and click search in Playwright, screenshotting the result — or, more simply, read `public/js/job-search.js`'s rendered template mentally against the new `.card-title` CSS rule from Task 2 and confirm no `border-bottom`/`padding-bottom` would apply, which is a legitimate code-level check given the CSS rule itself is simple and already visually confirmed working on every other page's card titles).

- [ ] **Step 5: Screenshot `application.html` separately (needs a real application id)**

```bash
cat > /tmp/screenshot-application.mjs << 'EOF'
import { chromium } from "playwright";

const res = await fetch("http://localhost:8787/api/applications");
const apps = await res.json();
if (!apps.length) {
  console.log("No applications exist in the local DB -- skipping this page, not a redesign bug.");
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://localhost:8787/application.html?id=${apps[0].id}`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: "/tmp/screenshot-application.png", fullPage: true });
console.log("application: screenshot saved");
await browser.close();
EOF
node /tmp/screenshot-application.mjs
```
If an application exists, read `/tmp/screenshot-application.png` with the same checklist as Step 4 (this page has the most `<h2>` section headers of any page: "Current Status", "Activity", "Details", "Application Vault", "Tailored CV" — all should show the hairline rule).

- [ ] **Step 6: Clean up scratch tooling**

```bash
rm -f node_modules/playwright node_modules/playwright-core
rm -f /tmp/screenshot-*.png /tmp/screenshot-all.mjs /tmp/screenshot-application.mjs /tmp/dev-verify.log
```
(Leave `/tmp/pw-verify-editorial` itself — it's outside the repo and can be reused by a future verification pass without re-downloading Chromium.)

- [ ] **Step 7: Final lint pass**

Run: `npm run lint`. Expected: no errors (confirms Tasks 1-2's combined diff is still clean).

No commit for this task — it modifies no files.

---

## Self-review notes (already applied above, recorded for the record)

- **Spec coverage:** every section of the design spec (Token System's Color/Shadow/Typography/Radius, the hairline-rule motif, the Masthead, "What does NOT change") maps onto Tasks 1-2. The spec's "Open questions" section — the `<h2 style="display:inline;">` exception — was resolved during plan authorship via a full audit of every `<h2>` use in the codebase (26 total occurrences found and classified), not left open: the plan's Task 2 Step 2 covers all three exception categories found (inline-summary headers, document-rendered content headings, repeated in-card titles), not just the one case the spec flagged.
- **Type/selector consistency:** `.card-title` is defined once (Task 2 Step 2) and consumed by exactly the two places that need it (Task 2 Steps 3-4) — verified no other `<h2>` in the codebase needs it (the other 24 occurrences are genuine section headers that should keep the new rule, confirmed by reading every one during plan authorship).
- **Non-goals honored:** no IA changes, no new dependencies, no `.btn`/`.pill`/input styling touched, matching the spec's explicit scope boundary.
