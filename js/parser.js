/**
 * ScriptIQ — file parsing layer.
 *
 * Extracts plain text from uploaded submissions, entirely in the browser:
 *   - PDF  → PDF.js (page by page text content)
 *   - DOCX → JSZip + DOMParser (a .docx is a zip; the text lives in
 *            word/document.xml as <w:t> runs grouped into <w:p> paragraphs)
 *   - TXT/MD → TextDecoder
 *
 * Public API: ScriptIQ.parser.extractText(file) → Promise<string>
 */
window.ScriptIQ = window.ScriptIQ || {};

ScriptIQ.parser = (function () {
  "use strict";

  // Point PDF.js at its worker on the same CDN. If the browser refuses a
  // cross-origin worker (e.g. when running from file://), PDF.js silently
  // falls back to running the parser on the main thread — slower but fine
  // for essay-sized documents.
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md"];

  function extensionOf(filename) {
    const dot = filename.lastIndexOf(".");
    return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
  }

  function isSupported(file) {
    return SUPPORTED_EXTENSIONS.includes(extensionOf(file.name));
  }

  /** PDF → text. Joins each page's text items, inserting line breaks
   *  where PDF.js marks end-of-line, and blank lines between pages. */
  async function parsePdf(arrayBuffer) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js failed to load — check your internet connection (it is served from a CDN).");
    }
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (err) {
      if (err && err.name === "PasswordException") {
        throw new Error("This PDF is password-protected — remove the password and re-upload it.");
      }
      if (err && err.name === "InvalidPDFException") {
        throw new Error("This file is corrupt or is not actually a PDF.");
      }
      throw err;
    }
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      pages.push(pageText.trim());
    }
    return pages.join("\n\n");
  }

  /** DOCX → text. Unzip, then walk word/document.xml:
   *  each <w:p> is a paragraph; text lives in <w:t>; <w:tab> is a tab. */
  async function parseDocx(arrayBuffer) {
    if (!window.JSZip) {
      throw new Error("JSZip failed to load — check your internet connection (it is served from a CDN).");
    }
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch {
      throw new Error(
        "This file is corrupt or is not a real .docx (older .doc files are not supported — re-save as .docx)."
      );
    }
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      throw new Error("Not a valid .docx file (missing word/document.xml).");
    }
    const xmlText = await docEntry.async("string");
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Could not parse the document XML inside this .docx.");
    }

    // getElementsByTagName with the "w:" prefix works across browsers for
    // this namespaced XML; paragraphs → lines.
    const paragraphs = doc.getElementsByTagName("w:p");
    const lines = [];
    for (const p of paragraphs) {
      let line = "";
      for (const node of p.getElementsByTagName("*")) {
        if (node.tagName === "w:t") line += node.textContent;
        else if (node.tagName === "w:tab") line += "\t";
      }
      lines.push(line);
    }
    return lines.join("\n").trim();
  }

  /** Plain text / markdown → text. */
  async function parseTxt(arrayBuffer) {
    return new TextDecoder("utf-8").decode(arrayBuffer);
  }

  /**
   * Main entry point: extract plain text from an uploaded File.
   * Throws with a human-readable message on unsupported/corrupt files.
   */
  async function extractText(file) {
    const ext = extensionOf(file.name);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file type ".${ext}" — use PDF, DOCX, or TXT.`);
    }
    if (file.size === 0) {
      throw new Error("This file is empty (0 bytes).");
    }

    const buffer = await file.arrayBuffer();
    let text;
    switch (ext) {
      case "pdf":  text = await parsePdf(buffer); break;
      case "docx": text = await parseDocx(buffer); break;
      default:     text = await parseTxt(buffer); break;
    }

    if (!text || !text.trim()) {
      throw new Error(
        "No text could be extracted — this may be a scanned/image-only document."
      );
    }
    return text;
  }

  return { extractText, isSupported, extensionOf, SUPPORTED_EXTENSIONS };
})();
