# Editorial Dashboard Visual Redesign — Design

**Status:** Approved by user in conversation on 2026-08-18. Ready for `superpowers:writing-plans`.

**Context:** resume-copilot's current visual design is a generic rounded-card SaaS-dashboard template — 0.75rem radius everywhere, flat pill badges, single-accent buttons, Inter + Plus Jakarta Sans (a common default pairing), no visual signature tied to what the app actually is (a career/resume tool). This is an intentional overhaul (not a preserve-and-modernize pass — see `docs/superpowers/plans/2026-08-18-job-search-multi-source.md`'s neighbor session for the "preserve vs. overhaul" decision point; the user chose overhaul here) using the `design-taste-frontend` skill (installed this session via `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`, symlinked at `.claude/skills/design-taste-frontend`) as the active design skill, per the user's explicit choice over Anthropic's own `frontend-design` skill (already present in this environment) and impeccable.style (a third design-skill system, deliberately not installed, to avoid the vocabulary-collision both taste-skill and impeccable's own docs warn against when running multiple opinionated design skills at once).

**Brief inference** (taste-skill Section 0, answered in conversation): vibe words = "calm, precise, editorial." No specific product reference — direction chosen from the app's own subject matter (career documents) plus the vibe words.

**Redesign audit** (taste-skill Section 11.B, performed 2026-08-18):
- **Brand tokens today:** deep teal `#1D4E4B` primary, coral `#E8543D` accent, `#F6F7F6` surface, Inter (body) + Plus Jakarta Sans (display), `0.75rem` radius, flat 1px borders + faint shadow. CSS custom properties are named `--advocate-*` — a leftover from an external mockup this app was never actually branded as (a known loose end from an earlier session, unrelated to this redesign's own scope but worth fixing while touching every one of these variables anyway).
- **A real bug found during the audit:** `--shadow` is hardcoded to `rgba(0, 80, 203, ...)` — a blue tint left over from an *even earlier* palette (before a prior session changed it to teal/coral). Nobody updated it when the palette changed. Fixing this is in scope since this redesign touches every color token anyway.
- **IA:** 7 pages — Applications (kanban, home/`index.html`), Job Search, Tailor, CV Store, Outreach Studio, Application detail, Profile. Top nav (`renderNav` in `public/js/app.js`) shows only 3 tabs (Search/Tailor/Applications) — CV Store and Outreach Studio are reachable only via in-page links. **This IA is unchanged by this redesign** — direction B (Editorial Dashboard) explicitly keeps structure, only recomposes visual treatment.
- **Patterns to preserve:** kanban board structure, streaming-chat UI, CV document editor split-pane (`.cv-page`) — functional/IA wins, untouched visually beyond token changes cascading through them.
- **Patterns to retire:** the generic rounded-card look (radius, shadow-heavy cards), the `--advocate-*` naming, the stale blue shadow tint, the Inter+Plus Jakarta Sans pairing on headings.

## Goals

- Visually distinguish resume-copilot from a generic AI-generated SaaS dashboard template, while preserving all existing IA, functionality, routes, and nav labels (per taste-skill's own Redesign Protocol 11.F: never change these silently).
- Establish a coherent typographic and materiality system (serif headings, sharper radii, hairline-rule dividers as a signature motif) applied consistently across all 7 pages.
- Fix the `--advocate-*` naming leak and the stale blue-tinted shadow as part of the token rewrite (touched anyway, zero extra risk).
- Keep the existing teal/coral brand identity — this is an execution overhaul, not a rebrand.

## Non-goals

- No IA changes: no new pages, no route renames, no nav-label changes, no change to which 3 tabs appear in top nav.
- No new JS framework, build step, or component library (per taste-skill Section 2.B: "editorial/magazine" aesthetics have no official package — this stays native CSS, matching the app's existing zero-build-step architecture).
- No content/copy rewrites — this is a visual pass only.
- No new interactive JS behavior beyond what's needed to render the new markup (e.g., no new animation libraries; motion stays CSS-only per the existing `.card` `riseIn` keyframe pattern).

## Dial calibration (taste-skill Section 1)

Signal "minimalist / clean / calm / editorial" baselines to `VARIANCE 5-6 / MOTION 3-4 / DENSITY 2-3`; the "redesign - overhaul" modifier adds `+2/+2/match`. Naive result: `VARIANCE 7-8 / MOTION 5-6 / DENSITY 2-3`.

**Override, and why:** DENSITY stays at the app's current functional level (kanban board, job cards, forms all carry real data — this isn't a blog). The dial table's baseline assumes a marketing/editorial *site*; this is an "Operate"-category tool (impeccable.style's framing, read as reference material during brainstorming, not an installed skill) where scanability outranks expression. Editorial vocabulary shapes *typography, color, and materiality* here, not information density. Working dials for this redesign: `VARIANCE 6 / MOTION 4 / DENSITY unchanged from current`.

## Token system

All changes live in `public/css/styles.css`'s `:root` blocks (currently lines 1-41) and cascade through every page via existing CSS custom properties — no per-page CSS duplication needed since the app already centralizes tokens.

### Color (renamed from `--advocate-*`, values adjusted)

| New variable | Old variable | Old value | New value | Change |
|---|---|---|---|---|
| `--rc-primary` | `--advocate-primary` | `#1D4E4B` | `#1D4E4B` | unchanged |
| `--rc-primary-container` | `--advocate-primary-container` | `#D7E8E5` | `#D7E8E5` | unchanged |
| `--rc-secondary` | `--advocate-secondary` | `#E8543D` | `#E8543D` | unchanged |
| `--rc-success` | `--advocate-success` | `#2F9E5C` | `#2F9E5C` | unchanged |
| `--rc-success-soft` | `--advocate-success-soft` | `#E1F5E9` | `#E1F5E9` | unchanged |
| `--rc-warn` | `--advocate-warn` | `#C98A1D` | `#C98A1D` | unchanged |
| `--rc-warn-soft` | `--advocate-warn-soft` | `#FBECD3` | `#FBECD3` | unchanged |
| `--rc-danger` | `--advocate-danger` | `#C1392B` | `#C1392B` | unchanged |
| `--rc-danger-soft` | `--advocate-danger-soft` | `#F8DFDB` | `#F8DFDB` | unchanged |
| `--rc-surface` | `--advocate-surface` | `#F6F7F6` | `#FAF9F6` | warmer, paper-toned instead of cool gray |
| `--rc-surface-container` | `--advocate-surface-container` | `#EAEDEC` | `#F0EEE8` | warmer |
| `--rc-surface-container-low` | `--advocate-surface-container-low` | `#EFF1F0` | `#F5F3EE` | warmer |
| `--rc-surface-container-lowest` | `--advocate-surface-container-lowest` | `#FFFFFF` | `#FFFFFF` | unchanged |
| `--rc-surface-container-high` | `--advocate-surface-container-high` | `#DEE3E1` | `#E5E1D8` | warmer |
| `--rc-on-surface` | `--advocate-on-surface` | `#142524` | `#1A1A18` | shifted toward near-black ink rather than teal-tinted dark |
| `--rc-on-surface-variant` | `--advocate-on-surface-variant` | `#4B5B59` | `#5C5A52` | warmer neutral |
| `--rc-outline-variant` | `--advocate-outline-variant` | `#C7D0CE` | `#D8D4C8` | warmer |

**Values only actually change for the neutral/surface scale** (shifted from a cool gray-green to a warm paper tone, supporting the "editorial document" feel) — the semantic brand colors (primary teal, secondary coral, success/warn/danger) are unchanged, since the brand identity itself isn't being replaced.

### Shadow fix

```css
--shadow: 0 1px 2px rgba(29, 78, 75, 0.06), 0 1px 6px rgba(29, 78, 75, 0.06);
```
(Was `rgba(0, 80, 203, ...)` — blue, from a palette this app no longer uses. New value uses `--rc-primary`'s teal, `29, 78, 75`, at slightly higher opacity since the new warmer surface needs marginally more shadow contrast to read.)

### Typography

```css
--font-display: "Source Serif 4", Georgia, "Times New Roman", serif;
--font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Google Fonts import line (`public/css/styles.css:1`) changes from:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap');
```
to:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap');
```

`h1`/`h2` (`public/css/styles.css:94-95`) keep using `var(--font-display)` — no selector changes needed, only the variable's value changes, so this cascades automatically to every page's headings with zero per-page edits.

### Radius

```css
--radius: 6px;
```
(Was `0.75rem` = 12px.) Applied automatically everywhere `var(--radius)` is already used (`.card`, `.column`, `.cv-doc-wrap`, etc. — grep confirms these all reference the variable, not a hardcoded value, so this is a one-line change with full cascade). `.app-card`, `.btn`, inputs use hardcoded `8px`/smaller radii already close to the new target — leave those as-is (already reads as "precise," not the offender).

### New: hairline-rule signature motif

New CSS rule, appended near `h2` (`public/css/styles.css:95`):

```css
h2 { font-family: var(--font-display); font-size: 18px; font-weight: 600; margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
```

(Changes the existing `h2` rule in place — adds `padding-bottom`/`border-bottom`, everything else unchanged. This means every existing `<h2>` on every page — "Results," "Match analysis," "New application," every card section header — automatically gets the rule divider, with zero markup changes required anywhere.)

**Caveat found during design:** some existing `<h2 style="display:inline;">` usages (Tailor Studio's `<summary><h2 style="display:inline;">`, confirmed in `public/tailor.html`) explicitly override to `display:inline` for layout inside a `<summary>` — an inline element can't take `border-bottom` the same way block h2s do. This needs a scoped exception (a `.no-rule` class or `:not()` selector) — flagged here as a concrete task-level detail, not resolved in this design doc (the plan must handle it explicitly, not silently break those specific headers).

## Masthead

`header.topbar` (`public/css/styles.css:54-71`) styling changes:
```css
header.topbar { border-bottom: 1px solid var(--ink); }
header.topbar .brand { font-family: var(--font-display); font-weight: 600; font-size: 20px; }
```
(Was a 1px `var(--border)` bottom border — a light gray hairline. New value uses `var(--ink)` for a stronger, more masthead-like rule, consistent with editorial mastheads using a heavier top-of-page rule than section dividers use.) Brand mark markup (`public/js/app.js:108`, `<a href="index.html" class="brand"><span class="brand-mark">R</span> Resume Copilot</a>`) is unchanged — only the CSS treatment of `.brand` changes (serif font now cascades via `--font-display`).

## What does NOT change

- All HTML structure, all IA, all nav labels, all routes, all JS logic — this is a CSS-token-and-two-selector-rule change, not a rebuild.
- `.btn`, `.pill`, form input styling — already reasonably restrained, not part of the "generic SaaS" complaint; left alone to keep this scoped.
- Kanban board (`.board`, `.column`, `.app-card`) layout mechanics — unchanged, only inherits the new radius/color tokens automatically.

## Testing

This project has no automated test suite (established convention). Verification is visual: this session installed Playwright directly as scratch tooling (not a project dependency — confirmed working during the job-search bug investigation on 2026-08-18) and can drive a real headless Chromium against `npm run dev` to screenshot every page before/after, which is a stronger verification bar than every prior frontend task in this project's history had available. The implementation plan should include a screenshot-based visual verification step per page, not just `npm run lint`.

## Open questions for the implementation plan (not resolved by this design)

- The `<h2 style="display:inline;">` exception noted above — exact CSS selector/class approach.
- Whether `Source Serif 4`'s variable-font `opsz` axis needs explicit weight fallbacks tested across the actual weights used (600 for h1/h2, checked against what page headers currently request).
- Order of file changes / task breakdown across the 7 pages (this design doc covers the shared token file; the plan decides task granularity).
