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
    ["index.html", "Tracker"],
    ["cv-store.html", "CV Store"],
    ["tailor.html", "Tailor"],
    ["job-search.html", "Job Search"],
  ];
  const el = document.getElementById("topnav");
  if (!el) return;
  el.innerHTML = `
    <header class="topbar">
      <div class="brand">Resume Copilot</div>
      <nav class="tabs">
        ${links.map(([href, label]) => `<a href="${href}" class="${active === href ? "active" : ""}">${label}</a>`).join("")}
      </nav>
      <span class="muted" id="whoami" style="font-size: 0.85em; margin: 0 10px;"></span>
      <button class="btn secondary small" id="logoutBtn">Log out</button>
    </header>`;

  // /cdn-cgi/access/logout is a path Cloudflare Access reserves on every
  // hostname it protects -- it's intercepted at the edge (this Worker never
  // sees the request), clears the Access session, and shows Cloudflare's own
  // signed-out page. There's no app-level session to clear here.
  document.getElementById("logoutBtn").onclick = () => {
    location.href = "/cdn-cgi/access/logout";
  };

  fetch("/api/auth/me")
    .then((r) => r.json())
    .then(({ email }) => {
      if (email) document.getElementById("whoami").textContent = email;
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
  } catch {}
}
