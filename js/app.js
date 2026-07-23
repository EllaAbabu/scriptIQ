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

  const comparePanel = document.getElementById("compare-panel");
  const selectA = document.getElementById("select-a");
  const selectB = document.getElementById("select-b");
  const compareBtn = document.getElementById("compare-btn");
  const compareResults = document.getElementById("compare-results");
  const viewMatches = document.getElementById("view-matches");
  const viewDiff = document.getElementById("view-diff");
  const viewToggle = document.querySelector(".view-toggle");

  /** The pair currently on screen; diff is computed lazily per pair. */
  let currentPair = null; // { idA, idB, diffRendered }

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
    comparePanel.hidden = true;
    compareResults.hidden = true;
    currentPair = null;
    setStatus("");
  });

  compareBtn.addEventListener("click", () => {
    if (selectA.value && selectB.value) {
      comparePair(selectA.value, selectB.value);
    }
  });

  viewToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    viewToggle.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    const showDiff = btn.dataset.view === "diff";
    viewMatches.hidden = showDiff;
    viewDiff.hidden = !showDiff;

    // Compute the LCS diff only when first asked for, then keep it.
    if (showDiff && currentPair && !currentPair.diffRendered) {
      renderDiff(
        ScriptIQ.documents.get(currentPair.idA),
        ScriptIQ.documents.get(currentPair.idB)
      );
      currentPair.diffRendered = true;
    }
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
        ? `${ok} documents ready — pick a pair below to compare.`
        : `${ok} document ready. Upload at least one more to compare.`
    );
    refreshComparePanel();
  }

  // ---------- comparison (Phase 2) ----------

  /** Show the compare panel and (re)fill the pair selectors. */
  function refreshComparePanel() {
    const docs = [...ScriptIQ.documents.values()];
    if (docs.length < 2) {
      comparePanel.hidden = true;
      return;
    }
    comparePanel.hidden = false;

    const fill = (select, selectedId) => {
      select.innerHTML = "";
      for (const doc of docs) {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.name;
        select.appendChild(opt);
      }
      if (selectedId && ScriptIQ.documents.has(selectedId)) {
        select.value = selectedId;
      }
    };
    fill(selectA, selectA.value || docs[0].id);
    fill(selectB, selectB.value || docs[1].id);
    if (selectA.value === selectB.value) selectB.value = docs[docs.length - 1].id;

    // With exactly two documents the pair is unambiguous — compare it now.
    if (docs.length === 2) comparePair(docs[0].id, docs[1].id);
  }

  /** Score a pair and render highlighted matches side by side. */
  function comparePair(idA, idB) {
    const docA = ScriptIQ.documents.get(idA);
    const docB = ScriptIQ.documents.get(idB);
    if (!docA || !docB) return;

    if (idA === idB) {
      setStatus("Pick two different documents to compare.");
      return;
    }

    // IDF over the whole uploaded corpus, not just the pair — common terms
    // across many submissions get down-weighted accordingly.
    const docs = [...ScriptIQ.documents.values()];
    const vectors = ScriptIQ.similarity.buildVectors(
      docs.map((d) => d.filteredTokens)
    );
    const vecOf = new Map(docs.map((d, i) => [d.id, vectors[i]]));
    const score = ScriptIQ.similarity.cosine(vecOf.get(idA), vecOf.get(idB));

    const matches = ScriptIQ.similarity.findMatches(
      docA.offsetTokens,
      docB.offsetTokens
    );

    currentPair = { idA, idB, diffRendered: false };
    renderComparison(docA, docB, score, matches);

    // If the lecturer is sitting on the diff tab, refresh it for the new
    // pair right away instead of leaving the old diff on screen.
    if (!viewDiff.hidden) {
      renderDiff(docA, docB);
      currentPair.diffRendered = true;
    }
  }

  function renderComparison(docA, docB, score, matches) {
    compareResults.hidden = false;

    const pct = Math.round(score * 100);
    const scoreValue = document.getElementById("score-value");
    const scoreLabel = document.getElementById("score-label");
    scoreValue.textContent = pct + "%";

    let level, label;
    if (pct >= 60) { level = "high"; label = "High similarity — review closely"; }
    else if (pct >= 30) { level = "moderate"; label = "Moderate similarity"; }
    else { level = "low"; label = "Low similarity"; }
    scoreValue.className = "score-value score-" + level;
    scoreLabel.textContent = label;

    document.getElementById("coverage-a").textContent =
      `${docA.name}: ${Math.round(matches.coverageA * 100)}% of words inside shared passages`;
    document.getElementById("coverage-b").textContent =
      `${docB.name}: ${Math.round(matches.coverageB * 100)}% of words inside shared passages`;

    document.getElementById("pane-title-a").textContent = docA.name;
    document.getElementById("pane-title-b").textContent = docB.name;
    document.getElementById("pane-text-a").innerHTML =
      highlightedHtml(docA.raw, matches.spansA);
    document.getElementById("pane-text-b").innerHTML =
      highlightedHtml(docB.raw, matches.spansB);

    compareResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- diff view (Phase 3) ----------

  function renderDiff(docA, docB) {
    const { ops, stats } = ScriptIQ.diff.diffTokens(
      docA.offsetTokens,
      docB.offsetTokens
    );

    document.getElementById("diff-summary").textContent =
      `${stats.equal.toLocaleString()} words unchanged · ` +
      `${stats.del.toLocaleString()} only in left · ` +
      `${stats.ins.toLocaleString()} only in right · ` +
      `${stats.modA.toLocaleString()} → ${stats.modB.toLocaleString()} words rewritten`;

    document.getElementById("diff-title-a").textContent = docA.name;
    document.getElementById("diff-title-b").textContent = docB.name;
    document.getElementById("diff-text-a").innerHTML =
      diffSideHtml(docA, ops, "a");
    document.getElementById("diff-text-b").innerHTML =
      diffSideHtml(docB, ops, "b");
  }

  /**
   * Render one side of the diff. Each op's token range maps back to a
   * character range in that document's raw text; the text between ops
   * (whitespace/punctuation) is rendered unstyled.
   */
  function diffSideHtml(doc, ops, side) {
    const tokens = doc.offsetTokens;
    const raw = doc.raw;
    let html = "";
    let pos = 0;

    for (const op of ops) {
      const startIdx = side === "a" ? op.aStart : op.bStart;
      const endIdx = side === "a" ? op.aEnd : op.bEnd;
      if (endIdx <= startIdx) continue; // op has no text on this side

      let cls = null;
      if (op.type === "del") cls = "df-del";
      else if (op.type === "ins") cls = "df-ins";
      else if (op.type === "mod") cls = "df-mod";

      const from = tokens[startIdx].start;
      const to = tokens[endIdx - 1].end;
      html += escapeHtml(raw.slice(pos, from));
      const text = escapeHtml(raw.slice(from, to));
      html += cls ? `<mark class="${cls}">${text}</mark>` : text;
      pos = to;
    }
    html += escapeHtml(raw.slice(pos));
    return html;
  }

  /** Raw text → HTML with <mark> wrappers around matched character spans. */
  function highlightedHtml(raw, spans) {
    let html = "";
    let pos = 0;
    for (const span of spans) {
      html += escapeHtml(raw.slice(pos, span.start));
      html += `<mark class="hl-${span.strength}">` +
        escapeHtml(raw.slice(span.start, span.end)) + "</mark>";
      pos = span.end;
    }
    html += escapeHtml(raw.slice(pos));
    return html;
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
