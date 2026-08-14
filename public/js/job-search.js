import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl } from "./app.js";

renderNav("job-search.html");
checkApiKey();

const main = document.querySelector("main");
const cvSelect = document.getElementById("cvSelect");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

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

function extractJobs(text) {
  const match = text.match(/```JOBS\n([\s\S]*?)\n```/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

document.getElementById("searchBtn").onclick = async () => {
  const cvId = cvSelect.value;
  if (!cvId) return alert("Add a CV first (CV Store tab).");
  const remote = document.getElementById("remote").checked;
  const city = document.getElementById("city").value.trim();
  const region = document.getElementById("region").value.trim();
  const country = document.getElementById("country").value.trim();
  if (!remote && !city && !region && !country) return alert("Enter a location, or check 'remote'.");

  statusEl.innerHTML = `<span class="spinner"></span> searching the web — this can take a bit…`;
  resultEl.innerHTML = "";
  try {
    const data = await api("/jobsearch/search", {
      method: "POST",
      body: {
        cvId,
        city,
        region,
        country,
        remote,
        minComp: document.getElementById("minComp").value.trim(),
        notes: document.getElementById("notes").value.trim(),
      },
    });
    render(data, cvId);
  } catch (err) {
    showError(main, err);
  } finally {
    statusEl.textContent = "";
  }
};

function render(data, cvId) {
  const jobs = extractJobs(data.text);
  const analysisText = data.text.replace(/```JOBS\n[\s\S]*?\n```/, "").trim();

  resultEl.innerHTML = `
    <div class="card">
      <h2>Results</h2>
      <div class="doc-content">${escapeHtml(analysisText)}</div>
    </div>
    ${
      jobs.length
        ? `<div class="card"><h2>Save a match as a tracked application</h2>${jobs
            .map(
              (j, i) => `
          <div class="row between" style="padding:8px 0; border-bottom:1px solid var(--border);">
            <div>
              <strong>${escapeHtml(j.title)}</strong> — ${escapeHtml(j.company)}<br/>
              <span class="muted">${escapeHtml(j.location || "")} ${j.compEstimate ? "· " + escapeHtml(j.compEstimate) : ""}</span>
              ${safeUrl(j.url) ? `<br/><a href="${escapeHtml(safeUrl(j.url))}" target="_blank" rel="noopener">${escapeHtml(j.url)}</a>` : ""}
            </div>
            <button class="btn secondary small" data-idx="${i}">Save</button>
          </div>`
            )
            .join("")}</div>`
        : ""
    }
    ${
      data.sources?.length
        ? `<div class="card"><h2>Search sources</h2><p class="muted">Every job above came from one of these live search results — check here if anything looks off.</p>
          <div class="tag-list">${data.sources.filter((s) => safeUrl(s.url)).map((s) => `<a class="pill muted" href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a>`).join("")}</div>
        </div>`
        : ""
    }
  `;

  resultEl.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.onclick = async () => {
      const j = jobs[Number(btn.dataset.idx)];
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
      window.location.href = `application.html?id=${app.id}`;
    };
  });
}

loadCvs();
