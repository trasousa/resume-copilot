// Shared "CV as a document" component: renders plain-text CV content the
// way a resume actually looks, lets the user edit it in place, and
// optionally mounts a margin assistant rail next to it. Used by CV Store's
// improve flow, the Tailor page's result, and the Application page's
// tailored-CV result -- one render/edit/save story instead of three copies
// of <pre class="cv-preview">.
//
// Heuristic, display-only: CV content stays plain text in the database.
// The parser below turns it into headings/paragraphs/bullets for display;
// editing reads .innerText back out as the new plain text, no attempt to
// serialize back to markdown.

import { escapeHtml } from "./app.js";

function renderDocHtml(text) {
  const lines = (text || "").split("\n");
  let html = "";
  let sawFirstLine = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }

    if (!sawFirstLine) {
      html += `<h1>${escapeHtml(line)}</h1>`;
      sawFirstLine = true;
      continue;
    }

    const isBullet = /^[-*•]\s+/.test(line);
    const isMdHeading = /^#{1,3}\s+/.test(line);
    const isAllCapsHeading =
      !isBullet && line.length <= 60 && line === line.toUpperCase() && /[A-Z]/.test(line);

    if (isMdHeading) {
      closeList();
      html += `<h2>${escapeHtml(line.replace(/^#{1,3}\s+/, ""))}</h2>`;
    } else if (isAllCapsHeading) {
      closeList();
      html += `<h2>${escapeHtml(line)}</h2>`;
    } else if (isBullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.replace(/^[-*•]\s+/, ""))}</li>`;
    } else {
      closeList();
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html || `<p class="muted">Nothing here yet.</p>`;
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.content - initial plain-text CV content
 * @param {boolean} [opts.editable=true]
 * @param {string} [opts.saveLabel]
 * @param {(text: string) => Promise<any>} [opts.onSave] - persists edited content as a new version
 * @param {boolean} [opts.assistant=false] - mount the margin assistant rail
 * @param {(message: string) => void} [opts.onAssistantSend]
 */
export function mountCvDocument(container, opts) {
  const {
    content,
    editable = true,
    saveLabel = "Save as new version",
    onSave,
    assistant = false,
    onAssistantSend,
  } = opts;

  let baseline = content || "";

  container.innerHTML = `
    <div class="cv-page">
      <div class="cv-doc-wrap">
        <div class="cv-proposed-banner" id="cvProposedBanner"></div>
        <div class="row between cv-doc-toolbar">
          <div class="row" style="gap: 8px;">
            ${editable ? `<button type="button" class="btn secondary small" id="cvEditToggle">Edit</button>` : ""}
            <span class="muted" id="cvDocNote"></span>
          </div>
          <div class="row" id="cvExtraActions"></div>
        </div>
        <div class="cv-doc" id="cvDocBody"></div>
        <div class="row cv-doc-save-row" id="cvSaveRow" style="display: none;">
          <button type="button" class="btn small" id="cvSaveBtn">${escapeHtml(saveLabel)}</button>
          <button type="button" class="btn secondary small" id="cvDiscardBtn">Discard edits</button>
        </div>
      </div>
      ${
        assistant
          ? `<div class="assistant-rail">
              <div class="assistant-rail-head">Assistant</div>
              <div class="assistant-log" id="assistantLog"></div>
              <div class="assistant-input-row">
                <input type="text" id="assistantInput" placeholder="Ask for a change…" />
                <button type="button" class="btn small" id="assistantSend">Send</button>
              </div>
            </div>`
          : ""
      }
    </div>
  `;

  const docBody = container.querySelector("#cvDocBody");
  const editToggle = container.querySelector("#cvEditToggle");
  const docNote = container.querySelector("#cvDocNote");
  const saveRow = container.querySelector("#cvSaveRow");
  const saveBtn = container.querySelector("#cvSaveBtn");
  const discardBtn = container.querySelector("#cvDiscardBtn");
  const proposedBanner = container.querySelector("#cvProposedBanner");

  docBody.innerHTML = renderDocHtml(baseline);

  function currentText() {
    return docBody.contentEditable === "true" ? docBody.innerText.replace(/\n{3,}/g, "\n\n").trim() : baseline;
  }

  function refreshDirtyState() {
    saveRow.style.display = currentText() !== baseline.trim() ? "flex" : "none";
  }

  if (editable) {
    editToggle.onclick = () => {
      const editing = docBody.contentEditable === "true";
      if (editing) {
        // Leaving edit mode: re-render from whatever text is there now so
        // headings/bullets reflect any structural edits the user made.
        const text = currentText();
        docBody.contentEditable = "false";
        docBody.innerHTML = renderDocHtml(text);
        editToggle.textContent = "Edit";
      } else {
        docBody.contentEditable = "true";
        docBody.focus();
        editToggle.textContent = "Preview";
      }
    };
    docBody.addEventListener("input", refreshDirtyState);

    saveBtn.onclick = async () => {
      if (!onSave) return;
      const text = currentText();
      saveBtn.disabled = true;
      docNote.textContent = "saving…";
      try {
        await onSave(text);
        baseline = text;
        docBody.contentEditable = "false";
        editToggle.textContent = "Edit";
        docBody.innerHTML = renderDocHtml(baseline);
        saveRow.style.display = "none";
        docNote.textContent = "Saved.";
        setTimeout(() => (docNote.textContent = ""), 2000);
      } catch (err) {
        docNote.textContent = "";
        throw err;
      } finally {
        saveBtn.disabled = false;
      }
    };

    discardBtn.onclick = () => {
      docBody.contentEditable = "false";
      editToggle.textContent = "Edit";
      docBody.innerHTML = renderDocHtml(baseline);
      saveRow.style.display = "none";
    };
  } else {
    editToggle?.remove();
  }

  if (assistant) {
    const input = container.querySelector("#assistantInput");
    const sendBtn = container.querySelector("#assistantSend");
    const send = () => {
      const message = input.value.trim();
      if (!message || !onAssistantSend) return;
      input.value = "";
      onAssistantSend(message);
    };
    sendBtn.onclick = send;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
  }

  const controller = {
    getContent: currentText,
    setContent(text) {
      baseline = text || "";
      docBody.contentEditable = "false";
      if (editToggle) editToggle.textContent = "Edit";
      docBody.innerHTML = renderDocHtml(baseline);
      saveRow.style.display = "none";
    },
    setExtraActions(html) {
      container.querySelector("#cvExtraActions").innerHTML = html;
    },
    /** Shows an Accept/Discard banner above the document with a preview swap. */
    showProposed(text, { onAccept, label = "The assistant proposed a full rewrite." } = {}) {
      const previousBaseline = baseline;
      docBody.contentEditable = "false";
      if (editToggle) editToggle.textContent = "Edit";
      docBody.innerHTML = renderDocHtml(text);
      saveRow.style.display = "none";
      if (editToggle) editToggle.disabled = true;

      proposedBanner.innerHTML = `
        <div class="proposed-banner-inner">
          <span>${escapeHtml(label)}</span>
          <div class="row">
            <button type="button" class="btn small" id="cvAcceptProposed">Accept</button>
            <button type="button" class="btn secondary small" id="cvDiscardProposed">Discard</button>
          </div>
        </div>`;

      container.querySelector("#cvAcceptProposed").onclick = async () => {
        if (onAccept) await onAccept(text);
        baseline = text;
        proposedBanner.innerHTML = "";
        if (editToggle) editToggle.disabled = false;
      };
      container.querySelector("#cvDiscardProposed").onclick = () => {
        controller.setContent(previousBaseline);
        proposedBanner.innerHTML = "";
        if (editToggle) editToggle.disabled = false;
      };
    },
    // --- assistant rail primitives -------------------------------------
    assistant: assistant
      ? {
          addNote(role, text) {
            const log = container.querySelector("#assistantLog");
            const el = document.createElement("div");
            el.className = `assistant-note ${role}`;
            el.textContent = text;
            log.appendChild(el);
            log.scrollTop = log.scrollHeight;
            return el;
          },
          setNoteText(el, text) {
            el.textContent = text;
            const log = container.querySelector("#assistantLog");
            log.scrollTop = log.scrollHeight;
          },
          setInputDisabled(disabled) {
            container.querySelector("#assistantInput").disabled = disabled;
            container.querySelector("#assistantSend").disabled = disabled;
          },
        }
      : null,
  };

  return controller;
}
