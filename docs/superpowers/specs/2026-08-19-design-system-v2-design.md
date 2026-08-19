# Design System v2: Calm Minimalism — Design

**Status:** Approved by user in conversation on 2026-08-19. Ready for `superpowers:writing-plans`. First of a 5-part roadmap (design system → unified Applications+Search page → activity graph → map/company enrichment → unified ranking view); this spec covers part 1 only.

**Context:** The first redesign round (token rename + serif headings + hairline-rule motif, `docs/superpowers/specs/2026-08-18-editorial-dashboard-redesign-design.md`) and the Tracker structural redesign (`docs/superpowers/specs/2026-08-18-tracker-structural-redesign-design.md`) both shipped and were confirmed live, but user feedback was "it does not feel particularly right" — too subtle, still reads as generic. This spec switches the active design skills from `design-taste-frontend` to a pairing better calibrated to "calm": `redesign-existing-projects` (process — audit existing code, fix specific named patterns, don't rewrite from scratch) + `minimalist-ui` (aesthetic — warm monochrome, document-style, explicitly rejects generic SaaS patterns, restrained "quiet sophistication, not spectacle" motion). Both installed this session via `npx skills add Leonxlnx/taste-skill` (no `--skill` filter, installed the full 13-skill repo; user chose to keep all 13 installed rather than prune, but only these two are active guidance for this spec).

**Audit findings** (redesign-existing-projects' Design Audit checklist, run against the live codebase 2026-08-19):
- **Typography:** body font is Inter — `minimalist-ui`'s own banned-fonts list names Inter explicitly (`"DO NOT use the 'Inter'... typefaces"`), and redesign-skill's audit flags "Inter everywhere" as a top typography problem. Numbers throughout the app (ledger line, stat displays, match scores) use proportional figures, not tabular — the audit specifically flags this for "data-heavy interfaces," which this app is.
- **Component patterns:** `.card` (`public/css/styles.css:136-142`) is the textbook "generic card look" the audit names verbatim — `background` + `border: 1px solid` + `border-radius` + `box-shadow`, applied uniformly to every card-shaped element in the app with no variation communicating hierarchy.
- **Layout:** `--radius: 6px` (set in the prior redesign) applies uniformly to every element via `var(--radius)` — the audit flags "uniform border-radius on everything," recommending variation (tighter on inner elements, softer on containers) instead.
- **Interactivity:** job search's per-source progress rows and the CV-chat "thinking…" state use a generic spinning circle (`.spinner`, `public/css/styles.css:276`) — the audit flags "no loading states... generic circular spinners," recommending skeleton loaders that match the eventual content's shape instead.
- **Strategic omission / dead UI:** the top nav's notification bell (`public/js/app.js:119`, `<button class="icon-btn" title="Notifications" disabled>`) is permanently disabled — a dead, non-functional element sitting in every page's chrome. The audit's "dead links" flag applies to dead buttons too.
- **Duplicate action:** the Tracker page renders its own `+ New application` button (`public/index.html:17`) directly below the identical global one in top nav (`public/js/app.js:118`) — both visible simultaneously on that one page, a genuine redundancy the user named directly.
- **Leftover naming artifact:** `public/css/styles.css:402`'s comment `/* --- Advocate component primitives --- */` is a remnant of the same external-mockup branding leak the token rename (prior redesign) already cleaned up elsewhere — missed in that pass since it's a comment, not a variable name.

## Goals

- Replace Inter (body) with a font that has more character, per redesign-skill's own suggested list (Geist/Outfit/Cabinet Grotesk/Satoshi) — pick one available via Google Fonts with no licensing friction, keep Source Serif 4 for display/headings (already established, not part of the complaint).
- Enable tabular figures for all numeric displays (ledger values, match scores, comp figures).
- Redesign `.card` away from the generic border+shadow+background formula — per both audits' guidance, elevation should communicate something, not apply uniformly everywhere.
- Vary border-radius: tighter on inner elements (buttons, inputs, pills), a touch softer on outer containers (cards) — not a flat single value everywhere.
- Apply `minimalist-ui`'s specific restrained motion system (Section 7 of that skill): scroll-entry fades via `IntersectionObserver`, subtle hover lifts, staggered list reveals — "present but never distracting," which is the literal design-taste-frontend "calm" framing done with a more prescriptive, tested rule set this time.
- Refine the semantic color system: `minimalist-ui`'s muted-pastel tag palette (pale red/blue/green/yellow, each with a matching darker text color) for status chips and match badges, replacing the current more saturated `--warn`/`--danger`/`--success` treatment where it's used for tags specifically (not touching the core brand teal/coral).
- Replace the generic spinner with skeleton loaders shaped like the content that's loading, at minimum for job search's per-source progress rows (the slowest, most visible loading state in the app).
- Remove the dead notification bell button.
- Fix the duplicate `+ New application` button on the Tracker page (remove the page-level one, keep the nav's global one — it already supports the same `?new=1` auto-open behavior `index.js` already listens for).
- Rename the stale `/* Advocate component primitives */` comment.

## Non-goals

- **No structural nav changes** (tab count/labels) — the Applications+Job Search merge is sub-project 2 of the roadmap; changing nav structure here would mean redoing it again once that merge lands. This spec only removes the dead bell button (a pure subtraction, not a restructure) and lets the new visual system carry through unchanged nav markup.
- **No new pages, routes, or IA changes** of any kind.
- **No new features** (map, activity graph, company enrichment, unified ranking) — those are sub-projects 3-5 of the roadmap, each gets its own spec once this foundation lands.
- **No new npm dependencies, no build step** — Google Fonts `@import` swap only (same mechanism already used for Source Serif 4), everything else is CSS/markup.
- Brand colors (teal primary, coral accent) are unchanged — this is an execution refinement, not a rebrand, consistent with the prior redesign's own scope decision.

## Typography

Google Fonts import (`public/css/styles.css:1`) changes to add **Outfit** (geometric sans with real character, free on Google Fonts, no licensing friction — chosen from redesign-skill's own suggested list since Geist/Satoshi/Cabinet Grotesk aren't freely hosted on Google Fonts) replacing Inter for body/UI text. Source Serif 4 stays for `--font-display` (headings) — unchanged from the prior redesign, not part of this complaint.

```css
--font-body: "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Numeric displays (`.ledger-value`, `.stat-value` if any survive elsewhere, `.match-badge`, comp figures) get `font-variant-numeric: tabular-nums;` added to their existing rules — a one-line addition per rule, not a new selector.

## Color: pastel tag system

New tokens, appended to `:root` alongside existing `--rc-*` tokens:
```css
--rc-tag-red: #FDEBEC; --rc-tag-red-ink: #9F2F2D;
--rc-tag-blue: #E1F3FE; --rc-tag-blue-ink: #1F6C9F;
--rc-tag-green: #EDF3EC; --rc-tag-green-ink: #346538;
--rc-tag-yellow: #FBF3DB; --rc-tag-yellow-ink: #956400;
```
`.status-chip`/`.match-badge`/`.pill` variants remap to these (e.g. `.status-chip.interview` → yellow, `.status-chip.offer` → green, `.match-badge.low` → red) — exact mapping is a plan-level detail (needs to walk every existing variant class and assign the semantically closest pastel, not redefined here to avoid this spec silently becoming the wrong source of truth if a variant is missed).

## Card treatment

Current (`public/css/styles.css:136-142`):
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
New treatment: drop the `box-shadow` entirely (per minimalist-ui: "Shadows must be practically non-existent"), keep the border but make it the primary structural signal, increase padding slightly for the "generous whitespace" the audit calls for, and reduce the radius specifically on cards to feel more considered relative to the app's other rounded elements (buttons/pills stay at their current smaller radii, unaffected):
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px 28px;
  margin-bottom: 18px;
}
```
(`--radius` itself, used elsewhere for inputs/buttons/smaller elements, stays at 6px — this is a card-specific override, not a global token change, which is how "vary the radius" from the audit actually gets applied: different values for different element roles, not one variable reused everywhere.)

## Motion

Implements `minimalist-ui` Section 7 directly:
- **Scroll-entry fade**: new small JS utility (vanilla, `IntersectionObserver`-based, no library) applied to `.card` elements — `translateY(12px)` + `opacity: 0` resolving over 600ms, `cubic-bezier(0.16, 1, 0.3, 1)`. This is additive to the existing `riseIn` keyframe (`public/css/styles.css:98-112`, currently a fixed animation-delay based on DOM position) — the plan should decide whether to replace `riseIn` with the IntersectionObserver approach or keep both for different contexts (below-the-fold vs. above-the-fold content), since `riseIn` already exists and works for what's immediately visible on load.
- **Hover lift**: cards get an ultra-subtle `box-shadow` transition on hover (`0 0 0` → `0 2px 8px rgba(0,0,0,0.04)`, 200ms) — reintroducing a hint of shadow only on interaction, not at rest, resolving the tension between "drop box-shadow" (Card treatment, above) and wanting SOME depth cue on hover for genuinely clickable cards (`.app-card`, `.job-card`).
- **Staggered reveals**: list/grid items (kanban cards within a column, job search result cards) get a cascade delay (`animation-delay: calc(var(--index) * 80ms)`) — requires each rendered item to carry a `--index` custom property set inline from its loop index, a small addition to the existing template-literal rendering in `index.js`/`job-search.js`.
- Explicitly **not** adopting minimalist-ui's "ambient background motion" (slow drifting gradient blob) — that's suited to marketing/landing pages, not a functional dashboard; would just be visual noise here.

## Loading states

Replace `.spinner` (generic spinning circle) with a skeleton-shaped loading state specifically for Job Search's per-source progress rows (`public/js/job-search.js`'s `renderProgressRow`, "searching" status) — a shimmer/pulse placeholder shaped like the eventual pill, not a spinner icon. The CV-chat "thinking…" indicator (`public/js/cv-store.js`) is explicitly out of scope for this spec (different component, different plan task if pursued later) to keep this spec's markup changes contained to one file pair.

## What does NOT change

- Brand colors (teal `--rc-primary`, coral `--rc-secondary`).
- Source Serif 4 for headings.
- Nav tab structure/labels/routes (only the dead bell button is removed — a subtraction, not a restructure).
- Kanban board layout mechanics, ledger line, masthead statement (all from the prior two redesigns, untouched here).
- `.btn`/input styling beyond the tabular-nums addition where numeric.

## Testing

No automated test suite (established convention). Verification is visual, via Playwright screenshots (scratch tooling, not a project dependency) — same convention as both prior redesign rounds. Given this spec touches motion/interaction (hover states, staggered reveals, IntersectionObserver), the plan should include at least one interaction test (not just a static screenshot) — e.g. scrolling a long kanban column and confirming staggered reveal timing looks right, or a live Playwright `hover()` call confirming the card lift transition fires.

## Open questions for the implementation plan (not resolved by this design)

- Exact pastel-to-status-variant mapping (which existing chip/badge class gets which of the 4 pastel colors) — needs to walk every current variant class, not guessed here.
- Whether `riseIn`'s existing keyframe is replaced by or coexists with the new IntersectionObserver scroll-entry approach.
- Exact skeleton-loader markup/shape for job search's progress rows.
