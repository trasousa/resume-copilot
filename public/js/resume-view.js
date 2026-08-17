// public/js/resume-view.js
//
// Renders the structured JSON shape produced by POST /api/cvs/:id/parse
// (see src/routes/cvs.js) as a read-only resume preview -- used right after
// upload/manual entry in onboarding so the user can confirm what was
// captured before moving on.

import { escapeHtml, safeUrl } from "./app.js";

export function renderResumeView(container, parsed) {
  if (!parsed) {
    container.innerHTML = `<p class="muted">Nothing parsed yet.</p>`;
    return;
  }

  const links = (parsed.links || [])
    .map((raw) => {
      const l = String(raw);
      const url = safeUrl(l.startsWith("http") ? l : `https://${l}`);
      return url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(l)}</a>`
        : escapeHtml(l);
    })
    .join(" · ");

  const experience = (parsed.experience || [])
    .map(
      (job) => `
      <div style="margin-bottom:14px;">
        <div class="row between">
          <strong>${escapeHtml(job.role || "")}</strong>
          <span class="muted">${escapeHtml(job.dates || "")}</span>
        </div>
        <div class="muted">${escapeHtml(job.company || "")}</div>
        ${
          job.bullets?.length
            ? `<ul style="margin:6px 0 0 20px;">${job.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
            : ""
        }
      </div>`
    )
    .join("");

  const education = (parsed.education || [])
    .map(
      (ed) => `
      <div class="row between" style="margin-bottom:6px;">
        <span>${escapeHtml(ed.degree || "")} ${ed.school ? "&mdash; " + escapeHtml(ed.school) : ""}</span>
        <span class="muted">${escapeHtml(ed.dates || "")}</span>
      </div>`
    )
    .join("");

  const skills = (parsed.skills || [])
    .map((s) => `<span class="pill muted">${escapeHtml(s)}</span>`)
    .join(" ");

  container.innerHTML = `
    <div class="resume-view">
      <h2 style="margin-bottom:2px;">${escapeHtml(parsed.name || "")}</h2>
      ${parsed.title ? `<p style="color:var(--advocate-primary); font-weight:600; margin:0 0 6px;">${escapeHtml(parsed.title)}</p>` : ""}
      <p class="muted" style="margin:0 0 14px;">
        ${[parsed.location, parsed.email, parsed.phone].filter(Boolean).map(escapeHtml).join(" · ")}
        ${links ? " · " + links : ""}
      </p>
      ${parsed.summary ? `<p style="margin-bottom:16px;">${escapeHtml(parsed.summary)}</p>` : ""}
      ${experience ? `<h3 class="muted" style="text-transform:uppercase; font-size:12px; letter-spacing:0.04em;">Experience</h3>${experience}` : ""}
      ${education ? `<h3 class="muted" style="text-transform:uppercase; font-size:12px; letter-spacing:0.04em;">Education</h3>${education}` : ""}
      ${skills ? `<h3 class="muted" style="text-transform:uppercase; font-size:12px; letter-spacing:0.04em;">Skills</h3><div class="tag-list">${skills}</div>` : ""}
    </div>`;
}
