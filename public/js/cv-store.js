import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey } from "./app.js";
import { mountCvDocument } from "./cv-doc.js";

renderNav("profile.html"); // CV Store isn't a top-level nav tab; Profile links here ("Manage in CV Store").
checkApiKey();

const cvList = document.getElementById("cvList");
const main = document.querySelector("main");

const onboardingBanner = document.getElementById("onboardingBanner");

async function loadCvs() {
  let cvs = [];
  try {
    cvs = await api("/cvs");
  } catch (err) {
    showError(main, err);
  }

  renderOnboarding(cvs);

  if (!cvs.length) {
    cvList.innerHTML = `<div class="empty">No CVs yet — upload one above.</div>`;
    return;
  }
  cvList.innerHTML = cvs
    .map(
      (cv) => `
    <div class="row between" style="padding:10px 0; border-bottom:1px solid var(--border);">
      <div>
        <strong>${escapeHtml(cv.label)}</strong>
        ${cv.isMaster ? '<span class="pill">master</span>' : ""}
        ${cv.parentId ? '<span class="pill muted">revised</span>' : ""}
        <div class="muted">${timeAgo(cv.createdAt)} — ${escapeHtml(cv.snippet)}…</div>
      </div>
      <div class="row">
        ${!cv.isMaster ? `<button class="btn secondary small" data-master="${cv.id}">Set as master</button>` : ""}
        <button class="btn secondary small" data-improve="${cv.id}" data-label="${escapeHtml(cv.label)}">Improve</button>
        <a class="btn secondary small" href="/api/cvs/${cv.id}/download">Download .docx</a>
        ${cv.hasOriginal ? `<a class="btn secondary small" href="/api/cvs/${cv.id}/original">Download original</a>` : ""}
        <button class="btn danger small" data-delete="${cv.id}">Delete</button>
      </div>
    </div>`
    )
    .join("");

  cvList.querySelectorAll("[data-master]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/cvs/${btn.dataset.master}/master`, { method: "PATCH" });
      loadCvs();
    };
  });
  cvList.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this CV version?")) return;
      await api(`/cvs/${btn.dataset.delete}`, { method: "DELETE" });
      loadCvs();
    };
  });
  cvList.querySelectorAll("[data-improve]").forEach((btn) => {
    btn.onclick = () => openChat(btn.dataset.improve, btn.dataset.label);
  });
}

/**
 * Onboarding step 2: after the first CV exists, ask once for the job-search
 * context (region, remote, target comp) instead of leaving Job Search to ask
 * on every single search. `profile.updatedAt` is the "already asked" flag --
 * both Save and Skip set it, so this never nags twice.
 */
async function renderOnboarding(cvs) {
  if (!cvs.length) {
    onboardingBanner.innerHTML = `<div class="card empty-state">
        <h2>Welcome — let's get your CV in here</h2>
        <p class="muted">Upload a file or paste your CV text below. Once it's in the store you can improve it with the assistant, or head to Tailor / Job Search to start applying.</p>
      </div>`;
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
      <p class="muted">Save this once and Job Search will use it automatically — you can change it anytime from the Job Search page.</p>
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

document.getElementById("uploadBtn").onclick = async () => {
  const fileInput = document.getElementById("cvFile");
  if (!fileInput.files[0]) return alert("Choose a file first.");
  const form = new FormData();
  form.append("file", fileInput.files[0]);
  form.append("label", document.getElementById("uploadLabel").value.trim());
  form.append("isMaster", "true");
  try {
    await api("/cvs/upload", { method: "POST", body: form });
    fileInput.value = "";
    document.getElementById("uploadLabel").value = "";
    loadCvs();
  } catch (err) {
    showError(main, err);
  }
};

document.getElementById("pasteBtn").onclick = async () => {
  const content = document.getElementById("pasteContent").value.trim();
  if (!content) return alert("Paste some CV content first.");
  try {
    await api("/cvs", {
      method: "POST",
      body: { label: document.getElementById("pasteLabel").value.trim() || "Pasted CV", content },
    });
    document.getElementById("pasteContent").value = "";
    document.getElementById("pasteLabel").value = "";
    loadCvs();
  } catch (err) {
    showError(main, err);
  }
};

// --- Interactive improvement: document view + assistant rail ---------------
const improveCard = document.getElementById("improveCard");
const improveTitle = document.getElementById("improveTitle");
const cvDocMount = document.getElementById("cvDocMount");
let activeCvId = null;
let doc = null;

async function openChat(cvId, label) {
  activeCvId = cvId;
  improveTitle.textContent = `Improve: ${label}`;
  improveCard.style.display = "block";
  improveCard.scrollIntoView({ behavior: "smooth" });

  const [cv, history] = await Promise.all([api(`/cvs/${cvId}`), api(`/cvs/${cvId}/chat`)]);

  doc = mountCvDocument(cvDocMount, {
    content: cv.content,
    editable: true,
    onSave: async (text) => {
      const saved = await api(`/cvs/${activeCvId}/chat/accept`, { method: "POST", body: { content: text } });
      activeCvId = saved.id;
      improveTitle.textContent = `Improve: ${saved.label}`;
      loadCvs();
    },
    assistant: true,
    onAssistantSend: sendChat,
  });

  history.forEach((m) => doc.assistant.addNote(m.role, stripCvBlock(m.content)));
}

document.getElementById("closeImproveBtn").onclick = () => {
  improveCard.style.display = "none";
  activeCvId = null;
  doc = null;
};

function stripCvBlock(text) {
  return text.replace(/```CV\n[\s\S]*?\n```/, "[proposed CV shown in the document]").trim();
}

// Requires the closing fence, so a still-streaming (or truncated) reply
// correctly yields nothing rather than half a CV.
function extractCvBlock(text) {
  return text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;
}

/**
 * Consume the SSE stream from POST /cvs/:id/chat.
 *
 * The reply now renders token by token instead of appearing all at once after
 * a long spinner. `done` carries the full text, which is what the CV-block
 * extraction runs against.
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
          improveTitle.textContent = `Improve: ${saved.label}`;
          doc.assistant.addNote("assistant", "Saved as a new CV version.");
          loadCvs();
        },
      });
    }
  } catch (err) {
    showError(main, err);
  } finally {
    doc.assistant.setInputDisabled(false);
  }
}

loadCvs();
