// Studio -- the single workspace for CV work. What used to be two pages
// (CV Store's library + improve chat, Tailor's job-post form + result) is one
// structure: a library rail on the left picks the CV under the lamp, and the
// bench on the right works on that one CV in either mode. The base-CV <select>
// the Tailor page carried is gone -- the rail selection IS the base CV, so the
// two halves can no longer disagree about which CV you're working on.

import {
  api,
  escapeHtml,
  renderNav,
  showError,
  timeAgo,
  checkApiKey,
  wireJobPostFetch,
  runStagedTask,
  skeletonBars,
} from "./app.js";
import { mountCvDocument } from "./cv-doc.js";
import { renderMarkdown } from "./markdown.js";

renderNav("studio.html");
checkApiKey();

const main = document.querySelector("main");
const cvRail = document.getElementById("cvRail");
const onboardingBanner = document.getElementById("onboardingBanner");
const statementEl = document.getElementById("studioStatement");
const benchKicker = document.getElementById("benchKicker");
const intakePanel = document.getElementById("intakePanel");
const matchPill = document.getElementById("matchPill");

let cvs = [];
let activeCvId = null;
let doc = null; // the document bench's mounted CV document (with assistant rail)

// ?bench=tailor and ?cv=<id> let other pages (and old tailor.html bookmarks)
// land directly on the right bench with the right CV selected.
const params = new URLSearchParams(location.search);

// --- Library rail ----------------------------------------------------------

/** The workspace's computed sentence -- state of the library, not a title. */
function renderStatement() {
  if (!cvs.length) {
    statementEl.textContent = "Nothing in the library yet. Add a CV to start working.";
    return;
  }
  const master = cvs.find((cv) => cv.isMaster);
  const revisions = cvs.filter((cv) => cv.parentId).length;
  let text = `${cvs.length} CV${cvs.length === 1 ? "" : "s"} on file`;
  text += master ? `, mastered by "${master.label}".` : ", none marked as master.";
  if (revisions) text += ` ${revisions} came from a revision.`;
  statementEl.textContent = text;
}

function renderRail() {
  if (!cvs.length) {
    cvRail.innerHTML = `<p class="rail-note">No CVs yet — add one below.</p>`;
    return;
  }

  cvRail.innerHTML = cvs
    .map(
      (cv, i) => `
      <div class="cv-row stagger-item${cv.id === activeCvId ? " active" : ""}" data-cv="${escapeHtml(cv.id)}" style="--index:${i};">
        <div class="cv-row-title">${escapeHtml(cv.label)}</div>
        <div class="cv-row-meta">
          ${cv.isMaster ? "Master · " : ""}${cv.parentId ? "Revised · " : ""}${escapeHtml(timeAgo(cv.createdAt))}
        </div>
        <div class="cv-row-actions">
          ${cv.isMaster ? "" : `<button type="button" class="cv-row-action" data-master="${escapeHtml(cv.id)}">Set as master</button>`}
          <a class="cv-row-action" href="/api/cvs/${encodeURIComponent(cv.id)}/download">Download .docx</a>
          ${cv.hasOriginal ? `<a class="cv-row-action" href="/api/cvs/${encodeURIComponent(cv.id)}/original">Original</a>` : ""}
          <button type="button" class="cv-row-action danger" data-delete="${escapeHtml(cv.id)}">Delete</button>
        </div>
      </div>`
    )
    .join("");

  cvRail.querySelectorAll(".cv-row").forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest("[data-master], [data-delete], a")) return;
      selectCv(row.dataset.cv);
    };
  });

  cvRail.querySelectorAll("[data-master]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/cvs/${btn.dataset.master}/master`, { method: "PATCH" });
        await loadCvs({ keepSelection: true });
      } catch (err) {
        showError(main, err);
      }
    };
  });

  cvRail.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this CV version?")) return;
      try {
        await api(`/cvs/${btn.dataset.delete}`, { method: "DELETE" });
        if (btn.dataset.delete === activeCvId) activeCvId = null;
        await loadCvs({ keepSelection: true });
      } catch (err) {
        showError(main, err);
      }
    };
  });
}

async function loadCvs({ keepSelection = false } = {}) {
  try {
    cvs = await api("/cvs");
  } catch (err) {
    cvs = [];
    showError(main, err);
  }

  renderStatement();
  renderOnboarding();

  const stillThere = keepSelection && cvs.some((cv) => cv.id === activeCvId);
  if (!stillThere) {
    const wanted = params.get("cv");
    const initial = cvs.find((cv) => cv.id === wanted) || cvs.find((cv) => cv.isMaster) || cvs[0];
    if (initial) {
      await selectCv(initial.id);
      return;
    }
    activeCvId = null;
    doc = null;
    renderRail();
    renderEmptyBench();
    return;
  }

  renderRail();
}

function renderEmptyBench() {
  benchKicker.innerHTML = `No CV selected.`;
  document.getElementById("cvDocMount").innerHTML =
    `<p class="muted">Add a CV from the library rail — upload a file or paste its text — and it opens here for editing, improving, and tailoring.</p>`;
  document.getElementById("result").innerHTML = "";
  intakePanel.open = true;
}

/**
 * Puts a CV under the lamp: it becomes the document bench's content AND the
 * base CV every tailoring run works from.
 */
async function selectCv(cvId) {
  activeCvId = cvId;
  renderRail();

  const cv = cvs.find((c) => c.id === cvId);
  benchKicker.innerHTML = `Working on <strong>${escapeHtml(cv?.label || "CV")}</strong>`;

  const mount = document.getElementById("cvDocMount");
  mount.innerHTML = `<p class="muted">${skeletonBars()}</p>`;

  let full, history;
  try {
    [full, history] = await Promise.all([api(`/cvs/${cvId}`), api(`/cvs/${cvId}/chat`)]);
  } catch (err) {
    mount.innerHTML = `<p class="muted">Couldn't load this CV.</p>`;
    showError(main, err);
    return;
  }

  // A slower select that resolved after the user moved on must not overwrite
  // the bench with stale content.
  if (activeCvId !== cvId) return;

  doc = mountCvDocument(mount, {
    content: full.content,
    editable: true,
    onSave: async (text) => {
      const saved = await api(`/cvs/${activeCvId}/chat/accept`, { method: "POST", body: { content: text } });
      activeCvId = saved.id;
      benchKicker.innerHTML = `Working on <strong>${escapeHtml(saved.label)}</strong>`;
      await loadCvs({ keepSelection: true });
    },
    assistant: true,
    onAssistantSend: sendChat,
  });

  history.forEach((m) => doc.assistant.addNote(m.role, stripCvBlock(m.content)));
}

/**
 * Onboarding step 2: after the first CV exists, ask once for the job-search
 * context (region, remote, target comp) instead of leaving Job Search to ask
 * on every single search. `profile.updatedAt` is the "already asked" flag --
 * both Save and Skip set it, so this never nags twice.
 */
async function renderOnboarding() {
  if (!cvs.length) {
    onboardingBanner.innerHTML = "";
    return;
  }

  const profile = await api("/profile").catch(() => null);
  if (!profile || profile.updatedAt) {
    onboardingBanner.innerHTML = "";
    return;
  }

  onboardingBanner.innerHTML = `
    <div class="card">
      <h2>Where are you looking?</h2>
      <p class="muted">Save this once and Job Search will use it automatically — you can change it anytime from the Search page.</p>
      <div class="grid cols-3">
        <div><label>City</label><input type="text" id="obCity" /></div>
        <div><label>Region/State</label><input type="text" id="obRegion" /></div>
        <div><label>Country</label><input type="text" id="obCountry" /></div>
      </div>
      <label><input type="checkbox" id="obRemote" style="width:auto; display:inline-block;" /> Include / prefer fully remote roles</label>
      <label>Minimum target compensation (optional)</label>
      <input type="text" id="obMinComp" placeholder="e.g. €80,000" />
      <div class="row" style="margin-top:12px;">
        <button class="btn small" id="obSave">Save</button>
        <button class="btn secondary small" id="obSkip">Skip for now</button>
      </div>
    </div>`;

  document.getElementById("obSave").onclick = async () => {
    await api("/profile", {
      method: "PUT",
      body: {
        city: document.getElementById("obCity").value.trim(),
        region: document.getElementById("obRegion").value.trim(),
        country: document.getElementById("obCountry").value.trim(),
        remote: document.getElementById("obRemote").checked,
        minComp: document.getElementById("obMinComp").value.trim(),
      },
    });
    onboardingBanner.innerHTML = "";
  };
  document.getElementById("obSkip").onclick = async () => {
    await api("/profile", { method: "PUT", body: {} });
    onboardingBanner.innerHTML = "";
  };
}

// --- Intake (upload / paste) ------------------------------------------------

document.getElementById("uploadBtn").onclick = async () => {
  const fileInput = document.getElementById("cvFile");
  if (!fileInput.files[0]) return alert("Choose a file first.");
  const form = new FormData();
  form.append("file", fileInput.files[0]);
  form.append("label", document.getElementById("uploadLabel").value.trim());
  form.append("isMaster", "true");
  try {
    const created = await api("/cvs/upload", { method: "POST", body: form });
    fileInput.value = "";
    document.getElementById("uploadLabel").value = "";
    intakePanel.open = false;
    activeCvId = created?.id ?? activeCvId;
    await loadCvs({ keepSelection: true });
    if (created?.id) await selectCv(created.id);
  } catch (err) {
    showError(main, err);
  }
};

document.getElementById("pasteBtn").onclick = async () => {
  const content = document.getElementById("pasteContent").value.trim();
  if (!content) return alert("Paste some CV content first.");
  try {
    const created = await api("/cvs", {
      method: "POST",
      body: { label: document.getElementById("pasteLabel").value.trim() || "Pasted CV", content },
    });
    document.getElementById("pasteContent").value = "";
    document.getElementById("pasteLabel").value = "";
    intakePanel.open = false;
    activeCvId = created?.id ?? activeCvId;
    await loadCvs({ keepSelection: true });
    if (created?.id) await selectCv(created.id);
  } catch (err) {
    showError(main, err);
  }
};

// --- Bench switching --------------------------------------------------------

const benchPanels = {
  document: document.getElementById("benchDocument"),
  tailor: document.getElementById("benchTailor"),
};

function showBench(name) {
  for (const [key, el] of Object.entries(benchPanels)) el.hidden = key !== name;
  document.querySelectorAll(".bench-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.bench === name);
  });
}

document.querySelectorAll(".bench-tab").forEach((tab) => {
  tab.onclick = () => showBench(tab.dataset.bench);
});

// --- Improve chat (streamed) -----------------------------------------------

function stripCvBlock(text) {
  return text.replace(/```CV\n[\s\S]*?\n```/, "[proposed CV shown in the document]").trim();
}

// Requires the closing fence, so a still-streaming (or truncated) reply
// correctly yields nothing rather than half a CV.
function extractCvBlock(text) {
  return text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;
}

/**
 * Consume the SSE stream from POST /cvs/:id/chat -- the reply renders token by
 * token instead of appearing all at once after a long spinner. `done` carries
 * the full text, which is what the CV-block extraction runs against.
 */
async function sendChat(message) {
  if (!activeCvId || !doc) return;
  doc.assistant.setInputDisabled(true);
  doc.assistant.addNote("user", message);
  const pending = doc.assistant.addNote("assistant", "thinking…");

  try {
    const res = await fetch(`/api/cvs/${activeCvId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      let error;
      try {
        error = (await res.json()).error;
      } catch {
        // Non-JSON 401 body -- Cloudflare Access's re-auth page came back
        // instead of this API (its session cookie expired mid-chat).
        if (res.status === 401) error = "Your session expired. Reload the page to sign in again.";
      }
      if (res.status === 429) error = (error || "Daily AI usage cap reached.") + " See the AI budget indicator in the nav for today's usage.";
      throw new Error(error || `Request failed (${res.status})`);
    }

    doc.assistant.setNoteText(pending, "");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let reasoningSoFar = "";
    let streamError = null;

    // SSE frames are separated by a blank line; a frame can straddle chunks.
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
        if (event === "reasoning") {
          reasoningSoFar += data.text;
          doc.assistant.setReasoningText(pending, reasoningSoFar);
        } else if (event === "text") {
          reply += data.text;
          doc.assistant.setNoteText(pending, stripCvBlock(reply));
        } else if (event === "done") {
          reply = data.reply;
        } else if (event === "error") {
          streamError = data.error;
        }
      }
    }

    doc.assistant.setNoteText(pending, stripCvBlock(reply));

    if (streamError) throw new Error(streamError);

    const proposedCv = extractCvBlock(reply);
    if (proposedCv) {
      doc.showProposed(proposedCv, {
        label: "The assistant proposed a full rewrite.",
        onAccept: async (text) => {
          const saved = await api(`/cvs/${activeCvId}/chat/accept`, { method: "POST", body: { content: text } });
          activeCvId = saved.id;
          benchKicker.innerHTML = `Working on <strong>${escapeHtml(saved.label)}</strong>`;
          doc.assistant.addNote("assistant", "Saved as a new CV version.");
          await loadCvs({ keepSelection: true });
        },
      });
    }
  } catch (err) {
    showError(main, err);
  } finally {
    doc.assistant.setInputDisabled(false);
  }
}

// --- Tailor bench -----------------------------------------------------------

wireJobPostFetch({
  linkInput: document.getElementById("jobPostLink"),
  fetchBtn: document.getElementById("fetchJobPost"),
  jobPostTextarea: document.getElementById("jobPost"),
  statusEl: document.getElementById("fetchStatus"),
});

const runBtn = document.getElementById("runBtn");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

runBtn.onclick = async () => {
  if (!activeCvId) return alert("Pick a CV from the library rail first.");
  const jobPostText = document.getElementById("jobPost").value.trim();
  if (!jobPostText) return alert("Paste a job posting first.");

  resultEl.innerHTML = `<div class="card">${skeletonBars()}</div>`;
  try {
    const data = await runStagedTask(
      () =>
        api("/tailor/quick", {
          method: "POST",
          body: { cvId: activeCvId, jobPostText, flavor: document.getElementById("flavor").value },
        }),
      {
        statusEl,
        button: runBtn,
        busyLabel: "Tailoring…",
        stages: [
          [0, "Reading the job post…"],
          [4000, "Matching against your CV…"],
          [15000, "Still working — long CVs take up to a minute."],
        ],
      }
    );
    renderTailorResult(data);
  } catch (err) {
    resultEl.innerHTML = "";
    showError(main, err);
  }
};

function renderTailorResult(data) {
  const analysisText = data.analysis
    .replace(/```CV\n[\s\S]*?\n```/, "")
    .replace(/```KEYWORDS\n[\s\S]*?\n```/, "")
    .trim();

  resultEl.innerHTML = `
    <h2 class="section-rule" style="margin-top:32px;">Match analysis</h2>
    <div class="doc-content markdown-body">${renderMarkdown(analysisText)}</div>
    <h2 class="section-rule" style="margin-top:32px;">Current and tailored</h2>
    <div class="compare-grid">
      <div>
        <h3 class="muted card-title" style="margin-bottom:8px;">Current</h3>
        <div id="originalCvMount"></div>
      </div>
      <div>
        <h3 class="muted card-title" style="margin-bottom:8px;">Tailored</h3>
        <div id="tailoredCvMount"></div>
      </div>
    </div>`;

  const tailoredMount = document.getElementById("tailoredCvMount");

  if (!data.tailoredText) {
    tailoredMount.innerHTML =
      `<p class="muted">No structured tailored CV was returned — try again, or refine the job posting text.</p>`;
    return;
  }

  api(`/cvs/${data.baseCvId}`)
    .then((baseCv) => {
      mountCvDocument(document.getElementById("originalCvMount"), { content: baseCv.content, editable: false });
    })
    .catch(() => {
      document.getElementById("originalCvMount").innerHTML = `<p class="muted">Couldn't load the original CV for comparison.</p>`;
    });

  const scoreMatch = data.analysis.match(/match\s*score[:\s]*[^\d]{0,10}(\d{1,3})/i);
  if (scoreMatch) {
    matchPill.textContent = `${scoreMatch[1]}% Match`;
    matchPill.style.display = "inline-block";
  }

  const tailored = mountCvDocument(tailoredMount, {
    content: data.tailoredText,
    editable: true,
    saveLabel: "Save as new CV version",
    highlightTerms: data.keywords || [],
    onSave: async (text) => {
      await api("/tailor/quick/save", { method: "POST", body: { baseCvId: data.baseCvId, content: text } });
      await loadCvs({ keepSelection: true });
    },
  });

  tailored.setExtraActions(
    `<button type="button" class="btn secondary small" id="applyBtn">Save &amp; create application</button>`
  );

  // Scoped to this mount: two CV documents are on the bench at once, so a
  // document-wide lookup could pick up the wrong copy.
  tailoredMount.querySelector("#applyBtn").onclick = async () => {
    const company = prompt("Company name?");
    if (!company) return;
    const role = prompt("Role title?") || "Role";
    try {
      const cv = await api("/tailor/quick/save", {
        method: "POST",
        body: { baseCvId: data.baseCvId, content: tailored.getContent(), label: `${company} - ${role}` },
      });
      const app = await api("/applications", {
        method: "POST",
        body: {
          company,
          role,
          jobPostText: document.getElementById("jobPost").value.trim(),
          cvId: cv.id,
          stage: "saved",
        },
      });
      window.location.href = `application.html?id=${app.id}`;
    } catch (err) {
      showError(main, err);
    }
  };
}

if (params.get("bench") === "tailor") showBench("tailor");

loadCvs();
