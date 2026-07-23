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

Try it with the two files in `samples/` — one is a paraphrase of the other.

## Project structure

```
index.html          app shell
css/styles.css      styles
js/textPipeline.js  normalize → tokenize → stopword filtering
js/parser.js        PDF (PDF.js), DOCX (JSZip + XML), TXT extraction
js/app.js           upload UI + document registry
samples/            demo documents
```

Each layer is an isolated module on the `ScriptIQ` namespace so scoring,
diffing, graphing, and storage can be developed independently.

## Roadmap

- [x] **Phase 1** — upload + text extraction (PDF/DOCX/TXT) + text pipeline
- [ ] **Phase 2** — TF-IDF + cosine similarity, highlighted matches
- [ ] **Phase 3** — LCS side-by-side diff view
- [ ] **Phase 4** — D3.js similarity network graph for batches
- [ ] **Phase 5** — semantic (embedding) similarity layer + IndexedDB history
- [ ] **Phase 6** — edge cases, polish, demo walkthrough

## Dependencies (CDN, no install)

| Library | Use |
|---|---|
| PDF.js 3.11 | PDF text extraction |
| JSZip 3.10 | unzipping `.docx` containers |
