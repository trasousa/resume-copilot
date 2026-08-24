// The application dossier -- one case file, read top to bottom: a computed
// headline about where this application actually stands, the hard facts as a
// ruled ledger, then the work (tailored CV, generated documents, the file
// itself) with the record and stage control in the margin.

import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl, runStagedTask, skeletonBars, matchPct, daysSince, isStale } from "./app.js";
import { mountCvDocument } from "./cv-doc.js";

renderNav("pipeline.html"); // A single application belongs under the Pipeline section.
checkApiKey();

const main = document.querySelector("main");
const params = new URLSearchParams(location.search);
const appId = params.get("id");
if (!appId) document.body.innerHTML = "<main><p>No application id given.</p></main>";

// ?focus=<control> is emitted by the Desk's attention queue -- it names the
// control the reader was promised, which we scroll to and open on arrival.
const focusTarget = params.get("focus");

const STAGES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];

const DOC_TYPES = [
  ["coverLetter", "Cover letter"],
  ["coldEmail", "Cold email"],
  ["interviewPrep", "Interview prep"],
  ["salaryNegotiation", "Salary negotiation"],
  ["applicationForm", "Application form answers"],
  ["referenceList", "Reference list"],
  // These three had skills defined but nothing reaching them.
  ["offerComparison", "Offer comparison"],
  ["linkedin", "LinkedIn tune-up"],
  ["portfolioCaseStudy", "Portfolio case study"],
];

const labelFor = (key) => DOC_TYPES.find((d) => d[0] === key)?.[1] || key;

let app = null;
let docCount = 0;

async function load() {
  app = await api(`/applications/${appId}`);
  renderDocMaker();
  // Documents first: both the headline sentence and the ledger count them.
  await renderDocs();
  renderMasthead();
  renderLedger();
  renderStageBlock();
  renderFileForm();
  renderCvStatus();
  renderActivity();
  if (app.cvId) {
    const cv = await api(`/cvs/${app.cvId}`).catch(() => null);
    if (cv) renderTailoredCv(cv.content, "");
  }
  applyFocus();
}

// --- Masthead ---------------------------------------------------------------

function daysLabel(iso) {
  const days = daysSince(iso);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * The lede: one sentence naming this application's actual state, the way a
 * case file's first line summarizes the case. Built from stage, staleness, and
 * whether any work has been done on it -- never a static title.
 */
function headlineSentence() {
  const company = app.company;
  const inStage = daysSince(app.stageEnteredAt);
  const stale = isStale(app);

  if (app.stage === "offer") return `${company} made an offer. The decision is yours.`;
  if (app.stage === "rejected") return `${company} closed the door. The file stays for the record.`;
  if (app.stage === "withdrawn") return `You withdrew from ${company}.`;
  if (app.stage === "interview") {
    return stale
      ? `${company} has been quiet for ${inStage} days since the interview stage began.`
      : `You are interviewing at ${company}. Prepare like it matters.`;
  }
  if (app.stage === "screening") {
    return stale
      ? `${company}'s screening has gone quiet — ${inStage} days without movement.`
      : `${company} is screening you. ${docCount ? "The material is written." : "Nothing has been written for this round yet."}`;
  }
  if (app.stage === "applied") {
    return stale
      ? `${company} has been quiet for ${inStage} days since you applied.`
      : `You applied to ${company} ${daysLabel(app.stageEnteredAt)}. Now you wait.`;
  }
  // saved
  if (!app.cvId) return `${company} is saved but untouched — no CV has been tailored to this posting yet.`;
  return `${company} is tailored and ready. It has not been applied to.`;
}

function renderMasthead() {
  document.getElementById("dossierDateline").textContent =
    `${app.stage.toUpperCase()} · Opened ${daysLabel(app.createdAt)} · Last moved ${daysLabel(app.stageEnteredAt)}`;
  document.getElementById("dossierHeadline").textContent = headlineSentence();

  const posting = safeUrl(app.link);
  document.getElementById("dossierStandfirst").innerHTML = [
    `<strong>${escapeHtml(app.company)}</strong> — ${escapeHtml(app.role)}`,
    app.location ? escapeHtml(app.location) : "",
    posting ? `<a href="${escapeHtml(posting)}" target="_blank" rel="noopener">the posting</a>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// --- Fact ledger -------------------------------------------------------------

function renderLedger() {
  const pct = matchPct(app.matchScore);
  const rows = [
    ["Stage", `<span class="status-chip ${escapeHtml(app.stage)}">${escapeHtml(app.stage)}</span>`],
    [
      "Match",
      pct != null
        ? `${pct}%<div class="match-bar" style="max-width:220px;"><div class="match-bar-fill" style="width:${pct}%;"></div></div>`
        : `<span class="muted">Not scored — tailoring this posting produces one.</span>`,
    ],
    ["Compensation", app.compEstimate ? escapeHtml(app.compEstimate) : `<span class="muted">Unknown</span>`],
    ["Location", app.location ? escapeHtml(app.location) : `<span class="muted">Unspecified</span>`],
    ["Applied via", escapeHtml(app.source === "job-search" ? "Job Search" : app.source === "manual" ? "Manual" : app.source || "—")],
    ["Documents", `${docCount || "None"}`],
  ];

  document.getElementById("factLedger").innerHTML = rows
    .map(
      ([label, value]) => `
      <div class="fact-row">
        <span class="fact-label">${label}</span>
        <span class="fact-value">${value}</span>
      </div>`
    )
    .join("");
}

// --- Stage control -----------------------------------------------------------

function renderStageBlock() {
  document.getElementById("stageBlock").innerHTML = `
    <span class="status-chip ${escapeHtml(app.stage)}">${escapeHtml(app.stage)}</span>
    <p class="muted" style="margin:10px 0 0;">In this stage since ${escapeHtml(daysLabel(app.stageEnteredAt))}.</p>
    <label>Move to</label>
    <select id="stageSelect"></select>`;

  const sel = document.getElementById("stageSelect");
  sel.innerHTML = STAGES.map(
    (s) => `<option value="${s}" ${app.stage === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`
  ).join("");
  sel.onchange = async () => {
    try {
      app = await api(`/applications/${appId}`, { method: "PATCH", body: { stage: sel.value } });
    } catch (err) {
      showError(main, err);
      return;
    }
    renderMasthead();
    renderLedger();
    renderStageBlock();
    renderActivity();
  };
}

// --- The record (dated editorial timeline) -----------------------------------

async function renderActivity() {
  const events = await api(`/applications/${appId}/activity`).catch(() => []);
  const el = document.getElementById("activityRecord");
  if (!events.length) {
    el.innerHTML = `<li class="record-entry"><p class="record-detail" style="margin:0;">Nothing on the record yet.</p></li>`;
    return;
  }
  el.innerHTML = events
    .map(
      (e) => `
      <li class="record-entry">
        <span class="record-date">${escapeHtml(
          new Date(e.occurredAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        )}</span>
        <p class="record-title">${escapeHtml(e.title)}</p>
        ${e.detail ? `<p class="record-detail">${escapeHtml(e.detail)}</p>` : ""}
      </li>`
    )
    .join("");
}

document.getElementById("addReminderBtn").onclick = () => document.getElementById("reminderDialog").showModal();
document.getElementById("cancelReminder").onclick = () => document.getElementById("reminderDialog").close();
document.getElementById("saveReminder").onclick = async () => {
  const title = document.getElementById("r-title").value.trim();
  const date = document.getElementById("r-date").value;
  if (!title) return alert("Give the reminder a title.");
  await api(`/applications/${appId}/activity`, {
    method: "POST",
    body: { title, occurredAt: date ? new Date(date).toISOString() : new Date().toISOString() },
  }).catch((err) => showError(main, err));
  document.getElementById("reminderDialog").close();
  document.getElementById("r-title").value = "";
  renderActivity();
};

// --- The file (editable details) ---------------------------------------------

function renderFileForm() {
  document.getElementById("d-location").value = app.location || "";
  document.getElementById("d-link").value = app.link || "";
  document.getElementById("d-jobPost").value = app.jobPostText || "";
  document.getElementById("d-notes").value = app.notes || "";
}

document.getElementById("saveDetails").onclick = async () => {
  const status = document.getElementById("saveStatus");
  status.textContent = "saving…";
  try {
    app = await api(`/applications/${appId}`, {
      method: "PATCH",
      body: {
        location: document.getElementById("d-location").value.trim(),
        link: document.getElementById("d-link").value.trim(),
        jobPostText: document.getElementById("d-jobPost").value.trim(),
        notes: document.getElementById("d-notes").value.trim(),
      },
    });
    status.textContent = "saved";
    renderMasthead();
    renderLedger();
    setTimeout(() => (status.textContent = ""), 1500);
  } catch (err) {
    showError(main, err);
    status.textContent = "";
  }
};

document.getElementById("deleteAppBtn").onclick = async () => {
  if (!confirm(`Delete the ${app?.company || "this"} application and everything generated for it?`)) return;
  try {
    await api(`/applications/${appId}`, { method: "DELETE" });
    location.href = "pipeline.html";
  } catch (err) {
    showError(main, err);
  }
};

// --- Tailored CV --------------------------------------------------------------

function renderCvStatus() {
  document.getElementById("cvStatus").textContent = app.cvId
    ? "A CV is linked to this application — tailoring again will replace it."
    : "No tailored CV yet — generate one from this job post below.";
}

document.getElementById("tailorBtn").onclick = async () => {
  if (!app.jobPostText?.trim() && !document.getElementById("d-jobPost").value.trim()) {
    return alert("Paste the job post text into The file below and save it first.");
  }
  const btn = document.getElementById("tailorBtn");
  const resultWrap = document.getElementById("tailorResult");
  resultWrap.innerHTML = `<p class="muted" id="tailorStageStatus">Reading the job post…</p>${skeletonBars()}`;
  try {
    const { analysis, tailoredCv } = await runStagedTask(
      () => api(`/applications/${appId}/tailor`, { method: "POST", body: { flavor: document.getElementById("flavor").value } }),
      {
        statusEl: document.getElementById("tailorStageStatus"),
        button: btn,
        busyLabel: "Tailoring…",
        stages: [
          [0, "Reading the job post…"],
          [4000, "Matching against your CV…"],
          [15000, "Still working — long CVs take up to a minute."],
        ],
      }
    );
    const analysisText = analysis
      .replace(/```CV\n[\s\S]*?\n```/, "")
      .replace(/```KEYWORDS\n[\s\S]*?\n```/, "")
      .trim();
    if (tailoredCv) {
      app.cvId = tailoredCv.id;
      renderCvStatus();
      renderTailoredCv(tailoredCv.content, analysisText);
    } else {
      resultWrap.innerHTML = `<div class="doc-content" style="margin-top:12px;">${escapeHtml(analysisText)}</div>
        <p class="muted" style="margin-top:8px;">No structured tailored CV was returned — try again.</p>`;
    }
  } catch (err) {
    resultWrap.innerHTML = "";
    showError(main, err);
  }
};

function renderTailoredCv(content, analysisText) {
  const resultWrap = document.getElementById("tailorResult");
  resultWrap.innerHTML = `
    ${analysisText ? `<div class="doc-content" style="margin: 16px 0;">${escapeHtml(analysisText)}</div>` : ""}
    <div id="tailoredCvMount" style="margin-top:16px;"></div>`;

  const doc = mountCvDocument(document.getElementById("tailoredCvMount"), {
    content,
    editable: true,
    saveLabel: "Save edits as new version",
    onSave: async (text) => {
      const saved = await api(`/cvs/${app.cvId}/chat/accept`, {
        method: "POST",
        body: { content: text, label: `${app.company} - ${app.role}` },
      });
      app.cvId = saved.id;
      await api(`/applications/${appId}`, { method: "PATCH", body: { cvId: saved.id } });
    },
  });

  doc.setExtraActions(
    `<a class="btn secondary small" href="/api/applications/${encodeURIComponent(appId)}/tailored/download">Download .docx</a>`
  );
}

// --- Generated documents ------------------------------------------------------

function renderDocMaker() {
  document.getElementById("docMaker").innerHTML = DOC_TYPES.map(
    ([key, label]) => `<button class="btn secondary small" data-doc="${key}">${label}</button>`
  ).join("");
  document.querySelectorAll("[data-doc]").forEach((btn) => {
    btn.onclick = () => generateDoc(btn.dataset.doc);
  });
}

async function generateDoc(type) {
  const index = document.getElementById("docIndex");
  const pendingId = `pending-${type}`;
  const btn = document.querySelector(`[data-doc="${type}"]`);
  index.insertAdjacentHTML(
    "afterbegin",
    `<div class="doc-pending" id="${pendingId}"><p class="muted" id="${pendingId}-status">Reading the job post…</p>${skeletonBars(2)}</div>`
  );
  try {
    await runStagedTask(() => api(`/applications/${appId}/documents`, { method: "POST", body: { type } }), {
      statusEl: document.getElementById(`${pendingId}-status`),
      button: btn,
      busyLabel: "Writing…",
      stages: [
        [0, "Reading the job post…"],
        [4000, "Writing draft…"],
        [15000, "Still working — long CVs take up to a minute."],
      ],
    });
    document.getElementById(pendingId)?.remove();
    await renderDocs();
    renderLedger();
  } catch (err) {
    document.getElementById(pendingId)?.remove();
    showError(main, err);
  }
}

/** The vault becomes an index: each document is a titled, dated entry you open
 * and read in place, rather than a card with a cropped scroll window. */
async function renderDocs() {
  const docs = await api(`/applications/${appId}/documents`).catch(() => []);
  docCount = docs.length;
  const index = document.getElementById("docIndex");

  if (!docs.length) {
    index.innerHTML = `<p class="muted">Nothing written for this application yet.</p>`;
    return;
  }

  index.innerHTML = docs
    .slice()
    .reverse()
    .map(
      (d) => `
      <details class="doc-entry" data-doc-type="${escapeHtml(d.type)}">
        <summary>
          <span class="doc-entry-title">${escapeHtml(labelFor(d.type))}</span>
          <span class="doc-entry-date">${escapeHtml(
            d.createdAt ? new Date(d.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""
          )}</span>
        </summary>
        <div class="doc-entry-body">${escapeHtml(d.content)}</div>
        <div class="doc-entry-actions">
          <button type="button" class="cv-row-action" data-copy="${escapeHtml(d.id)}">Copy</button>
          <button type="button" class="cv-row-action danger" data-del="${escapeHtml(d.id)}">Delete</button>
        </div>
      </details>`
    )
    .join("");

  index.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.onclick = () => {
      const doc = docs.find((d) => d.id === btn.dataset.copy);
      navigator.clipboard.writeText(doc.content);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    };
  });
  index.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/applications/${appId}/documents/${btn.dataset.del}`, { method: "DELETE" });
      } catch (err) {
        showError(main, err);
        return;
      }
      await renderDocs();
      renderLedger();
    };
  });
}

// --- Deep links ----------------------------------------------------------------

function flash(el) {
  el.classList.remove("focus-flash");
  void el.offsetWidth; // restart the animation if the class was already there
  el.classList.add("focus-flash");
}

/**
 * The Desk's queue links here promising a specific next step ("Tailor",
 * "Interview prep"). Land the reader on that control rather than at the top of
 * a page they then have to search.
 */
function applyFocus() {
  if (!focusTarget) return;

  if (focusTarget === "tailor") {
    const section = document.getElementById("tailorSection");
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    flash(section);
    document.getElementById("tailorBtn").focus({ preventScroll: true });
    return;
  }

  if (!DOC_TYPES.some(([key]) => key === focusTarget)) return;

  // If that document already exists, open it to read; otherwise open the maker
  // with its button ready to press.
  const existing = document.querySelector(`.doc-entry[data-doc-type="${focusTarget}"]`);
  if (existing) {
    existing.open = true;
    existing.scrollIntoView({ behavior: "smooth", block: "center" });
    flash(existing);
    return;
  }

  const generator = document.getElementById("docGenerator");
  generator.open = true;
  const btn = document.querySelector(`[data-doc="${focusTarget}"]`);
  generator.scrollIntoView({ behavior: "smooth", block: "center" });
  if (btn) {
    flash(btn);
    btn.focus({ preventScroll: true });
  }
}

load().catch((err) => showError(main, err));
