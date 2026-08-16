import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, wireJobPostFetch } from "./app.js";

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

document.getElementById("newAppBtn").onclick = async () => {
  dialog.showModal();
  const hint = document.getElementById("newAppCvHint");
  hint.innerHTML = "";
  const cvs = await api("/cvs").catch(() => []);
  if (!cvs.length) {
    hint.innerHTML = `<p class="muted" style="margin: -4px 0 12px;">No CV in the store yet — you can save this application now, but tailoring needs one from <a href="cv-store.html">CV Store</a> first.</p>`;
  }
};
document.getElementById("cancelNewApp").onclick = () => dialog.close();

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

async function load() {
  let apps = [];
  try {
    apps = await api("/applications");
  } catch (err) {
    showError(document.querySelector("main"), err);
  }

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
    board.innerHTML = `<div class="empty" style="grid-column: 1 / -1;">No applications yet. Click "+ New application", or find roles from the Job Search tab and save them here.</div>`;
    return;
  }

  for (const [key] of STAGES) {
    const body = board.querySelector(`[data-stage="${key}"] .col-body`);
    const items = apps.filter((a) => a.stage === key);
    body.innerHTML = items
      .map(
        (a) => `
      <div class="app-card" data-id="${a.id}">
        <div class="company">${escapeHtml(a.company)}</div>
        <div class="role">${escapeHtml(a.role)}</div>
        <div class="meta">${escapeHtml(a.location || "")} ${isStale(a) ? '<span class="pill warn">stalled</span>' : ""}</div>
        <div class="meta">updated ${timeAgo(a.updatedAt)}</div>
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
