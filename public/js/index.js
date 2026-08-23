import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey, wireJobPostFetch, safeUrl, fetchJobPostFromUrl } from "./app.js";
import { renderActivityGraph } from "./activity-graph.js";
import { icon } from "./icons.js";

renderNav("index.html");
checkApiKey();

wireJobPostFetch({
  linkInput: document.getElementById("f-link"),
  fetchBtn: document.getElementById("f-fetch"),
  jobPostTextarea: document.getElementById("f-jobpost"),
  statusEl: document.getElementById("f-fetch-status"),
});

const cvSelect = document.getElementById("cvSelect");
const searchResultEl = document.getElementById("result");
const searchStatusEl = document.getElementById("status");
const searchProgressEl = document.getElementById("searchProgress");
const searchPaneBody = document.getElementById("searchPaneBody");

const SOURCE_LABELS = { arbeitnow: "Arbeitnow", himalayas: "Himalayas", jsearch: "LinkedIn/Indeed/Glassdoor" };

const chipEls = document.querySelectorAll("#jobTypeChips .chip");
chipEls.forEach((chip) => {
  chip.onclick = () => chip.classList.toggle("active");
});
function selectedJobTypes() {
  return [...chipEls].filter((c) => c.classList.contains("active")).map((c) => c.dataset.type);
}

/** Populates the CV select. Unlike the old standalone Job Search page,
 * this must NOT call ensureCvsOrEmptyState(main, ...) -- that would wipe
 * the whole page (masthead, ledger, kanban board), not just this panel.
 * Scoped instead to #searchPaneBody alone. */
async function loadSearchCvs() {
  const cvs = await api("/cvs").catch(() => []);
  if (!cvs.length) {
    searchPaneBody.innerHTML = `<p class="muted">Job search needs a CV to match against — add one from <a href="cv-store.html">CV Store</a> first.</p>`;
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

  searchStatusEl.textContent = "Contacting three job sources…";
  searchProgressEl.innerHTML = "";
  searchResultEl.innerHTML = "";

  // One mutable state object per search; every stream event updates it and
  // re-renders, so real results appear the moment sources answer instead of
  // waiting out ranking (slow LLM call) and geocoding (~1s per new city).
  const state = { jobs: [], total: 0, text: "", rankingError: null, ranked: false, coords: null, savedKeys: new Set(), cvId };

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
          renderSearchResults(state);
        } else if (event === "ranked") {
          state.ranked = true;
          if (data.rankingError) state.rankingError = data.rankingError;
          else {
            state.jobs = data.jobs || state.jobs;
            state.text = data.text || "";
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
              ${j.matchScore != null ? `<span class="match-badge ${j.matchScore >= 80 ? "high" : j.matchScore >= 50 ? "mid" : "low"}">${j.matchScore}% MATCH</span>` : ""}
              ${j.source === "arbeitnow" ? `<span class="pill muted" title="Found via Arbeitnow's job board API">Arbeitnow</span>` : ""}
            </div>
            <p class="muted" style="margin:10px 0;">${icon("mapPin")} ${escapeHtml(j.location || "")} ${j.compEstimate ? `&nbsp;${icon("dollar")} ${escapeHtml(j.compEstimate)}` : ""}</p>
            ${j.fitNote ? `<p style="font-size:13.5px;">${escapeHtml(j.fitNote)}</p>` : ""}
            <div class="row" style="margin-top:12px;">
              <button class="btn" data-idx="${i}" style="flex:1;" ${savedKeys.has(savedKeyOf(j)) ? "disabled" : ""}>${savedKeys.has(savedKeyOf(j)) ? "Saved" : "Save"}</button>
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

        // Remember across re-renders: ranked/geo events redraw the grid,
        // and a Save that silently reverted to a live button would invite
        // duplicate applications.
        savedKeys.add(savedKeyOf(j));
        btn.textContent = "Saved";
        await load();
        const newCard = document.querySelector(`.app-card[data-id="${app.id}"]`);
        if (newCard) {
          newCard.classList.add("just-saved");
          setTimeout(() => newCard.classList.remove("just-saved"), 1500);
          newCard.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Save";
        showError(document.querySelector("main"), err);
      }
    };
  });
}

const STAGES = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["interview", "Interview"],
  ["offer", "Offer"],
];

// Full stage order for the compare table's default sort, including the two
// terminal stages the kanban's STAGES above deliberately excludes (they
// render in a separate "Closed" column, not a kanban stage column).
const STAGE_ORDER = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];

let compareSortKey = "stage";
let compareSortDir = "asc";
let compareAppsData = [];

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

/** Best-effort first-number scrape from freeform compensation text (e.g.
 * "$120k-140k" -> 120, "competitive" -> null). Mirrors the same
 * regex-scrape spirit as parseMatchScore in src/routes/applications.js --
 * good enough for sorting, not meant to be exact. */
function parseCompValue(compEstimate) {
  const m = String(compEstimate || "").match(/[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function renderComparePanel(apps) {
  compareAppsData = apps;
  const tbody = document.getElementById("compareTableBody");
  if (!tbody) return;

  const dir = compareSortDir === "asc" ? 1 : -1;
  const rows = [...apps].sort((a, b) => {
    if (compareSortKey === "match" || compareSortKey === "comp") {
      const av = compareSortKey === "match" ? a.matchScore : parseCompValue(a.compEstimate);
      const bv = compareSortKey === "match" ? b.matchScore : parseCompValue(b.compEstimate);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls sort last regardless of direction
      if (bv == null) return -1;
      return (av - bv) * dir;
    }
    if (compareSortKey === "stage") {
      return (STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)) * dir;
    }
    if (compareSortKey === "location") {
      return String(a.location || "").localeCompare(String(b.location || "")) * dir;
    }
    return (
      (String(a.company || "").localeCompare(String(b.company || "")) ||
        String(a.role || "").localeCompare(String(b.role || ""))) * dir
    );
  });

  tbody.innerHTML = rows
    .map(
      (a) => `
    <tr data-id="${a.id}">
      <td>${escapeHtml(a.company)} — ${escapeHtml(a.role)}</td>
      <td><span class="status-chip ${a.stage}">${a.stage}</span></td>
      <td>${a.matchScore != null ? a.matchScore + "%" : "—"}</td>
      <td>${a.compEstimate ? escapeHtml(a.compEstimate) : "—"}</td>
      <td>${escapeHtml(a.location || "—")}</td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => (window.location.href = `application.html?id=${tr.dataset.id}`);
  });

  document.querySelectorAll("#compareTable th[data-sort]").forEach((th) => {
    if (th.dataset.sort === compareSortKey) {
      th.setAttribute("aria-sort", compareSortDir === "asc" ? "ascending" : "descending");
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

document.querySelectorAll("#compareTable th[data-sort]").forEach((th) => {
  th.onclick = () => {
    const key = th.dataset.sort;
    compareSortDir = compareSortKey === key ? (compareSortDir === "asc" ? "desc" : "asc") : "asc";
    compareSortKey = key;
    renderComparePanel(compareAppsData);
  };
});

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
  renderComparePanel(apps);

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

loadSearchCvs().then((hasCvs) => hasCvs && loadSearchProfile());
api("/applications/activity-heatmap")
  .then((data) => renderActivityGraph(document.getElementById("activityGraph"), data))
  .catch(() => {}); // Non-critical widget -- a failed fetch just leaves it empty, doesn't block the rest of the page.
load();
