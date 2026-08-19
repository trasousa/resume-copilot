import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, wireJobPostFetch } from "./app.js";
import { icon } from "./icons.js";

renderNav("index.html");
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

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function isStale(app) {
  const days = daysSince(app.stageEnteredAt);
  if (app.stage === "applied" && days >= 14) return true;
  if (app.stage === "screening" && days >= 10) return true;
  if (app.stage === "interview" && days >= 7) return true;
  return false;
}

function renderStats(apps, stats) {
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

async function load() {
  let apps = [];
  let appsLoadFailed = false;
  try {
    apps = await api("/applications");
  } catch (err) {
    appsLoadFailed = true;
    showError(document.querySelector("main"), err);
  }

  const stats = await api("/applications/stats").catch(() => ({ total: apps.length, interviews: 0, offers: 0, avgMatch: null }));
  renderStats(apps, stats);
  renderMastheadStatement(apps, stats, appsLoadFailed);

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
    board.innerHTML = `<div class="empty" style="grid-column: 1 / -1;">No applications yet. Click "+ New application", or expand "Find roles" above to search and save one here.</div>`;
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
          ${a.matchScore != null ? `<span class="match-badge ${a.matchScore >= 80 ? "high" : a.matchScore >= 50 ? "mid" : "low"}">${a.matchScore}%</span>` : ""}
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
