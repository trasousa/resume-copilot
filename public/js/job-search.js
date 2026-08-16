import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl, ensureCvsOrEmptyState, fetchJobPostFromUrl } from "./app.js";

renderNav("job-search.html");
checkApiKey();

const main = document.querySelector("main");
const cvSelect = document.getElementById("cvSelect");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

async function loadCvs() {
  const cvs = await ensureCvsOrEmptyState(main, "Job search needs a CV to match against — add one first.");
  if (!cvs) return false;
  cvSelect.innerHTML = cvs
    .map((cv) => `<option value="${cv.id}" ${cv.isMaster ? "selected" : ""}>${escapeHtml(cv.label)}${cv.isMaster ? " (master)" : ""}</option>`)
    .join("");
  return true;
}

/** Prefill the search form from the saved profile, so preferences set during
 * onboarding (or a previous search) don't have to be re-typed every time. */
async function loadProfile() {
  const p = await api("/profile").catch(() => null);
  if (!p) return;
  document.getElementById("city").value = p.city;
  document.getElementById("region").value = p.region;
  document.getElementById("country").value = p.country;
  document.getElementById("remote").checked = p.remote;
  document.getElementById("minComp").value = p.minComp;
  document.getElementById("notes").value = p.notes;
}

function saveProfileFromForm() {
  api("/profile", {
    method: "PUT",
    body: {
      city: document.getElementById("city").value.trim(),
      region: document.getElementById("region").value.trim(),
      country: document.getElementById("country").value.trim(),
      remote: document.getElementById("remote").checked,
      minComp: document.getElementById("minComp").value.trim(),
      notes: document.getElementById("notes").value.trim(),
    },
  }).catch(() => {});
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
    saveProfileFromForm();
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
        ? `<div class="card"><h2>Start an application</h2><p class="muted">Starting fetches the posting, creates a tracked application, and tailors your CV to it.</p>${jobs
            .map(
              (j, i) => `
          <div class="row between" style="padding:8px 0; border-bottom:1px solid var(--border);">
            <div>
              <strong>${escapeHtml(j.title)}</strong> — ${escapeHtml(j.company)}<br/>
              <span class="muted">${escapeHtml(j.location || "")} ${j.compEstimate ? "· " + escapeHtml(j.compEstimate) : ""}</span>
              ${safeUrl(j.url) ? `<br/><a href="${escapeHtml(safeUrl(j.url))}" target="_blank" rel="noopener">${escapeHtml(j.url)}</a>` : ""}
            </div>
            <button class="btn secondary small" data-idx="${i}">Start application</button>
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
      btn.disabled = true;
      btn.textContent = "Starting…";
      try {
        // Fetch the actual posting text where possible so tailoring has
        // real content to work from, instead of just the title/company the
        // search step already extracted.
        let jobPostText = "";
        if (safeUrl(j.url)) {
          jobPostText = await fetchJobPostFromUrl(j.url).catch(() => "");
        }
        if (!jobPostText) {
          jobPostText = [j.title, j.company, j.location, j.fitNote].filter(Boolean).join("\n");
        }

        const app = await api("/applications", {
          method: "POST",
          body: {
            company: j.company,
            role: j.title,
            location: j.location,
            link: j.url,
            source: "job-search",
            compEstimate: j.compEstimate,
            jobPostText,
            cvId,
            stage: "saved",
          },
        });

        btn.textContent = "Tailoring your CV…";
        // Best-effort: kick off tailoring now so the application page loads
        // with a tailored CV and match tips already there. If it fails
        // (rate limit, no job post text extracted, etc.) the user can still
        // retry from the application page's own "Tailor CV" button.
        await api(`/applications/${app.id}/tailor`, { method: "POST", body: {} }).catch(() => {});

        window.location.href = `application.html?id=${app.id}`;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Start application";
        showError(main, err);
      }
    };
  });
}

loadCvs().then((hasCvs) => hasCvs && loadProfile());
