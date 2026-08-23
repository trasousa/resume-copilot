import { icon } from "./icons.js";

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {
      // A 401 with a non-JSON body almost always means Cloudflare Access's
      // own re-auth page came back instead of this API (its session cookie
      // expired mid-use). A full reload re-triggers the Access redirect;
      // there's nothing this app itself can do about that.
      if (res.status === 401) message = "Your session expired. Reload the page to sign in again.";
    }
    // The daily cap message from src/lib/llm.js already explains the reset
    // time; point at the nav indicator too so the user knows where to check
    // remaining budget before retrying.
    if (res.status === 429) message += " See the AI budget indicator in the nav for today's usage.";
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Fetch a job posting URL server-side and return its extracted text. */
export async function fetchJobPostFromUrl(url) {
  const { text } = await api("/jobpost/fetch", { method: "POST", body: { url } });
  return text;
}

/**
 * Wires a "Fetch" button that pulls a job-post link's text into a target
 * textarea. Shared by the New Application dialog and the Tailor page so
 * both get the same behavior without duplicating the fetch/error/spinner
 * dance.
 */
export function wireJobPostFetch({ linkInput, fetchBtn, jobPostTextarea, statusEl }) {
  fetchBtn.onclick = async () => {
    const url = linkInput.value.trim();
    if (!url) return alert("Paste a job posting link first.");
    fetchBtn.disabled = true;
    statusEl.innerHTML = `<span class="spinner"></span> fetching…`;
    try {
      jobPostTextarea.value = await fetchJobPostFromUrl(url);
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = "";
      showError(jobPostTextarea.closest("main") || document.body, err);
    } finally {
      fetchBtn.disabled = false;
    }
  };
}

/**
 * Onboarding gate: fetches the CV list and, if it's empty, replaces
 * `container`'s content with an empty state pointing at CV Store instead of
 * a form that has nothing to act on. Returns the CV list on success, or
 * `null` after rendering the empty state so callers can bail out early.
 */
export async function ensureCvsOrEmptyState(container, message) {
  const cvs = await api("/cvs");
  if (cvs.length) return cvs;
  container.innerHTML = `
    <div class="card empty-state">
      <h2>Add your first CV to get started</h2>
      <p class="muted">${escapeHtml(
        message ||
          "Upload a CV or paste its text in the CV Store. From there you can improve it and start tailoring it to job postings."
      )}</p>
      <a class="btn" href="cv-store.html">Go to CV Store</a>
    </div>`;
  return null;
}

/**
 * Runs a one-shot (non-streamed) AI call with elapsed-time-aware status text
 * and a disabled/relabeled trigger button. runTask() (src/lib/llm.js) has no
 * streaming hook to hang progress off of -- this is the substitute: an
 * immediate staged message, swapped out for later ones (typically a "still
 * working" message) as the call runs long. `stages` is a list of
 * [delayMs, text] pairs; the delay-0 entry shows immediately.
 */
export async function runStagedTask(fn, { statusEl, stages = [], button, busyLabel } = {}) {
  const prevLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
  }
  const timers = [];
  if (statusEl) {
    for (const [delay, text] of stages) {
      if (delay === 0) statusEl.textContent = text;
      else timers.push(setTimeout(() => { statusEl.textContent = text; }, delay));
    }
  }
  try {
    return await fn();
  } finally {
    timers.forEach((t) => window.clearTimeout(t));
    if (statusEl) statusEl.textContent = "";
    if (button) {
      button.disabled = false;
      if (busyLabel) button.textContent = prevLabel;
    }
  }
}

/**
 * A few pulsing placeholder bars shaped like the card about to arrive --
 * the same `.skeleton-pulse` vocabulary the search pane's per-source rows
 * use, just stacked instead of following inline text.
 */
export function skeletonBars(n = 3) {
  return Array.from(
    { length: n },
    (_, i) => `<p class="muted"><span class="skeleton-pulse" style="width:${180 - i * 20}px;"></span></p>`
  ).join("");
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * Escaping alone doesn't make a URL safe to put in href -- it leaves
 * `javascript:` intact. Job URLs come from model output derived from live web
 * pages, so the scheme has to be checked, not just the characters.
 */
export function safeUrl(url) {
  try {
    const u = new URL(String(url), location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Match scores originate from LLM output (ranked job JSON, stored
 * match_score rows) and are interpolated into innerHTML unescaped as badge
 * numbers -- SQLite doesn't enforce the column's INTEGER affinity, so
 * nothing upstream guarantees a number. Coerce to a clamped integer or
 * null at every render site instead of trusting the source.
 */
export function matchPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

export function renderNav(active) {
  const links = [
    ["tailor.html", "Tailor", "edit"],
    ["index.html", "Applications", "list"],
  ];
  const el = document.getElementById("topnav");
  if (!el) return;
  el.innerHTML = `
    <header class="topbar">
      <a href="index.html" class="brand"><span class="brand-mark">R</span> Resume Copilot</a>
      <nav class="tabs">
        ${links
          .map(
            ([href, label, iconName]) =>
              `<a href="${href}" class="${active === href ? "active" : ""}">${icon(iconName)}${label}</a>`
          )
          .join("")}
      </nav>
      <div class="row" style="gap: 10px; position: relative;">
        <span class="muted" id="aiBudgetIndicator"></span>
        <a class="btn" href="index.html?new=1" id="topnavNewApp">${icon("plus")} New Application</a>
        <button class="avatar-circle" id="avatarMenuBtn" title="Profile & Settings" style="border:none; cursor:pointer;">?</button>
        <div class="avatar-menu" id="avatarMenu" style="display:none;">
          <a href="profile.html">${icon("user")} Profile &amp; Settings</a>
          <button type="button" id="navLogoutBtn">Log out</button>
        </div>
      </div>
    </header>`;

  const menuBtn = document.getElementById("avatarMenuBtn");
  const menu = document.getElementById("avatarMenu");
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "flex" : "none";
  };
  document.addEventListener("click", () => { menu.style.display = "none"; });

  document.getElementById("navLogoutBtn").onclick = () => {
    location.href = "/cdn-cgi/access/logout";
  };

  fetch("/api/auth/me")
    .then((r) => r.json())
    .then(({ email }) => {
      if (email) {
        menuBtn.textContent = email[0].toUpperCase();
        menuBtn.title = email;
      }
    })
    .catch(() => {});

  // Once per page load, non-critical -- a failed fetch just leaves the
  // indicator blank instead of blocking or erroring the nav.
  fetch("/api/usage")
    .then((r) => r.json())
    .then(({ used, cap }) => {
      const pct = Math.round((used / cap) * 100);
      document.getElementById("aiBudgetIndicator").textContent = `AI budget: ${pct}% used today`;
    })
    .catch(() => {});
}

export function showError(container, err) {
  const el = document.createElement("div");
  el.className = "error-banner";
  el.textContent = err.message || String(err);
  container.prepend(el);
  setTimeout(() => el.remove(), 6000);
}

export function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export async function checkApiKey() {
  // Workers AI needs no API key (auth is the "ai" binding alone), so there
  // is nothing left for this check to warn about. Kept as a no-op export
  // rather than removed, since every page still imports and calls it --
  // removing it would mean touching all 7 page scripts for no behavior
  // change.
}
