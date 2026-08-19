import { api, escapeHtml, renderNav, showError } from "./app.js";
import { icon } from "./icons.js";
import { renderResumeView } from "./resume-view.js";

renderNav("profile.html");

const main = document.getElementById("profileMain");
let step = 1;

async function init() {
  const cvs = await api("/cvs").catch(() => []);
  if (cvs.length === 0) renderOnboarding();
  else renderSettled(cvs);
}

// --- Step 1/3: onboarding wizard (no CV yet) --------------------------------

function renderOnboarding() {
  main.innerHTML = `
    <div class="card" style="max-width: 640px; margin: 40px auto; padding: 0; overflow: hidden;">
      <div style="padding: 24px 28px 20px; border-bottom: 1px solid var(--border);">
        <div class="row between">
          <span class="pill">Step ${step} of 3</span>
          <div class="row" style="gap: 4px;">
            ${[1, 2, 3].map((n) => `<span style="width:32px;height:4px;border-radius:2px;background:${n <= step ? "var(--rc-primary)" : "var(--rc-outline-variant)"};"></span>`).join("")}
          </div>
        </div>
        <h1 id="stepTitle" style="margin-top: 14px;"></h1>
        <p class="subtitle" id="stepSubtitle" style="margin-bottom: 0;"></p>
      </div>
      <div style="padding: 28px;" id="stepBody"></div>
      <div class="row between" id="wizardFooter" style="padding: 16px 28px; border-top: 1px solid var(--border); background: var(--rc-surface-container-low);">
        <button class="btn secondary" id="backBtn" ${step === 1 ? "disabled" : ""}>Back</button>
        <button class="btn secondary" id="skipBtn">Skip for now</button>
      </div>
    </div>`;

  document.getElementById("backBtn").onclick = () => { step = Math.max(1, step - 1); renderOnboarding(); };
  document.getElementById("skipBtn").onclick = () => { step = 3; renderOnboarding(); };

  if (step === 1) renderStep1();
  else if (step === 2) renderStep2();
  else renderStep3();
}

async function parseAndPreview(cvId) {
  const status = document.getElementById("uploadStatus");
  if (status) status.innerHTML = `<span class="spinner"></span> reading your resume…`;
  document.getElementById("stepBody").innerHTML = `<p class="muted"><span class="spinner"></span> Parsing your resume…</p>`;
  let parsedJson = null;
  try {
    const result = await api(`/cvs/${cvId}/parse`, { method: "POST" });
    parsedJson = result.parsedJson;
  } catch {
    // Parsing is a nice-to-have preview, not a hard requirement -- fall
    // through to manual continue below even if it failed.
  }

  document.getElementById("stepBody").innerHTML = `<div id="resumePreview"></div>`;
  let renderFailed = false;
  if (parsedJson) {
    try {
      renderResumeView(document.getElementById("resumePreview"), parsedJson);
    } catch {
      // A malformed parsed-resume shape (e.g. non-string link/bullet) must
      // not strand the user mid-onboarding -- degrade to the same fallback
      // message used when there's no parsedJson at all.
      renderFailed = true;
    }
  }
  if (!parsedJson || renderFailed) {
    document.getElementById("resumePreview").innerHTML =
      `<p class="muted">We saved your resume, but couldn't generate a structured preview. You can still continue.</p>`;
  }

  const footer = document.getElementById("wizardFooter");
  const cont = document.createElement("button");
  cont.className = "btn";
  cont.textContent = "Looks good — continue";
  cont.onclick = () => { step = 2; renderOnboarding(); };
  footer.insertBefore(cont, document.getElementById("skipBtn"));
}

function renderStep1() {
  document.getElementById("stepTitle").textContent = "Welcome to Resume Copilot. Let's build your profile.";
  document.getElementById("stepSubtitle").textContent = "We'll use this information to tailor your resume and find the perfect match.";
  document.getElementById("stepBody").innerHTML = `
    <div class="dropzone">
      ${icon("upload")}
      <h2>Upload your existing resume</h2>
      <p class="muted">Drag and drop your PDF or DOCX file here, or click to browse.</p>
      <input type="file" id="resumeFile" accept=".pdf,.docx,.doc,.txt" style="display:none;" />
      <button class="btn" id="selectFileBtn">Select File</button>
      <span id="uploadStatus" class="muted"></span>
    </div>
    <div class="row" style="margin: 20px 0; color: var(--ink-soft);">
      <div style="flex:1; height:1px; background: var(--border);"></div>OR<div style="flex:1; height:1px; background: var(--border);"></div>
    </div>
    <button class="btn secondary" id="manualEntryBtn" style="width:100%; justify-content:center;">${icon("file")} Fill out details manually</button>
  `;

  const fileInput = document.getElementById("resumeFile");
  document.getElementById("selectFileBtn").onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const status = document.getElementById("uploadStatus");
    status.innerHTML = `<span class="spinner"></span> uploading…`;
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("isMaster", "true");
      const cv = await api("/cvs/upload", { method: "POST", body: form });
      await parseAndPreview(cv.id);
    } catch (err) {
      status.textContent = "";
      showError(main, err);
    }
  };

  document.getElementById("manualEntryBtn").onclick = async () => {
    const content = prompt("Paste your resume text (you can format/improve it later in CV Store):");
    if (!content?.trim()) return;
    try {
      const cv = await api("/cvs", { method: "POST", body: { label: "My resume", content, isMaster: true } });
      await parseAndPreview(cv.id);
    } catch (err) {
      showError(main, err);
    }
  };
}

function renderStep2() {
  document.getElementById("stepTitle").textContent = "What are you looking for?";
  document.getElementById("stepSubtitle").textContent = "This tunes Job Search results and doesn't have to be exact -- you can change it any time.";
  document.getElementById("stepBody").innerHTML = `
    <div class="grid cols-3">
      <div><label>City</label><input type="text" id="p-city" /></div>
      <div><label>Region/State</label><input type="text" id="p-region" /></div>
      <div><label>Country</label><input type="text" id="p-country" /></div>
    </div>
    <label><input type="checkbox" id="p-remote" style="width:auto; display:inline-block;" /> Include / prefer fully remote roles</label>
    <label>Minimum target compensation (optional)</label>
    <input type="text" id="p-minComp" placeholder="e.g. €80,000" />
  `;
  const footer = document.getElementById("wizardFooter");
  const cont = document.createElement("button");
  cont.className = "btn";
  cont.textContent = "Continue";
  cont.dataset.stepContinue = "";
  cont.onclick = async () => {
    await api("/profile", {
      method: "PUT",
      body: {
        city: document.getElementById("p-city").value.trim(),
        region: document.getElementById("p-region").value.trim(),
        country: document.getElementById("p-country").value.trim(),
        remote: document.getElementById("p-remote").checked,
        minComp: document.getElementById("p-minComp").value.trim(),
        notes: "",
      },
    }).catch((err) => showError(main, err));
    step = 3;
    renderOnboarding();
  };
  footer.insertBefore(cont, document.getElementById("skipBtn"));
}

function renderStep3() {
  document.getElementById("stepTitle").textContent = "You're all set.";
  document.getElementById("stepSubtitle").textContent = "Head to Applications to search for roles and track them.";
  document.getElementById("stepBody").innerHTML = `
    <div class="row" style="justify-content:center; gap: 12px; padding: 20px 0;">
      <a class="btn" href="index.html">${icon("list")} Go to Applications</a>
    </div>`;
  document.getElementById("skipBtn").style.display = "none";
  document.getElementById("backBtn").style.display = "none";
}

// --- Settled profile / settings view (has at least one CV) -----------------

async function renderSettled(cvs) {
  const profile = await api("/profile").catch(() => ({}));
  const master = cvs.find((cv) => cv.isMaster) || cvs[0];

  main.innerHTML = `
    <div class="row between"><div><h1>Profile</h1><p class="subtitle">Your job-search preferences and master resume.</p></div></div>
    <div class="grid cols-2">
      <div class="card">
        <h2>Master resume</h2>
        <p class="muted">${escapeHtml(master.label)} ${master.isMaster ? "(master)" : ""}</p>
        <a class="btn secondary small" href="cv-store.html">Manage in CV Store</a>
      </div>
      <div class="card">
        <h2>Job search preferences</h2>
        <label>City</label><input type="text" id="s-city" value="${escapeHtml(profile.city || "")}" />
        <label>Region/State</label><input type="text" id="s-region" value="${escapeHtml(profile.region || "")}" />
        <label>Country</label><input type="text" id="s-country" value="${escapeHtml(profile.country || "")}" />
        <label><input type="checkbox" id="s-remote" style="width:auto; display:inline-block;" ${profile.remote ? "checked" : ""} /> Prefer remote roles</label>
        <label>Minimum target compensation</label><input type="text" id="s-minComp" value="${escapeHtml(profile.minComp || "")}" />
        <div class="row" style="margin-top: 12px;"><button class="btn" id="saveProfileBtn">Save</button><span id="saveStatus" class="muted"></span></div>
      </div>
    </div>
    <div class="card" style="border-color: var(--danger);">
      <h2 style="color: var(--danger);">Danger zone</h2>
      <p class="muted">This deletes ALL data in this instance — every resume, application, generated document, and preference, for everyone with access. It cannot be undone.</p>
      <label>Type DELETE to confirm</label>
      <input type="text" id="deleteConfirmInput" placeholder="DELETE" />
      <button class="btn danger" id="deleteAccountBtn" style="margin-top:12px;" disabled>Delete my account</button>
    </div>
  `;

  document.getElementById("saveProfileBtn").onclick = async () => {
    const status = document.getElementById("saveStatus");
    status.textContent = "saving…";
    try {
      await api("/profile", {
        method: "PUT",
        body: {
          city: document.getElementById("s-city").value.trim(),
          region: document.getElementById("s-region").value.trim(),
          country: document.getElementById("s-country").value.trim(),
          remote: document.getElementById("s-remote").checked,
          minComp: document.getElementById("s-minComp").value.trim(),
          notes: profile.notes || "",
        },
      });
      status.textContent = "saved";
      setTimeout(() => (status.textContent = ""), 1500);
    } catch (err) {
      status.textContent = "";
      showError(main, err);
    }
  };

  const deleteInput = document.getElementById("deleteConfirmInput");
  const deleteBtn = document.getElementById("deleteAccountBtn");
  deleteInput.oninput = () => { deleteBtn.disabled = deleteInput.value !== "DELETE"; };
  deleteBtn.onclick = async () => {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting…";
    try {
      await api("/account", { method: "DELETE", body: { confirm: "DELETE" } });
      location.href = "/cdn-cgi/access/logout";
    } catch (err) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete my account";
      showError(main, err);
    }
  };
}

init();
