import { api, escapeHtml, renderNav, showError, checkApiKey, wireJobPostFetch, ensureCvsOrEmptyState } from "./app.js";
import { mountCvDocument } from "./cv-doc.js";
import { renderMarkdown } from "./markdown.js";

renderNav("tailor.html");
checkApiKey();

wireJobPostFetch({
  linkInput: document.getElementById("jobPostLink"),
  fetchBtn: document.getElementById("fetchJobPost"),
  jobPostTextarea: document.getElementById("jobPost"),
  statusEl: document.getElementById("fetchStatus"),
});

const main = document.querySelector("main");
const cvSelect = document.getElementById("cvSelect");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

async function loadCvs() {
  const cvs = await ensureCvsOrEmptyState(main, "Tailoring needs a CV to work from — add one first.");
  if (!cvs) return;
  cvSelect.innerHTML = cvs
    .map((cv) => `<option value="${cv.id}" ${cv.isMaster ? "selected" : ""}>${escapeHtml(cv.label)}${cv.isMaster ? " (master)" : ""}</option>`)
    .join("");
}

document.getElementById("runBtn").onclick = async () => {
  const cvId = cvSelect.value;
  const jobPostText = document.getElementById("jobPost").value.trim();
  if (!cvId) return alert("Add a CV first (CV Store tab).");
  if (!jobPostText) return alert("Paste a job posting first.");

  statusEl.innerHTML = `<span class="spinner"></span> analyzing and tailoring…`;
  resultEl.innerHTML = "";
  try {
    const data = await api("/tailor/quick", {
      method: "POST",
      body: { cvId, jobPostText, flavor: document.getElementById("flavor").value },
    });
    render(data);
  } catch (err) {
    showError(main, err);
  } finally {
    statusEl.textContent = "";
  }
};

function render(data) {
  const analysisText = data.analysis
    .replace(/```CV\n[\s\S]*?\n```/, "")
    .replace(/```KEYWORDS\n[\s\S]*?\n```/, "")
    .trim();
  resultEl.innerHTML = `
    <details class="card" open>
      <summary><h2 style="display:inline;">Match analysis</h2></summary>
      <div class="doc-content markdown-body">${renderMarkdown(analysisText)}</div>
    </details>
    <div id="tailoredCvMount"></div>
  `;

  if (!data.tailoredText) {
    document.getElementById("tailoredCvMount").innerHTML =
      `<p class="muted">No structured tailored CV was returned — try again, or refine the job posting text.</p>`;
    return;
  }

  const scoreMatch = data.analysis.match(/match\s*score[:\s]*[^\d]{0,10}(\d{1,3})/i);
  const pill = document.getElementById("matchPill");
  if (scoreMatch) { pill.textContent = `${scoreMatch[1]}% Match`; pill.style.display = "inline-block"; }

  const doc = mountCvDocument(document.getElementById("tailoredCvMount"), {
    content: data.tailoredText,
    editable: true,
    saveLabel: "Save as new CV version",
    highlightTerms: data.keywords || [],
    onSave: (text) => api("/tailor/quick/save", { method: "POST", body: { baseCvId: data.baseCvId, content: text } }),
  });

  doc.setExtraActions(`<button type="button" class="btn secondary small" id="applyBtn">Save &amp; create application</button>`);

  document.getElementById("applyBtn").onclick = async () => {
    const company = prompt("Company name?");
    if (!company) return;
    const role = prompt("Role title?") || "Role";
    const cv = await api("/tailor/quick/save", {
      method: "POST",
      body: { baseCvId: data.baseCvId, content: doc.getContent(), label: `${company} - ${role}` },
    });
    const app = await api("/applications", {
      method: "POST",
      body: { company, role, jobPostText: document.getElementById("jobPost").value.trim(), cvId: cv.id, stage: "saved" },
    });
    window.location.href = `application.html?id=${app.id}`;
  };
}

loadCvs();
