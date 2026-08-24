// The Desk -- the hub. A computed front page about the pipeline: dateline,
// masthead statement, attention queue, pipeline digest, colophon. Deep work
// (kanban, compare, job search) lives in pipeline.js / search.js.

import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, daysSince, isStale } from "./app.js";
import { renderActivityGraph } from "./activity-graph.js";

renderNav("index.html");
checkApiKey();

// The New Application dialog moved to the Pipeline workspace with the
// board. Old bookmarks and pre-redesign links still say index.html?new=1 --
// honor them instead of silently dropping the intent.
if (new URLSearchParams(window.location.search).get("new") === "1") {
  window.location.replace("pipeline.html?new=1");
}

const STAGES = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["interview", "Interview"],
  ["offer", "Offer"],
];

// A `saved` application that has never been tailored has no match score:
// match_score is only ever written by the tailoring route. There is no
// "has a tailored CV" flag on GET /applications, so this stands in for one.
const TAILOR_NUDGE_DAYS = 3;

const main = document.querySelector("main");

function renderStats(stats) {
  document.getElementById("statTiles").innerHTML = `
    <div class="ledger-item"><span class="ledger-value">${stats.total}</span><span class="ledger-label">Total</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.interviews}</span><span class="ledger-label">Interviews</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.offers}</span><span class="ledger-label">Offers</span></div>
    <div class="ledger-item"><span class="ledger-value">${stats.avgMatch != null ? stats.avgMatch + "%" : "—"}</span><span class="ledger-label">Avg match</span></div>`;
}

/** Computes the masthead <h1> text -- a real sentence describing current
 * state, not a static page title. Mirrors how an editorial masthead
 * states the day's actual news rather than a fixed banner. */
function renderMastheadStatement(apps, stats, appsLoadFailed) {
  const el = document.getElementById("mastheadStatement");
  if (appsLoadFailed) {
    el.textContent = "Couldn't load your applications.";
    return;
  }
  if (stats.total === 0) {
    el.textContent = "No applications tracked yet.";
    return;
  }
  const interviewsActive = apps.filter((a) => a.stage === "interview").length;
  const offersPending = apps.filter((a) => a.stage === "offer").length;

  let statement = `${stats.total} application${stats.total === 1 ? "" : "s"} tracked.`;
  if (interviewsActive > 0) {
    statement += ` ${interviewsActive} moving through interview${interviewsActive === 1 ? "" : "s"}.`;
  } else if (offersPending > 0) {
    statement += ` ${offersPending} offer${offersPending === 1 ? "" : "s"} on the table.`;
  }
  el.textContent = statement;
}

/** `Sunday, August 24, 2026 — Edition №<n>`, where n counts days since the
 * first recorded activity. `since` is an ISO date or null (no history yet,
 * which is edition 1). */
function renderDateline(since) {
  const today = new Date();
  const date = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const edition = since ? daysSince(since) + 1 : 1;
  document.getElementById("dateline").textContent = `${date} — Edition №${edition}`;
}

/**
 * Builds the attention queue from the applications already on the page --
 * every rule here is client-side, no extra fetch. Order is the order of
 * urgency: stalled first, then interviews to prepare for, then untouched
 * saved roles.
 */
function attentionItems(apps) {
  const items = [];

  for (const a of apps) {
    if (isStale(a) && !["offer", "rejected", "withdrawn"].includes(a.stage)) {
      items.push({
        headline: `Follow up with ${a.company} — quiet for ${daysSince(a.stageEnteredAt)} days`,
        meta: `${a.stage} · ${a.role}`,
        actionLabel: "Open",
        href: `application.html?id=${encodeURIComponent(a.id)}`,
      });
    }
  }

  for (const a of apps) {
    if (a.stage === "interview") {
      items.push({
        headline: `Prepare for ${a.company}`,
        meta: `Interview · ${a.role}`,
        actionLabel: "Interview prep",
        href: `application.html?id=${encodeURIComponent(a.id)}&focus=interviewPrep`,
      });
    }
  }

  for (const a of apps) {
    if (a.stage === "saved" && a.matchScore == null && daysSince(a.createdAt) >= TAILOR_NUDGE_DAYS) {
      items.push({
        headline: `Tailor and apply to ${a.company}`,
        meta: `Saved ${daysSince(a.createdAt)} days ago · ${a.role}`,
        actionLabel: "Tailor",
        href: `application.html?id=${encodeURIComponent(a.id)}&focus=tailor`,
      });
    }
  }

  return items;
}

function renderAttentionQueue(apps) {
  const el = document.getElementById("attentionQueue");
  const items = attentionItems(apps);

  if (!items.length) {
    el.innerHTML = `
      <li class="queue-item">
        <span class="queue-index">—</span>
        <p class="queue-clear">Desk is clear. The pipeline can always use one more good application.</p>
        <a class="queue-action" href="search.html">Find roles</a>
      </li>`;
    return;
  }

  el.innerHTML = items
    .map(
      (item, i) => `
      <li class="queue-item stagger-item" style="--index:${i};">
        <span class="queue-index">${String(i + 1).padStart(2, "0")}</span>
        <div>
          <p class="queue-headline">${escapeHtml(item.headline)}</p>
          <p class="queue-meta">${escapeHtml(item.meta)}</p>
        </div>
        <a class="queue-action" href="${item.href}">${escapeHtml(item.actionLabel)}</a>
      </li>`
    )
    .join("");
}

/** Per-stage strip: name, count, and the single most-recent company in that
 * stage. A digest of the board, not the board -- each row links into it. */
function renderStageStrip(apps) {
  document.getElementById("stageStrip").innerHTML = STAGES.map(([key, label]) => {
    const inStage = apps.filter((a) => a.stage === key);
    // GET /applications is already ordered by updated_at DESC, so the first
    // match in each stage is that stage's most recent movement.
    const latest = inStage[0];
    return `
      <a class="stage-row" href="pipeline.html">
        <span class="stage-name">${label}</span>
        <span class="stage-count">${inStage.length}</span>
        <span class="stage-latest">${latest ? escapeHtml(latest.company) : "—"}</span>
      </a>`;
  }).join("");
}

function renderColophon(apps) {
  const latest = apps.reduce((acc, a) => (!acc || a.updatedAt > acc ? a.updatedAt : acc), null);
  document.getElementById("colophonUpdated").textContent = latest
    ? `Pipeline last updated ${timeAgo(latest)}`
    : "No pipeline activity yet";
}

async function load() {
  let apps = [];
  let appsLoadFailed = false;
  try {
    apps = await api("/applications");
  } catch (err) {
    appsLoadFailed = true;
    showError(main, err);
  }

  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(stats);
  renderMastheadStatement(apps, stats, appsLoadFailed);
  renderAttentionQueue(apps);
  renderStageStrip(apps);
  renderColophon(apps);
}

// Non-critical colophon widgets -- a failed fetch leaves them empty rather
// than blocking or erroring the page.
api("/applications/activity-heatmap")
  .then((data) => {
    renderActivityGraph(document.getElementById("activityGraph"), data);
    // The heatmap is the only 365-day history the frontend has; its earliest
    // dated entry is the first activity event within that window.
    renderDateline(data.length ? data[0].date : null);
  })
  .catch(() => renderDateline(null));

fetch("/api/usage")
  .then((r) => r.json())
  .then(({ used, cap }) => {
    const pct = Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
    document.getElementById("colophonBudget").textContent = `AI budget: ${pct}% of today's allowance used`;
  })
  .catch(() => {});

load();
