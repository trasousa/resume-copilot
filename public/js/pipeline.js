// Pipeline workspace -- the kanban board, the stalled notice, the compare
// table, and the New Application dialog. Moved here from index.js when the
// Desk became the hub; the render logic itself is unchanged.

import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, wireJobPostFetch, matchPct, daysSince, isStale } from "./app.js";
import { icon } from "./icons.js";

renderNav("pipeline.html");
checkApiKey();

wireJobPostFetch({
  linkInput: document.getElementById("f-link"),
  fetchBtn: document.getElementById("f-fetch"),
  jobPostTextarea: document.getElementById("f-jobpost"),
  statusEl: document.getElementById("f-fetch-status"),
});

const STAGES = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["interview", "Interview"],
  ["offer", "Offer"],
];

// Full stage order for the compare table's default sort, including the two
// terminal stages the kanban's STAGES above deliberately excludes (they
// render in a separate "Closed" column, not a kanban stage column).
const STAGE_ORDER = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];

let compareSortKey = "stage";
let compareSortDir = "asc";
let compareAppsData = [];

const board = document.getElementById("board");
const staleNotice = document.getElementById("staleNotice");
const dialog = document.getElementById("newAppDialog");

async function openNewAppDialog() {
  dialog.showModal();
  const hint = document.getElementById("newAppCvHint");
  hint.innerHTML = "";
  const cvs = await api("/cvs").catch(() => []);
  if (!cvs.length) {
    hint.innerHTML = `<p class="muted" style="margin: -4px 0 12px;">No CV in the store yet — you can save this application now, but tailoring needs one from <a href="cv-store.html">CV Store</a> first.</p>`;
  }
}
document.getElementById("cancelNewApp").onclick = () => dialog.close();

if (new URLSearchParams(window.location.search).get("new") === "1") {
  openNewAppDialog();
}

document.getElementById("saveNewApp").onclick = async () => {
  const company = document.getElementById("f-company").value.trim();
  const role = document.getElementById("f-role").value.trim();
  if (!company || !role) return alert("Company and role are required.");
  try {
    const app = await api("/applications", {
      method: "POST",
      body: {
        company,
        role,
        location: document.getElementById("f-location").value.trim(),
        link: document.getElementById("f-link").value.trim(),
        jobPostText: document.getElementById("f-jobpost").value.trim(),
        stage: document.getElementById("f-stage").value,
        source: "manual",
      },
    });
    dialog.close();
    window.location.href = `application.html?id=${app.id}`;
  } catch (err) {
    showError(document.querySelector("main"), err);
  }
};

/** The workspace's own smaller masthead sentence: what the board currently
 * holds, rather than a fixed page title. */
function renderPipelineStatement(apps, appsLoadFailed) {
  const el = document.getElementById("pipelineStatement");
  if (appsLoadFailed) {
    el.textContent = "Couldn't load your applications.";
    return;
  }
  if (!apps.length) {
    el.textContent = "The board is empty. Start one from Search, or add it by hand.";
    return;
  }
  const live = apps.filter((a) => !["rejected", "withdrawn"].includes(a.stage)).length;
  const closed = apps.length - live;
  let statement = `${live} live application${live === 1 ? "" : "s"} on the board`;
  statement += closed ? `, ${closed} closed.` : ".";
  el.textContent = statement;
}

/** Best-effort first-number scrape from freeform compensation text (e.g.
 * "$120k-140k" -> 120, "competitive" -> null). Mirrors the same
 * regex-scrape spirit as parseMatchScore in src/routes/applications.js --
 * good enough for sorting, not meant to be exact. */
function parseCompValue(compEstimate) {
  const m = String(compEstimate || "").match(/[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function renderComparePanel(apps) {
  compareAppsData = apps;
  const tbody = document.getElementById("compareTableBody");
  if (!tbody) return;

  const dir = compareSortDir === "asc" ? 1 : -1;
  const rows = [...apps].sort((a, b) => {
    if (compareSortKey === "match" || compareSortKey === "comp") {
      const av = compareSortKey === "match" ? a.matchScore : parseCompValue(a.compEstimate);
      const bv = compareSortKey === "match" ? b.matchScore : parseCompValue(b.compEstimate);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls sort last regardless of direction
      if (bv == null) return -1;
      return (av - bv) * dir;
    }
    if (compareSortKey === "stage") {
      return (STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)) * dir;
    }
    if (compareSortKey === "location") {
      return String(a.location || "").localeCompare(String(b.location || "")) * dir;
    }
    return (
      (String(a.company || "").localeCompare(String(b.company || "")) ||
        String(a.role || "").localeCompare(String(b.role || ""))) * dir
    );
  });

  tbody.innerHTML = rows
    .map(
      (a) => `
    <tr data-id="${a.id}">
      <td>${escapeHtml(a.company)} — ${escapeHtml(a.role)}</td>
      <td><span class="status-chip ${a.stage}">${a.stage}</span></td>
      <td>${matchPct(a.matchScore) != null ? matchPct(a.matchScore) + "%" : "—"}</td>
      <td>${a.compEstimate ? escapeHtml(a.compEstimate) : "—"}</td>
      <td>${escapeHtml(a.location || "—")}</td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => (window.location.href = `application.html?id=${tr.dataset.id}`);
  });

  document.querySelectorAll("#compareTable th[data-sort]").forEach((th) => {
    if (th.dataset.sort === compareSortKey) {
      th.setAttribute("aria-sort", compareSortDir === "asc" ? "ascending" : "descending");
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

document.querySelectorAll("#compareTable th[data-sort]").forEach((th) => {
  th.onclick = () => {
    const key = th.dataset.sort;
    compareSortDir = compareSortKey === key ? (compareSortDir === "asc" ? "desc" : "asc") : "asc";
    compareSortKey = key;
    renderComparePanel(compareAppsData);
  };
});

async function load() {
  let apps = [];
  let appsLoadFailed = false;
  try {
    apps = await api("/applications");
  } catch (err) {
    appsLoadFailed = true;
    showError(document.querySelector("main"), err);
  }

  renderPipelineStatement(apps, appsLoadFailed);
  renderComparePanel(apps);

  const stale = apps.filter((a) => isStale(a) && !["offer", "rejected", "withdrawn"].includes(a.stage));
  staleNotice.innerHTML = stale.length
    ? `<div class="error-banner" style="background:var(--warn-soft); color:var(--warn);">
        <strong>${stale.length} application${stale.length > 1 ? "s look" : " looks"} stalled</strong> —
        ${stale.map((a) => `${escapeHtml(a.company)} (${escapeHtml(a.stage)}, ${daysSince(a.stageEnteredAt)}d)`).join(", ")}.
        Consider a follow-up.
      </div>`
    : "";

  board.innerHTML = STAGES.map(
    ([key, label]) => `
    <div class="column" data-stage="${key}">
      <h3>${label} <span>${apps.filter((a) => a.stage === key).length}</span></h3>
      <div class="col-body"></div>
    </div>`
  ).join("");

  const rejectedCount = apps.filter((a) => a.stage === "rejected" || a.stage === "withdrawn").length;

  if (apps.length === 0) {
    board.innerHTML = `<div class="empty" style="grid-column: 1 / -1;">No applications yet. Click "New Application" above, or head to <a href="search.html">Search</a> to find and save one here.</div>`;
    return;
  }

  for (const [key] of STAGES) {
    const body = board.querySelector(`[data-stage="${key}"] .col-body`);
    const items = apps.filter((a) => a.stage === key);
    body.innerHTML = items
      .map(
        (a, i) => `
      <div class="app-card app-card-${a.stage} stagger-item" data-id="${a.id}" style="--index:${i};">
        <div class="row between">
          <span class="status-chip ${a.stage}">${a.stage}</span>
          ${matchPct(a.matchScore) != null ? `<span class="match-badge ${matchPct(a.matchScore) >= 80 ? "high" : matchPct(a.matchScore) >= 50 ? "mid" : "low"}">${matchPct(a.matchScore)}%</span>` : ""}
        </div>
        <div class="company">${escapeHtml(a.role)}</div>
        <div class="role">${escapeHtml(a.company)}</div>
        <div class="meta">${escapeHtml(a.location || "")} ${isStale(a) ? '<span class="pill warn">stalled</span>' : ""}</div>
        <div class="meta">${icon("clock")} updated ${timeAgo(a.updatedAt)}</div>
      </div>`
      )
      .join("");
  }

  if (rejectedCount) {
    board.insertAdjacentHTML(
      "beforeend",
      `<div class="column">
        <h3>Closed <span>${rejectedCount}</span></h3>
        <div class="col-body">
          ${apps
            .filter((a) => a.stage === "rejected" || a.stage === "withdrawn")
            .map(
              (a) => `<div class="app-card" data-id="${a.id}">
                <div class="company">${escapeHtml(a.company)}</div>
                <div class="role">${escapeHtml(a.role)}</div>
                <div class="meta"><span class="pill danger">${escapeHtml(a.stage)}</span></div>
              </div>`
            )
            .join("")}
        </div>
      </div>`
    );
  }

  board.querySelectorAll(".app-card").forEach((card) => {
    card.onclick = () => (window.location.href = `application.html?id=${card.dataset.id}`);
  });
}

load();
