import { api, escapeHtml, renderNav, showError, timeAgo, checkApiKey } from "./app.js";

renderNav("cv-store.html");
checkApiKey();

const cvList = document.getElementById("cvList");
const main = document.querySelector("main");

async function loadCvs() {
  let cvs = [];
  try {
    cvs = await api("/cvs");
  } catch (err) {
    showError(main, err);
  }
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

// --- Interactive improvement chat -----------------------------------------
const chatCard = document.getElementById("chatCard");
const chatLog = document.getElementById("chatLog");
const chatTitle = document.getElementById("chatTitle");
const proposedWrap = document.getElementById("proposedWrap");
let activeCvId = null;

async function openChat(cvId, label) {
  activeCvId = cvId;
  chatTitle.textContent = `Improve: ${label}`;
  chatCard.style.display = "block";
  chatCard.scrollIntoView({ behavior: "smooth" });
  proposedWrap.innerHTML = "";
  const history = await api(`/cvs/${cvId}/chat`);
  renderLog(history);
}

document.getElementById("closeChatBtn").onclick = () => {
  chatCard.style.display = "none";
  activeCvId = null;
};

function renderLog(messages) {
  chatLog.innerHTML = messages
    .map((m) => `<div class="msg ${m.role}">${escapeHtml(stripCvBlock(m.content))}</div>`)
    .join("");
  chatLog.scrollTop = chatLog.scrollHeight;
}

function stripCvBlock(text) {
  return text.replace(/```CV\n[\s\S]*?\n```/, "[proposed CV shown below]").trim();
}

// Requires the closing fence, so a still-streaming (or truncated) reply
// correctly yields nothing rather than half a CV.
function extractCvBlock(text) {
  return text.match(/```CV\n([\s\S]*?)\n```/)?.[1].trim() || null;
}

document.getElementById("chatSend").onclick = sendChat;
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

/**
 * Consume the SSE stream from POST /cvs/:id/chat.
 *
 * The reply now renders token by token instead of appearing all at once after
 * a long spinner. `done` carries the full text, which is what the CV-block
 * extraction runs against.
 */
async function sendChat() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message || !activeCvId) return;
  input.value = "";
  input.disabled = true;
  chatLog.insertAdjacentHTML("beforeend", `<div class="msg user">${escapeHtml(message)}</div>`);
  chatLog.insertAdjacentHTML("beforeend", `<div class="msg assistant" id="pending"><span class="spinner"></span> thinking…</div>`);
  chatLog.scrollTop = chatLog.scrollHeight;

  try {
    const res = await fetch(`/api/cvs/${activeCvId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (res.status === 401) {
      location.href = `login.html?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `Request failed (${res.status})`);
    }

    const pending = document.getElementById("pending");
    pending.textContent = "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let streamError = null;

    // SSE frames are separated by a blank line; a frame can straddle chunks.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const dataLine = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !dataLine) continue;

        const data = JSON.parse(dataLine);
        if (event === "text") {
          reply += data.text;
          pending.textContent = stripCvBlock(reply);
          chatLog.scrollTop = chatLog.scrollHeight;
        } else if (event === "done") {
          reply = data.reply;
        } else if (event === "error") {
          streamError = data.error;
        }
      }
    }

    pending.removeAttribute("id");
    pending.textContent = stripCvBlock(reply);
    chatLog.scrollTop = chatLog.scrollHeight;

    if (streamError) throw new Error(streamError);

    const proposedCv = extractCvBlock(reply);
    if (proposedCv) {
      proposedWrap.innerHTML = `
        <h2 style="margin-top:16px;">Proposed revision</h2>
        <pre class="cv-preview">${escapeHtml(proposedCv)}</pre>
        <div class="row" style="margin-top:8px;">
          <button class="btn" id="acceptCv">Accept as new version</button>
        </div>`;
      document.getElementById("acceptCv").onclick = async () => {
        await api(`/cvs/${activeCvId}/chat/accept`, { method: "POST", body: { content: proposedCv } });
        proposedWrap.innerHTML = `<p class="muted">Saved as a new CV version.</p>`;
        loadCvs();
      };
    }
  } catch (err) {
    document.getElementById("pending")?.remove();
    showError(main, err);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

loadCvs();
