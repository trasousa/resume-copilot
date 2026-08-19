# Unified Applications + Job Search Page — Design

**Status:** Approved by user in conversation on 2026-08-19. Ready for `superpowers:writing-plans`. Second of the 5-part redesign roadmap (design system v2, already merged → this → activity graph → map/company enrichment → unified ranking view).

**Context:** Job Search and Applications (the Tracker) are currently separate pages/nav tabs, requiring a context switch between finding roles and tracking them. User feedback: "Applications and search should not be different tabs, we can make it in the same page... the objective of the app is to help a person land a job." This merges them into one page, kanban-anchored, with search as a collapsible panel — decided during brainstorming over two alternatives (permanent split view, search-as-kanban-column) for being the best fit given the user's stated preference for the kanban view and for working on mobile (a collapsed panel costs nothing on a small screen; a permanent split view doesn't fit).

**A real integration hazard found during design, not left for implementation to discover:** `public/js/app.js`'s `ensureCvsOrEmptyState(container, message)` helper (used today by `job-search.js`, `tailor.js`, and `outreach.js`) replaces its entire `container`'s `innerHTML` with an empty-state card when no CVs exist. `job-search.js` currently calls it with `main` as the container — safe today, since Job Search is a single-purpose page. It is **not safe** to call the same way once search lives inside the Applications page, since `main` there also contains the masthead, ledger line, and kanban board — replacing all of `main` would wipe those out from under the user the moment they open the search panel with no CVs saved. This spec's search panel must handle its own no-CV state scoped to just the panel's body, not reuse `ensureCvsOrEmptyState` against `main`. The shared helper itself is unchanged (`tailor.js`/`outreach.js` still use it safely, since those remain single-purpose pages).

## Goals

- Merge Job Search into the Applications page (`public/index.html`) as a collapsible panel, collapsed by default.
- Remove the separate Job Search page/route and its nav tab entirely.
- Change the result-card action from "Tailor Resume" (which today auto-tailors and redirects away) to "Save" (adds the card to the kanban's Saved column, stays on the page, no auto-tailor, no redirect) — matching the "no context switch" goal.
- After a save, the kanban board updates in place (reusing the existing `load()` re-fetch-and-render function already on this page) and the newly-added card gets a brief visual highlight so the save is obviously registered.
- The search panel stays open after a save, so multiple results from one search can be saved without re-searching.

## Non-goals

- No change to the search sources, ranking logic, or SSE streaming contract (`src/routes/jobsearch.js` is untouched — this is a frontend-only merge).
- No change to `tailor.js`/`outreach.js`'s own use of `ensureCvsOrEmptyState` — those pages are unaffected.
- No change to the kanban board's own rendering, drag behavior (there is none today), or card click-through to `application.html`.
- Tailoring a saved application is still available — just not automatic on save. It happens from the application's own card/detail page (`application.html`'s existing "Tailor CV" button), unchanged.
- Nav label stays "Applications" (not renamed to "Dashboard" — decided during brainstorming).

## Page structure

`public/index.html` gains a new `<details>` panel (reusing the collapsible-card pattern already established on Tailor Studio — `public/tailor.html`'s `<details class="card" id="jdPane">` — not a new component type) positioned between the masthead/ledger line and the kanban board:

```html
<details class="card" id="searchPane">
  <summary><h2 style="display:inline;">Find roles</h2></summary>
  <label>CV to match against</label>
  <select id="cvSelect"></select>
  <div class="grid cols-3">
    <div><label>City</label><input type="text" id="city" /></div>
    <div><label>Region/State</label><input type="text" id="region" /></div>
    <div><label>Country</label><input type="text" id="country" /></div>
  </div>
  <label><input type="checkbox" id="remote" style="width:auto; display:inline-block;" /> Include / prefer fully remote roles</label>
  <label>Minimum target compensation (optional)</label>
  <input type="text" id="minComp" placeholder="e.g. €80,000" />
  <label>Other preferences (optional)</label>
  <input type="text" id="notes" placeholder="e.g. prefer ML/data roles, avoid agencies" />
  <label>Job type</label>
  <div class="row" id="jobTypeChips">
    <button type="button" class="chip active" data-type="full-time">Full-time</button>
    <button type="button" class="chip" data-type="contract">Contract</button>
    <button type="button" class="chip" data-type="remote">Remote</button>
  </div>
  <div class="row" style="margin-top:12px;">
    <button class="btn" id="searchBtn">Search</button>
    <span id="status" class="muted"></span>
  </div>
  <div id="searchProgress" class="search-progress"></div>
  <div id="result"></div>
</details>
```
(No `open` attribute — collapsed by default, per the brainstorming decision. All form fields, IDs, and the progress/result containers are carried over unchanged from the current `job-search.html`, so `job-search.js`'s existing form-handling and SSE-consuming logic ports over with no functional rewrite, only a new home.)

`job-search.html` and `public/js/job-search.js` are deleted. Their logic moves into `public/js/index.js` (the plan decides exact code organization — a single growing file vs. a new shared module — this spec only requires the behavior to end up on `index.js`'s page, not dictate file layout).

## Nav change

`public/js/app.js`'s `renderNav` drops the `["job-search.html", "Search", "search"]` entry from its `links` array — 2 tabs remain (`Tailor`, `Applications`). This was deliberately deferred from design-system-v2 (which only removed the dead notification bell, not restructured tabs) specifically until this merge made it real, not premature.

## The no-CV empty state (the hazard above, resolved)

The search panel's own body — not `main` — gets the empty-state treatment when `api("/cvs")` returns zero CVs. Concretely: wrap the panel's form fields in an inner container (e.g. `<div id="searchPaneBody">`), and on load, if there are no CVs, replace only that inner container's contents with the same empty-state card markup `ensureCvsOrEmptyState` produces (a local copy of that markup, or a new tiny helper taking the same message — the plan decides which, but it must NOT call `ensureCvsOrEmptyState(main, ...)` on this page).

## Save flow

Current `job-search.js` job-card action button (`public/js/job-search.js:178-179`, `<button class="btn" data-idx="${i}">Tailor Resume</button>`) and its click handler (`public/js/job-search.js:183-231`, which calls `POST /applications`, then `POST /applications/:id/tailor`, then `window.location.href = application.html?id=...`) changes to:

```js
resultEl.querySelectorAll("[data-idx]").forEach((btn) => {
  btn.onclick = async () => {
    const j = jobs[Number(btn.dataset.idx)];
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const app = await api("/applications", {
        method: "POST",
        body: {
          company: j.company,
          role: j.title,
          location: j.location,
          link: j.url,
          source: "job-search",
          compEstimate: j.compEstimate,
          cvId,
          stage: "saved",
        },
      });
      btn.textContent = "Saved";
      await load(); // re-fetch + re-render the kanban board, ledger, masthead in place
      highlightNewCard(app.id); // brief visual highlight, see below
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Save";
      showError(main, err);
    }
  };
});
```

Dropped from the current flow: the `fetchJobPostFromUrl` call to fetch full posting text, and the `POST /applications/:id/tailor` auto-tailor call. `jobPostText` is no longer sent on creation — this is an intentional scope reduction matching "no context switch, tailor later," not an oversight; the plan should confirm `POST /applications` tolerates an absent `jobPostText` field (check `src/routes/applications.js`'s validation before assuming — this spec expects it does, since the manual "New application" dialog already omits it in some flows, but the plan's implementer must verify this against the actual route code, not just this spec's assumption).

**New card highlight**: after `load()` re-renders the board, find the newly-created `.app-card[data-id="${app.id}"]` and add a temporary CSS class (e.g. `.just-saved`) that applies a brief background-color flash or border-color pulse, removed after ~1.5s via `setTimeout` — a small, self-contained addition, not a new animation system (reuses the existing `transition` properties `.app-card` already has from design-system-v2's hover-lift work).

## What does NOT change

- Search sources, SSE contract, ranking (`src/routes/jobsearch.js`, `src/lib/arbeitnow.js`, `src/lib/himalayas.js`, `src/lib/jsearch.js`, `src/lib/jobdedup.js`) — all backend, untouched.
- `application.html`'s own "Tailor CV" button and detail-page flow — unchanged, still the way tailoring actually happens now.
- Kanban board rendering, ledger line, masthead statement (from the prior two redesign rounds) — the search panel is additive, inserted between them and the board, not replacing anything.
- `tailor.js`/`outreach.js`'s own safe use of `ensureCvsOrEmptyState(main, ...)` — unaffected, those remain single-purpose pages.

## Testing

No automated test suite (established convention). Visual + interaction verification via Playwright (scratch tooling), same convention as the prior two rounds. Given this plan changes a real behavior (save no longer auto-tailors/redirects), the plan should include a live interaction test that runs an actual search, clicks Save, and confirms: (a) the button reaches "Saved" state, (b) a new `.app-card` with the right company/role appears in the Saved column without a page navigation occurring, (c) the search panel is still open/visible afterward. The no-CV empty-state scoping (the hazard section above) also needs a live check — confirm the kanban board is still visible when the search panel's empty-state renders, not wiped from the page.

## Open questions for the implementation plan (not resolved by this design)

- Exact file organization for the moved job-search logic (grow `index.js`, or a separate imported module) — not dictated here.
- Exact `POST /applications` payload validation for an absent `jobPostText` — must be verified against `src/routes/applications.js`, not assumed.
- Exact `.just-saved` highlight CSS values (color, duration) — a plan-level detail.
