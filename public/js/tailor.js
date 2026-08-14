import { api, escapeHtml, renderNav, showError, checkApiKey } from "./app.js";

renderNav("tailor.html");
checkApiKey();

const main = document.querySelector("main");
const cvSelect = document.getElementById("cvSelect");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

let lastResult = null;

async function loadCvs() {
  const cvs = await api("/cvs");
  if (!cvs.length) {
    cvSelect.innerHTML = `<option value="">No CVs yet — add one in CV Store first</option>`;
    return;
  }
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
    lastResult = data;
    render(data);
  } catch (err) {
    showError(main, err);
  } finally {
    statusEl.textContent = "";
  }
};

function render(data) {
  const analysisText = data.analysis.replace(/```CV\n[\s\S]*?\n```/, "").trim();
  resultEl.innerHTML = `
    <div class="card">
      <h2>Match analysis</h2>
      <div class="doc-content">${escapeHtml(analysisText)}</div>
    </div>
    ${
      data.tailoredText
        ? `<div class="card">
            <div class="row between">
              <h2>Tailored CV</h2>
              <div class="row">
                <button class="btn secondary small" id="saveBtn">Save as new CV version</button>
                <button class="btn secondary small" id="applyBtn">Save &amp; create application</button>
              </div>
            </div>
            <pre class="cv-preview">${escapeHtml(data.tailoredText)}</pre>
          </div>`
        : `<p class="muted">No structured tailored CV was returned — try again, or refine the job posting text.</p>`
    }
  `;

  document.getElementById("saveBtn")?.addEventListener("click", async () => {
    await api("/tailor/quick/save", { method: "POST", body: { baseCvId: data.baseCvId, content: data.tailoredText } });
    alert("Saved to CV Store.");
  });

  document.getElementById("applyBtn")?.addEventListener("click", async () => {
    const company = prompt("Company name?");
    if (!company) return;
    const role = prompt("Role title?") || "Role";
    const cv = await api("/tailor/quick/save", {
      method: "POST",
      body: { baseCvId: data.baseCvId, content: data.tailoredText, label: `${company} - ${role}` },
    });
    const app = await api("/applications", {
      method: "POST",
      body: { company, role, jobPostText: document.getElementById("jobPost").value.trim(), cvId: cv.id, stage: "saved" },
    });
    window.location.href = `application.html?id=${app.id}`;
  });
}

loadCvs();
