export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });

  // Session expired or never established -- bounce to login rather than
  // showing a confusing error on every widget.
  if (res.status === 401 && !location.pathname.endsWith("login.html")) {
    location.href = `login.html?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Not authenticated");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {}
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
      <button class="btn secondary small" id="logoutBtn">Log out</button>
    </header>`;

  document.getElementById("logoutBtn").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "login.html";
  };
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
      const banner = document.createElement("div");
      banner.className = "error-banner";
      banner.innerHTML =
        "No <code>ANTHROPIC_API_KEY</code> set on the Worker. Run " +
        "<code>npx wrangler secret put ANTHROPIC_API_KEY</code> " +
        "(or add it to <code>.dev.vars</code> locally) for AI features to work.";
      document.querySelector("main")?.prepend(banner);
    }
  } catch {}
}
