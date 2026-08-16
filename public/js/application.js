import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl } from "./app.js";
import { mountCvDocument } from "./cv-doc.js";

renderNav("");
checkApiKey();

const main = document.querySelector("main");
const params = new URLSearchParams(location.search);
const appId = params.get("id");
if (!appId) document.body.innerHTML = "<main><p>No application id given.</p></main>";

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

let app = null;

async function load() {
  app = await api(`/applications/${appId}`);
  renderHeader();
  renderDetails();
  renderCvStatus();
  renderDocButtons();
  renderDocs();
  if (app.cvId) {
    const cv = await api(`/cvs/${app.cvId}`);
    renderTailoredCv(cv.content, "");
  }
}

function renderHeader() {
  document.getElementById("header").innerHTML = `
    <h1>${escapeHtml(app.company)} — ${escapeHtml(app.role)}</h1>
    <p class="subtitle">${escapeHtml(app.location || "")} ${app.compEstimate ? "· " + escapeHtml(app.compEstimate) : ""} ${safeUrl(app.link) ? `· <a href="${escapeHtml(safeUrl(app.link))}" target="_blank" rel="noopener">posting</a>` : ""}</p>
  `;
}

function renderDetails() {
  const sel = document.getElementById("stageSelect");
  sel.innerHTML = STAGES.map((s) => `<option value="${s}" ${app.stage === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("");
  document.getElementById("location").value = app.location || "";
  document.getElementById("link").value = app.link || "";
  document.getElementById("jobPost").value = app.jobPostText || "";
  document.getElementById("notes").value = app.notes || "";
}

document.getElementById("saveDetails").onclick = async () => {
  const status = document.getElementById("saveStatus");
  status.textContent = "saving…";
  try {
    app = await api(`/applications/${appId}`, {
      method: "PATCH",
      body: {
        stage: document.getElementById("stageSelect").value,
        location: document.getElementById("location").value.trim(),
        link: document.getElementById("link").value.trim(),
        jobPostText: document.getElementById("jobPost").value.trim(),
        notes: document.getElementById("notes").value.trim(),
      },
    });
    status.textContent = "saved";
    renderHeader();
    setTimeout(() => (status.textContent = ""), 1500);
  } catch (err) {
    showError(main, err);
    status.textContent = "";
  }
};

function renderCvStatus() {
  const el = document.getElementById("cvStatus");
  el.textContent = app.cvId ? "A CV is linked to this application — tailoring again will replace it." : "No tailored CV yet — click below to generate one from this job post.";
}

document.getElementById("tailorBtn").onclick = async () => {
  if (!app.jobPostText?.trim() && !document.getElementById("jobPost").value.trim()) {
    return alert("Paste the job post text and save details first.");
  }
  const btn = document.getElementById("tailorBtn");
  btn.disabled = true;
  const resultWrap = document.getElementById("tailorResult");
  resultWrap.innerHTML = `<p class="muted"><span class="spinner"></span> analyzing and tailoring…</p>`;
  try {
    const { analysis, tailoredCv } = await api(`/applications/${appId}/tailor`, {
      method: "POST",
      body: { flavor: document.getElementById("flavor").value },
    });
    const analysisText = analysis.replace(/```CV\n[\s\S]*?\n```/, "").trim();
    if (tailoredCv) {
      app.cvId = tailoredCv.id;
      renderCvStatus();
      renderTailoredCv(tailoredCv.content, analysisText);
    } else {
      resultWrap.innerHTML = `<div class="doc-content" style="margin-top:12px;">${escapeHtml(analysisText)}</div>
        <p class="muted" style="margin-top:8px;">No structured tailored CV was returned — try again.</p>`;
    }
  } catch (err) {
    showError(main, err);
    resultWrap.innerHTML = "";
  } finally {
    btn.disabled = false;
  }
};

function renderTailoredCv(content, analysisText) {
  const resultWrap = document.getElementById("tailorResult");
  resultWrap.innerHTML = `
    ${analysisText ? `<div class="doc-content" style="margin: 12px 0;">${escapeHtml(analysisText)}</div>` : ""}
    <div id="tailoredCvMount"></div>
  `;

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
    `<a class="btn secondary small" href="/api/applications/${appId}/tailored/download">Download .docx</a>`
  );
}

function renderDocButtons() {
  document.getElementById("docButtons").innerHTML = DOC_TYPES.map(
    ([key, label]) => `<button class="btn secondary small" data-doc="${key}">${label}</button>`
  ).join("");
  document.querySelectorAll("[data-doc]").forEach((btn) => {
    btn.onclick = () => generateDoc(btn.dataset.doc);
  });
}

async function generateDoc(type) {
  const list = document.getElementById("docsList");
  const pendingId = `pending-${type}`;
  list.insertAdjacentHTML("afterbegin", `<div class="card" id="${pendingId}"><span class="spinner"></span> generating ${escapeHtml(type)}…</div>`);
  try {
    await api(`/applications/${appId}/documents`, { method: "POST", body: { type } });
    document.getElementById(pendingId)?.remove();
    renderDocs();
  } catch (err) {
    document.getElementById(pendingId)?.remove();
    showError(main, err);
  }
}

async function renderDocs() {
  const docs = await api(`/applications/${appId}/documents`);
  const list = document.getElementById("docsList");
  if (!docs.length) {
    list.innerHTML = `<p class="muted">Nothing generated yet.</p>`;
    return;
  }
  const labelFor = (key) => DOC_TYPES.find((d) => d[0] === key)?.[1] || key;
  list.innerHTML = docs
    .slice()
    .reverse()
    .map(
      (d) => `
    <div class="card">
      <div class="row between">
        <h2>${escapeHtml(labelFor(d.type))}</h2>
        <div class="row">
          <button class="btn secondary small" data-copy="${d.id}">Copy</button>
          <button class="btn danger small" data-del="${d.id}">Delete</button>
        </div>
      </div>
      <div class="doc-content">${escapeHtml(d.content)}</div>
    </div>`
    )
    .join("");

  list.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.onclick = () => {
      const doc = docs.find((d) => d.id === btn.dataset.copy);
      navigator.clipboard.writeText(doc.content);
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    };
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/applications/${appId}/documents/${btn.dataset.del}`, { method: "DELETE" });
      renderDocs();
    };
  });
}

load();
