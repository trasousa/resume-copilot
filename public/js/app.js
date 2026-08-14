export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
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
    </header>`;
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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export async function checkApiKey() {
  try {
    const health = await api("/health");
    if (!health.hasApiKey) {
      const banner = document.createElement("div");
      banner.className = "error-banner";
      banner.innerHTML = "No <code>ANTHROPIC_API_KEY</code> found on the server. Copy <code>.env.example</code> to <code>.env</code>, add your key, and restart the server for AI features to work.";
      document.querySelector("main")?.prepend(banner);
    }
  } catch {}
}
