import { api, escapeHtml, renderNav, showError, ensureCvsOrEmptyState } from "./app.js";
import { icon } from "./icons.js";

renderNav("tailor.html"); // Outreach Studio is reached from the Tailor tab; keep that tab highlighted.
document.getElementById("saveTemplateBtn").innerHTML = icon("folder");

const main = document.querySelector("main");
let kind = "coverLetter";
let tone = "professional";
let draftContent = "";

document.querySelectorAll("#kindTabs .chip").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#kindTabs .chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    kind = btn.dataset.kind;
    loadTemplates();
  };
});

document.querySelectorAll("#toneGrid .chip").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#toneGrid .chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tone = btn.dataset.tone;
  };
});

async function loadCvs() {
  const cvs = await ensureCvsOrEmptyState(main, "Outreach drafting needs a CV to work from — add one first.");
  if (!cvs) return;
  document.getElementById("cvSelect").innerHTML = cvs
    .map((cv) => `<option value="${cv.id}" ${cv.isMaster ? "selected" : ""}>${escapeHtml(cv.label)}${cv.isMaster ? " (master)" : ""}</option>`)
    .join("");
}

document.getElementById("generateBtn").onclick = async () => {
  const targetRoleCompany = document.getElementById("targetRoleCompany").value.trim();
  if (!targetRoleCompany) return alert("Enter a target role / company first.");
  const status = document.getElementById("genStatus");
  status.innerHTML = `<span class="spinner"></span> drafting…`;
  try {
    const { content } = await api("/outreach/generate", {
      method: "POST",
      body: { type: kind, targetRoleCompany, tone, cvId: document.getElementById("cvSelect").value },
    });
    draftContent = content;
    document.getElementById("editorTitle").textContent = `${targetRoleCompany} – ${kind === "coverLetter" ? "Cover Letter" : "Cold Email"}`;
    document.getElementById("editorBody").innerText = content;
    document.getElementById("savedIndicator").textContent = "";
  } catch (err) {
    showError(main, err);
  } finally {
    status.textContent = "";
  }
};

document.getElementById("copyBtn").onclick = () => {
  navigator.clipboard.writeText(document.getElementById("editorBody").innerText);
  const btn = document.getElementById("copyBtn");
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = "Copy to Clipboard"), 1200);
};

document.getElementById("exportPdfBtn").onclick = () => {
  // No PDF library in this project's dependencies -- the browser's own
  // print-to-PDF (triggered via window.print(), scoped to #editorPane by the
  // @media print rule in styles.css) is a zero-dependency way to get there.
  window.print();
};

document.getElementById("saveTemplateBtn").onclick = async () => {
  const content = document.getElementById("editorBody").innerText.trim();
  if (!content) return alert("Generate or write a draft first.");
  const label = prompt("Name this template:", document.getElementById("targetRoleCompany").value || "Untitled template");
  if (!label) return;
  await api("/templates", {
    method: "POST",
    body: { kind, label, tone, targetRoleCompany: document.getElementById("targetRoleCompany").value.trim(), content },
  }).catch((err) => showError(main, err));
  loadTemplates();
};

async function loadTemplates() {
  const templates = await api("/templates").catch(() => []);
  const list = document.getElementById("templatesList");
  const filtered = templates.filter((t) => t.kind === kind);
  if (!filtered.length) { list.innerHTML = `<p class="muted">No saved templates yet.</p>`; return; }
  list.innerHTML = filtered
    .map(
      (t) => `
    <div class="template-row" data-id="${t.id}">
      <div>
        <div style="font-weight:600; font-size:13.5px;">${escapeHtml(t.label)}</div>
        <div class="muted" style="font-size:11.5px;">Last used ${new Date(t.lastUsedAt).toLocaleDateString()}</div>
      </div>
      ${icon("chevronRight")}
    </div>`
    )
    .join("");
  list.querySelectorAll(".template-row").forEach((row) => {
    row.onclick = async () => {
      const t = filtered.find((x) => x.id === row.dataset.id);
      document.getElementById("editorTitle").textContent = t.label;
      document.getElementById("editorBody").innerText = t.content;
      document.getElementById("targetRoleCompany").value = t.targetRoleCompany;
      await api(`/templates/${t.id}/use`, { method: "POST" }).catch(() => {});
      loadTemplates();
    };
  });
}

loadCvs();
loadTemplates();
