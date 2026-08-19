# Activity Graph — Design

**Status:** Approved by user in conversation on 2026-08-19. Ready for `superpowers:writing-plans`. Third of the 5-part redesign roadmap (design system v2, unified Applications+Search page, already merged → this → map/company enrichment → unified ranking view).

**Context:** User asked for "a GitHub commit tracker for the job applications that are sent" — a habit-tracking heatmap that makes ongoing job-hunt effort visible at a glance, reinforcing the "personal dashboard" framing. This app already has a real, rich data source for this: the `activity_events` table (`schema.sql:63-71`), which logs a row for every application creation, stage change, tailoring run, generated document, and reminder — populated at 4 call sites in `src/routes/applications.js` already. No new event-logging work is needed; this spec is purely: aggregate what's already tracked, render it as a heatmap.

## Goals

- New backend endpoint aggregating `activity_events` by day for the last 365 days.
- A GitHub-style contribution graph component: 53 columns (weeks) × 7 rows (days), 5-tier color intensity based on daily activity count.
- Placed on the Applications page (`index.html`), directly below the ledger line, above the "Find roles" search panel.
- Hover a cell to see the exact count and date.

## Non-goals

- No new activity-event types or new logging call sites — this only reads what's already written.
- No date-range picker, no "view by month/year" controls, no export — a fixed trailing-365-day view only, matching GitHub's own default and keeping this a simple, glanceable widget rather than a full analytics feature.
- No changes to the `application.html` detail page's own per-application activity timeline (`GET /:id/activity`, unchanged) — this is a separate, aggregate, cross-application view.

## Data

New DB function in `src/lib/db.js`, alongside `getApplicationStats` (same file section, same style):
```js
export async function getActivityHeatmap(db) {
  const { results } = await db
    .prepare(
      `SELECT date(occurred_at) AS day, COUNT(*) AS count
       FROM activity_events
       WHERE occurred_at >= date('now', '-365 days')
       GROUP BY date(occurred_at)
       ORDER BY day`
    )
    .all();
  return results.map((r) => ({ date: r.day, count: r.count }));
}
```
(`occurred_at` is stored as an ISO 8601 string via `new Date().toISOString()` at every write site — confirmed during design by checking every `addActivity` call site in `src/routes/applications.js` — so SQLite's `date(occurred_at)` correctly extracts the calendar date. Reminders are stored future-dated per the schema's own comment, `occurred_at` -- reminders are future-dated; everything else = created_at` — a future-dated reminder would currently fall outside the `-365 days` trailing window's *start* but could itself be in the future relative to "now," which the `WHERE occurred_at >= date('now', '-365 days')` clause doesn't exclude. This spec's graph is a "day is 365 days back through today" tracker, matching GitHub's own semantics, but a future-dated reminder event landing today-or-earlier in `occurred_at` would appear as if it already happened. This is an existing property of how reminders are already modeled in this schema (not something this spec introduces), and out of scope to fix here — flagged so the plan doesn't have to rediscover it, and doesn't attempt to fix reminder semantics as a side effect of this otherwise-simple aggregation.)

New route in `src/routes/applications.js`, next to the existing `GET /stats`:
```js
router.get("/activity-heatmap", async (c) => c.json(await db.getActivityHeatmap(c.env.DB)));
```
(Placed as a sibling of `/stats`, same simple one-line pattern. Must be registered before `/:id/activity` in the route file if Hono's route matching is order-sensitive for `/activity-heatmap` vs `/:id/activity` — the plan should verify this doesn't collide, since `/activity-heatmap` could theoretically be captured by a route pattern expecting `:id` to equal the literal string `"activity-heatmap"`. Checking during design: `/:id/activity` requires a trailing `/activity` segment, which `/activity-heatmap` doesn't have, so there's no actual collision — flagged for the plan to double check with a live request rather than trust this reasoning alone.)

## Component

New file `public/js/activity-graph.js` (a small, focused module — matches this app's existing pattern of one concern per file, e.g. `icons.js`, `cv-doc.js`):
```js
export function renderActivityGraph(container, data) {
  const byDate = new Map(data.map((d) => [d.date, d.count]));
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: byDate.get(iso) || 0 });
  }
  // Pad to start on a Sunday, per GitHub's own convention, so columns
  // align to real calendar weeks.
  const firstDow = new Date(days[0].date).getDay();
  for (let i = 0; i < firstDow; i++) days.unshift({ date: null, count: 0 });

  const tier = (count) => (count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4);

  container.innerHTML = `<div class="activity-graph">${days
    .map((d) => `<span class="activity-cell tier-${tier(d.count)}" ${d.date ? `title="${d.count} ${d.count === 1 ? "activity" : "activities"} on ${d.date}"` : ""}></span>`)
    .join("")}</div>`;
}
```
(Exact tier thresholds — `1, 2-3, 4-6, 7+` — are a plan-level detail to tune against real data once it's live, not fixed permanently by this spec; the important thing is 5 tiers total, matching GitHub's convention.)

CSS: `.activity-graph` uses CSS Grid with `grid-auto-flow: column` and `grid-template-rows: repeat(7, 1fr)` so cells lay out into 7-row columns automatically from a flat list, without the JS needing to build a 2D array — a smaller, more idiomatic implementation than manually chunking into week arrays. Five tier classes (`.tier-0` through `.tier-4`) each set `background-color` to `var(--rc-primary)` at increasing opacity (0%/25%/50%/75%/100% — `.tier-0` gets a border instead of a fill, matching GitHub's own empty-cell treatment, not literally 0% opacity which would be invisible against the page background).

## Placement

`public/index.html`, inserted between the ledger line and the search panel:
```html
<div id="statTiles" class="ledger-line"></div>

<div id="activityGraph"></div>

<details class="card" id="searchPane">
```
`public/js/index.js` fetches `GET /applications/activity-heatmap` and calls `renderActivityGraph(document.getElementById("activityGraph"), data)` once, alongside the existing `load()` call at page init (not on every `load()` re-run, since activity history doesn't need to refresh as often as the kanban board does after a save — though re-rendering it after every `load()` is also correct, just slightly more work than needed; the plan decides which).

## Testing

No automated test suite (established convention). Visual verification via Playwright (scratch tooling), same convention as prior rounds. Given this introduces a new backend route + DB query, the plan should include a direct `curl`/`fetch` check of `GET /api/applications/activity-heatmap`'s raw JSON shape (confirming `[{date, count}, ...]`) before checking the rendered visual, not just trust the frontend renders *something* plausible-looking.

## Open questions for the implementation plan (not resolved by this design)

- Exact tier count thresholds (1 / 2-3 / 4-6 / 7+ proposed here, tune against real local data).
- Whether the graph re-fetches/re-renders on every `load()` call or only once at page init.
- Exact hover-tooltip mechanism (native `title` attribute, proposed here, vs. a custom tooltip element) — `title` is the simplest, zero-JS option and is what's shown above; the plan can upgrade this later if the native tooltip's styling/delay feels wrong once it's live.
