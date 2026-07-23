/**
 * ScriptIQ — application shell (Phase 1).
 *
 * Wires the upload UI to the parser + pipeline and renders extracted text.
 * Parsed documents are kept in ScriptIQ.documents so later phases
 * (similarity scoring, diff, graph) can consume them without re-parsing.
 */
window.ScriptIQ = window.ScriptIQ || {};

/** In-memory registry of processed documents, keyed by a generated id. */
ScriptIQ.documents = new Map();

(function () {
  "use strict";

  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const statusEl = document.getElementById("upload-status");
  const documentsPanel = document.getElementById("documents-panel");
  const documentList = document.getElementById("document-list");
  const clearAllBtn = document.getElementById("clear-all");

  let nextId = 1;

  // ---------- upload wiring ----------

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    })
  );

  dropZone.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
    fileInput.value = ""; // allow re-uploading the same file
  });

  clearAllBtn.addEventListener("click", () => {
    ScriptIQ.documents.clear();
    documentList.innerHTML = "";
    documentsPanel.hidden = true;
    setStatus("");
  });

  // ---------- processing ----------

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    documentsPanel.hidden = false;

    for (const file of files) {
      const id = "doc-" + nextId++;
      const card = renderCard(id, file.name, formatSize(file.size));
      documentList.appendChild(card);

      try {
        const rawText = await ScriptIQ.parser.extractText(file);
        const processed = ScriptIQ.pipeline.process(rawText);

        ScriptIQ.documents.set(id, {
          id,
          name: file.name,
          size: file.size,
          uploadedAt: new Date(),
          ...processed,
        });
        renderCardResult(card, processed);
      } catch (err) {
        renderCardError(card, err.message);
      }
    }

    const ok = ScriptIQ.documents.size;
    setStatus(
      ok >= 2
        ? `${ok} documents ready — similarity scoring arrives in Phase 2.`
        : `${ok} document ready. Upload at least one more to compare.`
    );
  }

  // ---------- rendering ----------

  function renderCard(id, name, sizeLabel) {
    const card = document.createElement("article");
    card.className = "doc-card";
    card.dataset.docId = id;
    card.innerHTML = `
      <header class="doc-card-header">
        <span class="doc-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="doc-size">${sizeLabel}</span>
      </header>
      <div class="doc-body">
        <p class="doc-status"><span class="spinner"></span> Extracting text…</p>
      </div>`;
    return card;
  }

  function renderCardResult(card, processed) {
    const { stats } = processed;
    const body = card.querySelector(".doc-body");
    body.innerHTML = `
      <ul class="doc-stats">
        <li><strong>${stats.words.toLocaleString()}</strong> words</li>
        <li><strong>${stats.meaningfulWords.toLocaleString()}</strong> after stopwords</li>
        <li><strong>${stats.uniqueWords.toLocaleString()}</strong> unique terms</li>
      </ul>
      <div class="doc-tabs" role="tablist">
        <button class="tab active" data-view="raw" type="button">Extracted text</button>
        <button class="tab" data-view="processed" type="button">Processed tokens</button>
      </div>
      <pre class="doc-text" data-current="raw"></pre>`;

    const pre = body.querySelector(".doc-text");
    pre.textContent = processed.raw;

    body.querySelector(".doc-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      body.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      pre.textContent =
        btn.dataset.view === "raw"
          ? processed.raw
          : processed.filteredTokens.join(" ");
    });
  }

  function renderCardError(card, message) {
    card.classList.add("doc-card-error");
    card.querySelector(".doc-body").innerHTML =
      `<p class="doc-error">⚠ ${escapeHtml(message)}</p>`;
  }

  // ---------- helpers ----------

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
