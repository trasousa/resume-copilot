# Unified Ranking / Compare View — Design

**Status:** Approved by user in conversation on 2026-08-19. Ready for `superpowers:writing-plans`. Fifth and final part of the redesign roadmap (design system v2, unified Applications+Search page, activity graph, map+company enrichment — all merged → this one).

**Context:** The original roadmap item was "a unified salary/ranking view tying search results, applications, tailoring, cover letters, and cold emails into one 'land the job' comparison view." Scoped during brainstorming to its core, well-bounded piece: a **cross-application comparison table** on the existing Applications page, letting the user see match score, compensation, stage, and location side-by-side across all their applications and sort by any of them — not a rebuild of the per-application detail page (`application.html` already serves as that "hub": vault, tailored CV, activity, status, in one place).

## Goals

- A sortable comparison table showing every application's Company/Role, Stage (colored badge), Match Score, Compensation, and Location, in one place.
- Default sort order = kanban stage order (`saved → applied → screening → interview → offer → rejected → withdrawn`, matching `STAGES` in `src/lib/db.js:8-16`).
- Click any column header to re-sort (ascending/descending, with a small arrow indicator on the active column).
- Compensation (freeform text like `"$120k-140k"` or `"competitive"`) sorts by a best-effort extracted number; rows where nothing parses sort last regardless of direction.

## Non-goals

- No new backend endpoint — the table renders from the same application array `load()` already fetches for the kanban board in `public/js/index.js`. Confirmed during brainstorming: this app's dataset is small (personal use), so client-side sort is simpler and sufficient.
- No map here — confirmed during brainstorming that the map experience stays unique to the Job Search results view (Part 4); this table is text-only, including for Location.
- No editing from this table — it's read-only. Stage changes stay on the kanban board (drag-and-drop) or the application detail page, exactly as today.
- No changes to `application.html`, `outreach.html`, `tailor.html`, or any tailoring/cover-letter/cold-email flow — those already work; this view only adds a new way to *look at* data that already exists.

## Placement and structure

New collapsible `<details class="card" id="comparePanel">` on `public/index.html`, between the existing `#activityGraph` div (line 19) and the `#searchPane` details block (line 21) — same collapsed-by-default pattern already established for `#searchPane`. Collapsed by default so it doesn't compete with the kanban board for attention on page load (matches the same reasoning that made Job Search collapsed-by-default in Part 2).

Inside: a `<table id="compareTable">` with a `<thead>` row of clickable `<th>` headers (Company/Role, Stage, Match, Comp, Location) and a `<tbody>` populated by a new `renderComparePanel(apps)` function in `public/js/index.js`, called from the existing `load()` function alongside the existing `renderStats`/kanban-render calls (same `apps` array, no separate fetch).

## Sorting

Sort state lives as two module-scope variables in `index.js` (`compareSortKey`, `compareSortDir`), defaulting to `{ key: "stage", dir: "asc" }`. Clicking a `<th>` sets `compareSortKey` to that column and toggles `compareSortDir` if it's already the active column, then re-calls `renderComparePanel(apps)` (the same in-memory array — no re-fetch).

Sort comparators per column:
- **Stage:** index into `STAGES` (imported client-side as a literal array mirrored in `index.js`, matching `src/lib/db.js:8-16` exactly — the frontend has no access to the backend module, so this is a small intentional duplication, same pattern already used elsewhere for `STAGES`-like frontend constants).
- **Match:** numeric `matchScore`, nulls sort last.
- **Comp:** best-effort numeric extraction via `/[\d,]+/` on `compEstimate` (same regex-scrape spirit as `parseMatchScore` in `src/routes/applications.js:15-20`, but simpler since it just needs the first number, not a labeled "score"), nulls/unparseable sort last.
- **Company/Role, Location:** plain case-insensitive string compare.

Nulls-sort-last applies regardless of ascending/descending direction (confirmed during brainstorming) — an application with no compensation data isn't "worth less," it's "unknown," and unknowns shouldn't jump to the top on a descending sort.

## Visual treatment

Stage column reuses the existing `.status-chip.<stage>` classes (`public/css/styles.css:449-461`) unchanged — no new badge system, no new colors. Match/Comp/Location render as plain table cells. Table styling (borders, header hover/active state, sort-arrow indicator) is new CSS, following the app's existing hairline-rule/muted-border conventions rather than introducing a new visual language.

## What does NOT change

- `src/routes/applications.js`, `src/lib/db.js` — no backend changes at all; this is a pure frontend addition over existing data.
- `application.html`/`outreach.html`/`tailor.html` and their JS — untouched.
- The kanban board itself — untouched; this is an additional view, not a replacement.

## Testing

No automated test suite (established convention). Verification: Playwright screenshot confirming the table renders with real application data, sorting behaves correctly when clicking each header (spot-check 2-3 columns including Comp's null-handling), and the panel collapses/expands like the existing Job Search panel.

## Open questions for the implementation plan (not resolved by this design)

- Exact sort-arrow markup/CSS (a plan-level detail).
- Whether "Company/Role" is one combined column or two — a plan-level layout detail; either is consistent with this design's column list.
