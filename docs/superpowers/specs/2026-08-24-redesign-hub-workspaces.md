# Redesign: The Desk — hub + focused workspaces

Owner-confirmed direction (2026-08-24): **editorial, evolved** in character;
**hub + focused workspaces** in structure; **the pipeline** as the heart of
the app. This is a full structural redesign, not a token pass — the standing
rule from the tracker redesign applies: layout and information architecture
must visibly change; restyling alone reads as "completely the same."

## Concept

The app becomes a morning newspaper about one subject: your job hunt.
The home page is the front page — computed, dated, editorial. Everything
actionable is a story with a next step. Deep work happens in dedicated
workspaces, one link away.

## Information architecture (before → after)

| Before | After |
|---|---|
| `index.html` = Tracker + collapsed search pane + collapsed compare + activity | `index.html` = **The Desk** (hub): masthead statement, attention queue, pipeline digest, colophon strip |
| (kanban lived on index) | `pipeline.html` = **Pipeline** workspace: kanban + compare table |
| (search pane lived on index) | `search.html` = **Search** workspace: full-page job search, results, map |
| `cv-store.html`, `tailor.html` | unchanged this phase (phase B merges them into a **Studio** workspace) |
| `application.html` | unchanged this phase (phase B) |

## The Desk (new `index.html`)

Top to bottom:

1. **Masthead**: wordmark small, then a dateline (`Sunday, August 24, 2026 — Edition №<n>` where n = days since first activity event), then the computed
   narrative statement (reuse/extend the existing masthead-statement code) at
   display scale — the largest type in the app. It should read like a front-page
   lede about the pipeline's current state, not a stat dump.
2. **Attention queue ("On your desk today")**: a numbered, rule-divided
   editorial list (no cards) of items needing action, computed client-side
   from the applications the page already fetches:
   - stalled applications (existing staleness logic) → "Follow up with X — quiet for N days" with a one-click open;
   - applications in `interview` stage → "Prepare for X" linking to the app's interview-prep doc action;
   - `saved` applications older than ~3 days with no tailored CV → "Tailor and apply to X";
   - if the queue is empty, a single set line: "Desk is clear. The pipeline can always use one more good application." with a link to Search.
   Each row: index numeral (serif, large), one-sentence headline, one action.
3. **Pipeline digest**: the ledger line (exists) plus a compact per-stage
   strip — stage name, count, and the single most-recent company in that
   stage — linking into `pipeline.html`. NOT the kanban itself.
4. **Colophon strip** (footer): activity heatmap (exists, reuse
   `activity-graph.js`) + AI budget line + last-updated note, small and quiet.

## Pipeline workspace (`pipeline.html`)

The current kanban board and compare table move here essentially intact
(code moves from `index.js` into a new `pipeline.js`; keep the established
`.status-chip`/stagger/just-saved vocabulary). Page gets its own smaller
masthead (section name in small caps + one computed sentence). The compare
table stays collapsible below the board.

## Search workspace (`search.html`)

The search pane stops being a `<details>` afterthought and becomes a
workspace: form as a left rail (desktop) / stacked (mobile), results +
ranking summary + map as the main column. All existing progressive-SSE
behavior, source rows, save flow, and map code move unchanged from
`index.js` into `search.js`. The "just saved" affordance now says
"Saved to Pipeline" (the kanban is no longer on this page — do NOT try to
scroll to it).

## Shell & navigation (all pages)

- Nav becomes an editorial masthead bar: wordmark left; section links in
  small caps (Desk, Pipeline, Search, CV Store, Tailor); the AI-budget
  indicator becomes a thin inline meter with the percent label; avatar menu
  stays.
- Active section marked by a heavier weight + short rule under the label,
  not a pill/background.
- "New Application" button stays in the shell.

## Constraints

- Keep: `--rc-*` tokens, Outfit body / Source Serif 4 headings, pastel
  status tags, skeleton-pulse loading, stagger entrances, hover-lift only on
  clickable cards, no resting shadows, no emojis in UI copy.
- Push: type-scale contrast (display sizes on the Desk), asymmetric grids,
  rule-divided lists over card grids for text content.
- No new runtime dependencies (Leaflet stays the only one). No build step.
- All existing API contracts and `public/js/app.js` helpers unchanged unless
  a change is strictly required; `renderNav` will need reworking for the new
  shell — keep its export signature.
- Every page keeps working data flows: this is a re-housing of working code,
  not a rewrite of its logic. Progressive search behavior, saved-state
  tracking, compare sorting, activity fetch-once — all preserved.
- Kanban save-flow note from the unified-page merge (scoped empty states,
  `ensureCvsOrEmptyState` must not wipe page-level content) still applies in
  the new pages.

## Phases

- **Phase A (this spec's build):** shell/nav, The Desk, `pipeline.html`,
  `search.html`, and the removal of the old combined index layout.
- **Phase B (separate spec/PR):** Studio (CV Store + Tailor merged),
  `application.html` as an editorial dossier page.
