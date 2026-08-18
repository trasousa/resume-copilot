import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl, ensureCvsOrEmptyState, fetchJobPostFromUrl } from "./app.js";
import { icon } from "./icons.js";

renderNav("job-search.html");
checkApiKey();

const main = document.querySelector("main");
const cvSelect = document.getElementById("cvSelect");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

const chipEls = document.querySelectorAll("#jobTypeChips .chip");
chipEls.forEach((chip) => {
  chip.onclick = () => chip.classList.toggle("active");
});
function selectedJobTypes() {
  return [...chipEls].filter((c) => c.classList.contains("active")).map((c) => c.dataset.type);
}

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

const SOURCE_LABELS = { arbeitnow: "Arbeitnow", himalayas: "Himalayas", jsearch: "LinkedIn/Indeed/Glassdoor" };
const progressEl = document.getElementById("searchProgress");

function renderProgressRow(source, status, extra) {
  let row = progressEl.querySelector(`[data-source="${source}"]`);
  if (!row) {
    row = document.createElement("span");
    row.className = "source-row";
    row.dataset.source = source;
    progressEl.appendChild(row);
  }
  row.className = `source-row ${status}`;
  const label = SOURCE_LABELS[source] || source;
  if (status === "searching") row.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`;
  else if (status === "done") row.textContent = `${label}: ${extra} found`;
  else row.textContent = `${label}: unavailable`;
}

document.getElementById("searchBtn").onclick = async () => {
  const cvId = cvSelect.value;
  if (!cvId) return alert("Add a CV first (CV Store tab).");
  const remote = document.getElementById("remote").checked;
  const city = document.getElementById("city").value.trim();
  const region = document.getElementById("region").value.trim();
  const country = document.getElementById("country").value.trim();
  if (!remote && !city && !region && !country) return alert("Enter a location, or check 'remote'.");

  const searchBtn = document.getElementById("searchBtn");
  searchBtn.disabled = true;

  statusEl.textContent = "Searching three sources and ranking matches — this can take up to two minutes.";
  progressEl.innerHTML = "";
  resultEl.innerHTML = "";

  try {
    const res = await fetch("/api/jobsearch/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cvId,
        city,
        region,
        country,
        remote,
        minComp: document.getElementById("minComp").value.trim(),
        notes: [document.getElementById("notes").value.trim(), selectedJobTypes().length ? `Job type preference: ${selectedJobTypes().join(", ")}` : ""].filter(Boolean).join(". "),
      }),
    });

    if (!res.ok) {
      let error;
      try {
        error = (await res.json()).error;
      } catch {
        if (res.status === 401) error = "Your session expired. Reload the page to sign in again.";
      }
      throw new Error(error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData = null;

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const dataLine = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !dataLine) continue;

        const data = JSON.parse(dataLine);
        if (event === "source") {
          renderProgressRow(data.source, data.status, data.status === "done" ? data.count : data.message);
        } else if (event === "complete") {
          finalData = data;
        }
      }
    }

    saveProfileFromForm();
    if (finalData) render(finalData, cvId);
  } catch (err) {
    showError(main, err);
  } finally {
    statusEl.textContent = "";
    searchBtn.disabled = false;
  }
};

function render(data, cvId) {
  const jobs = data.jobs || [];
  const analysisText = data.text || "";

  resultEl.innerHTML = `
    <div class="card">
      <h2>Results</h2>
      <div class="doc-content">${escapeHtml(analysisText)}</div>
    </div>
    ${data.rankingError ? `<div class="error-banner" style="background:var(--warn-soft); color:var(--warn);">Ranking failed this time (${escapeHtml(data.rankingError)}); showing unranked results.</div>` : ""}
    ${
      jobs.length
        ? `<div class="job-grid">${jobs
            .map(
              (j, i) => `
          <div class="card job-card">
            <div class="row between">
              <div>
                <h2 class="card-title">${escapeHtml(j.title)}</h2>
                <p class="muted" style="margin:0;">${escapeHtml(j.company)}</p>
              </div>
              ${j.matchScore != null ? `<span class="match-badge ${j.matchScore >= 80 ? "high" : j.matchScore >= 50 ? "mid" : "low"}">${j.matchScore}% MATCH</span>` : ""}
              ${j.source === "arbeitnow" ? `<span class="pill muted" title="Found via Arbeitnow's job board API">Arbeitnow</span>` : ""}
            </div>
            <p class="muted" style="margin:10px 0;">${icon("mapPin")} ${escapeHtml(j.location || "")} ${j.compEstimate ? `&nbsp;${icon("dollar")} ${escapeHtml(j.compEstimate)}` : ""}</p>
            ${j.fitNote ? `<p style="font-size:13.5px;">${escapeHtml(j.fitNote)}</p>` : ""}
            <div class="row" style="margin-top:12px;">
              <button class="btn" data-idx="${i}" style="flex:1;">Tailor Resume</button>
              ${safeUrl(j.url) ? `<a class="icon-btn" href="${escapeHtml(safeUrl(j.url))}" target="_blank" rel="noopener" title="View posting">${icon("chevronRight")}</a>` : ""}
            </div>
          </div>`
            )
            .join("")}</div>`
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
        btn.textContent = "Tailor Resume";
        showError(main, err);
      }
    };
  });
}

loadCvs().then((hasCvs) => hasCvs && loadProfile());
