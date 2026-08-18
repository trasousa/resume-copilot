# Tracker Homepage Structural Redesign — Design

**Status:** Approved by user in conversation on 2026-08-18. Ready for `superpowers:writing-plans`.

**Context:** The token-level editorial redesign (`docs/superpowers/specs/2026-08-18-editorial-dashboard-redesign-design.md`, merged) changed colors/typography/radius/a hairline-rule motif app-wide, but left every page's actual layout structure untouched. The user's feedback after seeing it live: it "looks completely the same" — a fair assessment, since a token-only pass on an unchanged generic-dashboard layout was always going to read as subtle, not transformed. This spec is the first of a page-by-page series of *structural* redesigns (new layout, not just new tokens), starting with the Tracker homepage (`public/index.html`, `public/js/index.js`) since it's the highest-impact page (default landing view) and its signature element can inform the other 6 pages once proven.

**What's being replaced:** the Tracker's stat-tile grid (`#statTiles`, 4 separate rounded cards, each with an icon + big number + label) is exactly the AI-generated-dashboard pattern `design-taste-frontend`'s own "AI Tells" section (Section 9) flags — icon-plus-big-number-plus-label stat cards are a named, common tell, not specific to this app's color choices. This is the actual generic-template offender on this page, more than the palette ever was.

## Goals

- Replace the 4-card stat-tile grid with a single "ledger line" — one horizontal row of number/label pairs, divided by vertical rules, framed by a heavier top rule and lighter bottom rule (evoking a table's header/footer row, or a financial report's summary line).
- Replace the generic "Application Tracker" `<h1>` + static subtitle with a computed masthead statement — a real sentence describing the user's actual current state (e.g. "14 applications tracked. 3 moving through interviews."), not a static page title.
- Both elements are computed from data already loaded by `load()` (`apps`, `stats`) — no new API calls, no backend changes.

## Non-goals

- The kanban board itself (`.board`, `.column`, `.app-card` cards) is unchanged in this pass — Direction B (docket-style kanban cards) was considered and explicitly deferred to a later pass, not this one.
- No IA change: no new routes, no nav changes, `+ New application` button and its dialog flow unchanged.
- No changes to any other page — this is the Tracker only. The signature element established here (ledger line, masthead statement) is a candidate pattern for later pages' specs, not applied elsewhere in this spec.
- No new dependencies, no build step.

## Masthead statement

Replaces (`public/index.html`, current markup):
```html
    <div class="row between">
      <div>
        <h1>Application Tracker</h1>
        <p class="subtitle">Every application, its stage, and what's next.</p>
      </div>
      <button class="btn" id="newAppBtn">+ New application</button>
    </div>
```
with a masthead statement whose text is computed at load time, not static markup. The `<h1>` becomes an empty target (`id="mastheadStatement"`) that `public/js/index.js` fills in.

**Copy logic** (computed in a new function in `index.js`, called from `load()` after `apps`/`stats` are fetched):
- Zero applications: `"No applications tracked yet."`
- Otherwise: `"<N> application<s> tracked."` followed by a second sentence only when there's something active to report — interview count if > 0 (`"<N> moving through interviews."`), else offer count if > 0 (`"<N> offer<s> on the table."`), else nothing (just the first sentence stands alone).

This mirrors how a real editorial masthead states the day's actual news, not a fixed banner — the copy changes based on what's true, in the interface's own voice per this project's existing copy conventions (plain, declarative, no marketing tone).

## Ledger line

Replaces `#statTiles`'s current stat-grid rendering (4 cards: Total/Interviews/Offers/Avg Match) with one row, same 4 data points, same underlying `stats`/`apps` values — only the markup and CSS change, not what's measured.

New CSS (`public/css/styles.css`, appended near the existing `.stat-tile`/`.stat-grid` rules — those rules are removed since nothing else in the app uses them, confirmed by grep during design):
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
```

New markup produced by `renderStats()` (replacing its current `.stat-grid` template):
```html
<div class="ledger-item"><span class="ledger-value">14</span><span class="ledger-label">Total</span></div>
<div class="ledger-item"><span class="ledger-value">3</span><span class="ledger-label">Interviews</span></div>
<div class="ledger-item"><span class="ledger-value">1</span><span class="ledger-label">Offers</span></div>
<div class="ledger-item"><span class="ledger-value">82%</span><span class="ledger-label">Avg match</span></div>
```
(Avg Match shows `"—"` when `stats.avgMatch` is `null`, same fallback as today — this spec changes presentation, not the underlying data logic, which stays in `load()`/`renderStats()`'s existing calculation.)

The container element keeps its existing `id="statTiles"` (referenced by `load()`'s `renderStats()` call) but its CSS class changes from `stat-grid` to `ledger-line`.

## What does NOT change

- `load()`'s data-fetching logic (`api("/applications")`, `api("/applications/stats")`) — unchanged, this spec only changes what's rendered from that data.
- The kanban board, stale-applications banner, new-application dialog — all unchanged.
- `.stat-icon` SVG icons (`list`/`mail`/`sparkle`/`search`) are dropped from the ledger line (a text-only row doesn't carry icons the way a card grid did) — confirmed this doesn't orphan the `icon()` calls elsewhere, since `icon()` is a shared helper used throughout the app for many other purposes.

## Testing

Same convention as the token-level redesign: no automated test suite exists for this project. Verification is visual, via Playwright screenshots (scratch tooling, not a project dependency) comparing the ledger line and masthead statement render correctly with both real data (existing test applications) and the zero-applications empty state (a genuinely different code path — `renderStats`/the masthead copy logic both branch on `stats.total === 0` vs not, and this must be screenshotted separately, not assumed to work from the populated case alone).

## Open questions for the implementation plan (not resolved by this design)

- Exact responsive behavior of `.ledger-line` at narrow viewports (the spec's CSS uses `flex-wrap: wrap`, but the plan should verify this doesn't look broken at mobile widths, adjusting if needed).
- Whether `renderStats()`'s function name/signature should change given its output shape is now fundamentally different (still returns `void`, still takes `(apps, stats)` — likely no signature change needed, but the plan's implementer should confirm while touching this function).
