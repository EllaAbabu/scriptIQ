# ScriptIQ

Free, browser-based plagiarism detection for lecturers — built for Ghanaian
universities that can't afford commercial subscriptions. Everything runs
client-side: submissions never leave the lecturer's machine.

## Running it

No build step. Either:

- open `index.html` directly in a browser, or
- serve the folder: `python -m http.server 8000` → http://localhost:8000

(The static server is recommended — PDF parsing uses a web worker that some
browsers restrict on `file://` URLs; it still works there via a slower
main-thread fallback.)

## Batch uploads

Upload files individually, or drop in a **`.zip` of a whole class** — the same
JSZip already used for `.docx` expands it. Nested folders are fine; macOS and
Windows archive noise (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, dotfiles) is
ignored, and non-document members are reported rather than failing the batch.
Limits: 300 documents and 250 MB uncompressed per archive.

Above five documents the extracted-text panel switches to a compact roster —
one scrollable row per submission with its word counts, each text collapsed
behind a toggle. Two files still show their text inline as before.

`samples/class-batch.zip` is a 50-submission demo archive (regenerate with
`python3 tests/make-class-batch.py`). Three essays are a copying cluster and
score 73% / 66% / 54%; the next-highest pair is 30% and the median is 16%.

## Demo walkthrough

Upload all four files in `samples/` at once, then:

1. **Batch overview** — a graph appears. Three essays cluster together (the
   original, a paraphrase of it, and a partial copy); the cocoa-farming essay
   sits apart. Drag the threshold slider to see weaker links appear.
2. **Click the thickest red edge** — it jumps straight into that pair's diff.
3. **Text diff tab** — amber blocks show passages rewritten in place; that's
   the paraphrasing.
4. **Shared passages tab** — the TF-IDF score plus verbatim runs highlighted
   by length (yellow 3–4 words, amber 5–7, red 8+).
5. **Enable AI semantic analysis** — downloads the model once, then scores
   meaning rather than wording. The paraphrase pair scores much higher here
   than TF-IDF alone suggests.
6. **Reload the page** — documents, graph, and comparison history all come
   back from IndexedDB.

## Tests

```
node tests/run-tests.js                      # algorithms — no dependencies
npm install jszip && node tests/test-archive.js   # ZIP batch upload
```

`run-tests.js` covers the algorithms directly: identical and empty documents,
non-English text, span/offset invariants, diff completeness, and a
60-submission batch.

`test-archive.js` expands the real `samples/class-batch.zip` with the real
JSZip and checks noise filtering, nested paths, corrupt and document-free
archives, then extracts and scores all 50 submissions to confirm the planted
copying cluster ranks top. It needs JSZip locally (dev-only — the app itself
still loads it from a CDN and has no build step) and skips cleanly without it.

## Project structure

```
index.html          app shell
css/styles.css      styles
js/textPipeline.js  normalize → tokenize → stopword filtering
js/parser.js        PDF (PDF.js), DOCX (JSZip + XML), TXT extraction
js/similarity.js    TF-IDF + cosine scoring, shared n-gram matching
js/diff.js          word-level LCS diff (equal / added / removed / rewritten)
js/graph.js         D3 force-directed similarity network for batches
js/semantic.js      in-browser sentence embeddings (transformers.js MiniLM)
js/storage.js       IndexedDB persistence (submissions + comparison history)
js/app.js           upload UI, document registry, comparison view
samples/            demo documents
```

Each layer is an isolated module on the `ScriptIQ` namespace so scoring,
diffing, graphing, and storage can be developed independently.

## Roadmap

- [x] **Phase 1** — upload + text extraction (PDF/DOCX/TXT) + text pipeline
- [x] **Phase 2** — TF-IDF + cosine similarity, highlighted matches
- [x] **Phase 3** — LCS side-by-side diff view
- [x] **Phase 4** — D3.js similarity network graph for batches
- [x] **Phase 5** — semantic (embedding) similarity layer + IndexedDB history
- [x] **Phase 6** — edge cases, polish, demo walkthrough

## Dependencies (CDN, no install)

| Library | Use |
|---|---|
| PDF.js 3.11 | PDF text extraction |
| JSZip 3.10 | unzipping `.docx` containers |
| D3.js 7.8 | force-directed similarity network graph |
| transformers.js 2.17 | optional in-browser semantic embeddings (MiniLM, ~25 MB model fetched on opt-in) |

## The AI layer

There is no backend and no API key anywhere. "Enable AI semantic analysis"
downloads a MiniLM sentence-embedding model once (cached by the browser) and
runs it locally via transformers.js. It scores *meaning*, so heavy paraphrase
that TF-IDF underrates still registers. If the model can't load, everything
else keeps working TF-IDF-only.
