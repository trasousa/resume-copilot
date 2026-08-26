// Search workspace -- the job-search form (left rail), the progressive-SSE
// result stream, the ranking summary, and the map. Moved here from index.js
// when Search stopped being a collapsed pane on the tracker; the search flow
// and its event handling are unchanged.

import { api, escapeHtml, renderNav, showError, checkApiKey, safeUrl, fetchJobPostFromUrl, matchPct } from "./app.js";
import { icon } from "./icons.js";

renderNav("search.html");
checkApiKey();

const cvSelect = document.getElementById("cvSelect");
const searchResultEl = document.getElementById("result");
const searchStatusEl = document.getElementById("status");
const searchProgressEl = document.getElementById("searchProgress");
const searchPaneBody = document.getElementById("searchPaneBody");

const SOURCE_LABELS = {
  arbeitnow: "Arbeitnow",
  himalayas: "Himalayas",
  jsearch: "LinkedIn/Indeed/Glassdoor",
  tavily: "Tavily (web search)",
  freehire: "freehire (ATS aggregator)",
  linkedin: "LinkedIn",
};

const chipEls = document.querySelectorAll("#jobTypeChips .chip");
chipEls.forEach((chip) => {
  chip.onclick = () => chip.classList.toggle("active");
});
function selectedJobTypes() {
  return [...chipEls].filter((c) => c.classList.contains("active")).map((c) => c.dataset.type);
}

/** Populates the CV select. Scoped to #searchPaneBody rather than calling
 * ensureCvsOrEmptyState(main, ...) -- that would wipe the whole workspace
 * (masthead, results column), not just the form rail. */
async function loadSearchCvs() {
  const cvs = await api("/cvs").catch(() => []);
  if (!cvs.length) {
    searchPaneBody.innerHTML = `<p class="muted">Job search needs a CV to match against — add one in the <a href="studio.html">Studio</a> first.</p>`;
    return false;
  }
  cvSelect.innerHTML = cvs
    .map((cv) => `<option value="${cv.id}" ${cv.isMaster ? "selected" : ""}>${escapeHtml(cv.label)}${cv.isMaster ? " (master)" : ""}</option>`)
    .join("");
  return true;
}

/** Prefill the search form from the saved profile, so preferences set
 * during onboarding (or a previous search) don't have to be re-typed. */
async function loadSearchProfile() {
  const p = await api("/profile").catch(() => null);
  if (!p) return;
  document.getElementById("city").value = p.city;
  document.getElementById("region").value = p.region;
  document.getElementById("country").value = p.country;
  document.getElementById("remote").checked = p.remote;
  document.getElementById("minComp").value = p.minComp;
  document.getElementById("notes").value = p.notes;
  document.getElementById("targetRole").value = p.targetRole || "";
  document.getElementById("languages").value = p.languages || "";
  document.getElementById("dealBreakers").value = p.dealBreakers || "";
}

function saveSearchProfileFromForm() {
  api("/profile", {
    method: "PUT",
    body: {
      city: document.getElementById("city").value.trim(),
      region: document.getElementById("region").value.trim(),
      country: document.getElementById("country").value.trim(),
      remote: document.getElementById("remote").checked,
      minComp: document.getElementById("minComp").value.trim(),
      notes: document.getElementById("notes").value.trim(),
      targetRole: document.getElementById("targetRole").value.trim(),
      languages: document.getElementById("languages").value.trim(),
      dealBreakers: document.getElementById("dealBreakers").value.trim(),
    },
  }).catch(() => {});
}

function renderProgressRow(source, status, extra) {
  let row = searchProgressEl.querySelector(`[data-source="${source}"]`);
  if (!row) {
    row = document.createElement("span");
    row.className = "source-row";
    row.dataset.source = source;
    searchProgressEl.appendChild(row);
  }
  row.className = `source-row ${status}`;
  const label = SOURCE_LABELS[source] || source;
  if (status === "searching") row.innerHTML = `${escapeHtml(label)}: <span class="skeleton-pulse"></span>`;
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

  searchStatusEl.textContent = "Contacting job sources…";
  searchProgressEl.innerHTML = "";
  searchResultEl.innerHTML = "";

  // One mutable state object per search; every stream event updates it and
  // re-renders, so real results appear the moment sources answer instead of
  // waiting out ranking (slow LLM call) and geocoding (~1s per new city).
  const state = { jobs: [], total: 0, text: "", rankingError: null, ranked: false, coords: null, savedKeys: new Set(), cvId, gateFiltered: [], alreadyTracked: 0 };

  const updateStatus = () => {
    if (!state.jobs.length) return;
    if (!state.ranked) {
      searchStatusEl.textContent = `Found ${state.total} roles — showing the top ${state.jobs.length} below while they're ranked against your CV…`;
    } else if (!state.coords) {
      searchStatusEl.textContent = "Ranked. Placing roles on the map…";
    } else {
      searchStatusEl.textContent = "";
    }
  };

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
        targetRole: document.getElementById("targetRole").value.trim(),
        languages: document.getElementById("languages").value.trim(),
        dealBreakers: document.getElementById("dealBreakers").value.trim(),
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
        } else if (event === "jobs") {
          state.jobs = data.jobs || [];
          state.total = data.total ?? state.jobs.length;
          state.alreadyTracked = data.alreadyTracked ?? 0;
          renderSearchResults(state);
        } else if (event === "ranked") {
          state.ranked = true;
          if (data.rankingError) state.rankingError = data.rankingError;
          else {
            state.jobs = data.jobs || state.jobs;
            state.text = data.text || "";
            state.gateFiltered = data.gateFiltered || [];
          }
          renderSearchResults(state);
        } else if (event === "geo") {
          state.coords = data.coords || {};
          renderSearchResults(state);
        } else if (event === "complete") {
          state.ranked = true;
          state.coords = state.coords || {};
          state.jobs = data.jobs || state.jobs;
          state.text = data.text || state.text;
          state.gateFiltered = data.gateFiltered || state.gateFiltered;
          state.alreadyTracked = data.alreadyTracked ?? state.alreadyTracked;
          if (data.rankingError) state.rankingError = data.rankingError;
          renderSearchResults(state);
        }
        updateStatus();
      }
    }

    saveSearchProfileFromForm();
  } catch (err) {
    showError(document.querySelector("main"), err);
  } finally {
    searchStatusEl.textContent = "";
    searchBtn.disabled = false;
  }
};

let jobMapInstance = null;

function renderJobMap(jobs) {
  const container = document.getElementById("jobMap");
  if (!container) return;

  const geocodedJobs = jobs.filter((j) => j.lat != null && j.lng != null);
  if (!geocodedJobs.length) {
    container.style.display = "none";
    return;
  }
  container.style.display = "";

  if (jobMapInstance) {
    jobMapInstance.remove();
    jobMapInstance = null;
  }

  // eslint-disable-next-line no-undef
  const map = L.map(container);
  // eslint-disable-next-line no-undef
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const markers = geocodedJobs.map((j) =>
    // eslint-disable-next-line no-undef
    L.marker([j.lat, j.lng])
      .bindPopup(`<strong>${escapeHtml(j.title)}</strong><br>${escapeHtml(j.company)}`)
      .addTo(map)
  );

  // eslint-disable-next-line no-undef
  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 10 });

  jobMapInstance = map;
}

/** Mirrors the backend's geocode normalizeQuery so the `geo` event's keys
 * match up with each job's location string. */
function normalizeLocation(location) {
  return String(location || "").trim().toLowerCase();
}

const SCORE_DIMENSIONS = [
  ["technical", "Skills"],
  ["experience", "Experience"],
  ["career", "Career"],
];

/** The three dimensions behind the headline match score. A single number
 * hides which part is weak -- 70% because the skills fit but the seniority
 * doesn't is a different job from 70% the other way round. */
function renderScoreBreakdown(job) {
  const rows = SCORE_DIMENSIONS.map(([key, label]) => [label, matchPct(job.scores?.[key])]).filter(
    ([, pct]) => pct != null
  );
  if (!rows.length) return "";
  return `<div class="score-breakdown">${rows
    .map(
      ([label, pct]) => `
      <div class="score-row">
        <span class="score-label">${label}</span>
        <span class="score-track"><span class="score-fill" style="width:${pct}%;"></span></span>
        <span class="score-value">${pct}</span>
      </div>`
    )
    .join("")}</div>`;
}

/** What the search removed on your behalf, and why. Both of these hide real
 * postings, so neither is allowed to happen silently -- a gate the model
 * called wrong is only fixable if you can see it fired. */
function renderFilterNotices(state) {
  const parts = [];

  if (state.alreadyTracked > 0) {
    parts.push(
      `${state.alreadyTracked} ${state.alreadyTracked === 1 ? "role is" : "roles are"} already on your <a href="pipeline.html">Pipeline</a> and hidden here.`
    );
  }

  if (state.gateFiltered?.length) {
    const items = state.gateFiltered
      .map((g) => `<li>${escapeHtml(g.company)} — ${escapeHtml(g.title)}${g.reason ? `: ${escapeHtml(g.reason)}` : ""}</li>`)
      .join("");
    parts.push(
      `${state.gateFiltered.length} ${state.gateFiltered.length === 1 ? "role was" : "roles were"} dropped against your languages or deal-breakers.
       <details style="margin-top:6px;"><summary>Show them</summary><ul style="margin:6px 0 0;">${items}</ul></details>`
    );
  }

  if (!parts.length) return "";
  return `<div class="card" style="padding:12px 16px;"><p class="muted" style="margin:0;">${parts.join("<br>")}</p></div>`;
}

function renderSearchResults(state) {
  const { cvId, savedKeys } = state;
  const analysisText = state.text || "";
  const savedKeyOf = (j) => j.url || `${j.title}|${j.company}`;

  // Coords arrive as their own event, keyed by location -- apply them at
  // render time so ranked/geo events can land in either order. Jobs from
  // the final `complete` event already carry lat/lng baked in.
  const jobs = (state.jobs || []).map((j) => {
    const coords = state.coords?.[normalizeLocation(j.location)];
    return coords ? { ...j, lat: j.lat ?? coords.lat, lng: j.lng ?? coords.lng } : j;
  });

  searchResultEl.innerHTML = `
    <div class="card">
      <h2>Results</h2>
      ${
        state.ranked
          ? `<div class="doc-content">${escapeHtml(analysisText)}</div>`
          : `<p class="muted" style="display:flex; align-items:center; gap:8px;"><span class="skeleton-pulse"></span> Matching these roles against your CV — scores and ordering will appear here.</p>`
      }
    </div>
    ${state.rankingError ? `<div class="error-banner" style="background:var(--warn-soft); color:var(--warn);">Ranking failed this time (${escapeHtml(state.rankingError)}); showing unranked results.</div>` : ""}
    ${renderFilterNotices(state)}
    ${
      jobs.length
        ? `<div class="job-grid">${jobs
            .map(
              (j, i) => `
          <div class="card job-card stagger-item" style="--index:${i};">
            <div class="row between">
              <div>
                <h2 class="card-title">${escapeHtml(j.title)}</h2>
                <p class="muted" style="margin:0; display:flex; align-items:center; gap:6px;"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(String(j.company || "").toLowerCase().replace(/[^a-z0-9]/g, ""))}.com&sz=32" width="16" height="16" alt="" onerror="this.style.display='none'" />${escapeHtml(j.company)}</p>
              </div>
              ${matchPct(j.matchScore) != null ? `<span class="match-badge ${matchPct(j.matchScore) >= 80 ? "high" : matchPct(j.matchScore) >= 50 ? "mid" : "low"}">${matchPct(j.matchScore)}% MATCH</span>` : ""}
              ${j.source && SOURCE_LABELS[j.source] ? `<span class="pill muted" title="Found via ${escapeHtml(SOURCE_LABELS[j.source])}">${escapeHtml(SOURCE_LABELS[j.source].split(" (")[0])}</span>` : ""}
            </div>
            <p class="muted" style="margin:10px 0;">${icon("mapPin")} ${escapeHtml(j.location || "")} ${j.compEstimate ? `&nbsp;${icon("dollar")} ${escapeHtml(j.compEstimate)}` : ""}</p>
            ${j.fitNote ? `<p style="font-size:13.5px;">${escapeHtml(j.fitNote)}</p>` : ""}
            ${renderScoreBreakdown(j)}
            ${
              j.languageGate === "FLAG" || j.dealBreakerGate === "FLAG"
                ? `<p class="pill warn" style="font-size:12px; display:inline-block;">Worth a look: ${escapeHtml(j.gateNote || "may stretch one of your stated limits")}</p>`
                : ""
            }
            <div class="row" style="margin-top:12px;">
              <button class="btn" data-idx="${i}" style="flex:1;" ${savedKeys.has(savedKeyOf(j)) ? "disabled" : ""}>${savedKeys.has(savedKeyOf(j)) ? "Saved to Pipeline" : "Save"}</button>
              ${safeUrl(j.url) ? `<a class="icon-btn" href="${escapeHtml(safeUrl(j.url))}" target="_blank" rel="noopener" title="View posting">${icon("chevronRight")}</a>` : ""}
            </div>
          </div>`
            )
            .join("")}</div>`
        : ""
    }
    <div id="jobMap"></div>
  `;

  renderJobMap(jobs);

  searchResultEl.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.onclick = async () => {
      const j = jobs[Number(btn.dataset.idx)];
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        // Fetch the actual posting text where possible so a later manual
        // "Tailor CV" click has real content to work from -- this is a
        // fast plain fetch, not an AI call, so it doesn't reintroduce the
        // context-switch problem the auto-tailor-and-redirect flow had.
        let jobPostText = "";
        if (safeUrl(j.url)) {
          jobPostText = await fetchJobPostFromUrl(j.url).catch(() => "");
        }
        if (!jobPostText) {
          jobPostText = [j.title, j.company, j.location, j.fitNote].filter(Boolean).join("\n");
        }

        await api("/applications", {
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

        // Remember across re-renders: ranked/geo events redraw the grid,
        // and a Save that silently reverted to a live button would invite
        // duplicate applications.
        savedKeys.add(savedKeyOf(j));
        // The board isn't on this page any more -- say where it went
        // instead of scrolling to a kanban card that doesn't exist here.
        btn.textContent = "Saved to Pipeline";
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Save";
        showError(document.querySelector("main"), err);
      }
    };
  });
}

loadSearchCvs().then((hasCvs) => hasCvs && loadSearchProfile());
