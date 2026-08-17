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

export function renderNav(active) {
  const links = [
    ["job-search.html", "Search", "search"],
    ["tailor.html", "Tailor", "edit"],
    ["index.html", "Applications", "list"],
    ["profile.html", "Profile", "user"],
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
      <div class="row" style="gap: 10px;">
        <a class="btn" href="index.html?new=1" id="topnavNewApp">${icon("plus")} New Application</a>
        <button class="icon-btn" title="Notifications" disabled>${icon("bell")}</button>
        <a class="icon-btn" href="profile.html" title="Settings">${icon("gear")}</a>
        <span class="avatar-circle" id="whoamiAvatar">?</span>
      </div>
    </header>`;

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    location.href = "/cdn-cgi/access/logout";
  });

  fetch("/api/auth/me")
    .then((r) => r.json())
    .then(({ email }) => {
      const avatar = document.getElementById("whoamiAvatar");
      if (email && avatar) avatar.textContent = email[0].toUpperCase();
      if (email && avatar) avatar.title = email;
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
  try {
    const health = await api("/health");
    if (!health.hasApiKey) {
      const keyName = health.apiKeyName || "ANTHROPIC_API_KEY";
      const banner = document.createElement("div");
      banner.className = "error-banner";
      banner.innerHTML =
        `No <code>${keyName}</code> set on the Worker. Run ` +
        `<code>npx wrangler secret put ${keyName}</code> ` +
        "(or add it to <code>.dev.vars</code> locally) for AI features to work.";
      document.querySelector("main")?.prepend(banner);
    }
  } catch {
    // Best-effort banner -- a failed health check shouldn't block the page.
  }
}
