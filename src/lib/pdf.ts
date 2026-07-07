// pdfjs-dist 3.x legacy build supports iOS Safari ~11+ and does NOT use
// Promise.withResolvers (the ES2024 API that breaks pre-iOS-17.4 Safari in
// pdfjs 4.x/5.x). UMD `.js` files instead of `.mjs`.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";

GlobalWorkerOptions.workerSrc = workerUrl;

// pdfjs needs CMap + standard-font data files for many real-world PDFs
// (anything with embedded subset fonts, non-Latin scripts, or exported from
// Pages / Word / Acrobat). Without these, pdfjs throws during parse. We point
// to the unpkg CDN - only the specific files a given PDF needs get fetched,
// and they're small (a few KB each).
const PDFJS_VERSION = "3.11.174";
const CMAP_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
const STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;

// Scanned PDFs (no text layer) up to this many pages get OCR'd right here in
// the browser. Above it, a phone would sit at 100% CPU for 10+ minutes, so the
// caller routes the file to server-side OCR instead (see src/lib/server-ocr.ts)
// via the __SCANNED_PDF_LARGE__ sentinel below.
export const MAX_CLIENT_OCR_PAGES = 50;

// OCR render target: ~150-200 DPI for an A4/letter page. Higher wastes memory
// and time for no accuracy gain; lower starts dropping small print. The scale
// cap guards against tiny page boxes (e.g. slide-sized PDFs) exploding the
// canvas.
const OCR_TARGET_LONG_EDGE_PX = 1800;
const OCR_MAX_RENDER_SCALE = 3;
// Same worker-boot timeout as image OCR (src/lib/image-ocr.ts): tesseract's
// wasm + traineddata come off a CDN, and flaky mobile networks can stall that
// download forever without an error.
const OCR_WORKER_INIT_MS = 20_000;

type PdfDocument = Awaited<ReturnType<typeof getDocument>["promise"]>;

// OCR pass for scanned PDFs: render each page to an offscreen canvas via
// pdf.js, then run tesseract over the pixels - the same engine and parameters
// as image uploads (src/lib/image-ocr.ts), but with ONE worker reused across
// all pages (worker boot costs several seconds; per-page boot would dominate).
// tesseract is lazy-imported so text PDFs never pay for the OCR bundle.
async function ocrPdfPages(
  pdf: PdfDocument,
  pageCount: number,
  maxChars: number,
  onStage?: (stage: string) => void,
  onPage?: (page: number, total: number) => void,
): Promise<string> {
  onStage?.("pdf:ocr-loading-engine");
  const { createWorker } = await import("tesseract.js");
  const workerInit = createWorker("eng", 1, {});
  const workerTimeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "OCR engine took too long to load. Check your connection and try again.",
          ),
        ),
      OCR_WORKER_INIT_MS,
    ),
  );
  const worker = await Promise.race([workerInit, workerTimeout]);

  // One reusable canvas: assigning width/height resets it between pages, and
  // reusing the backing bitmap keeps peak memory flat on a 50-page scan
  // (mobile Safari/Chrome kill tabs long before they throw OOM).
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare pages for OCR.");

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    let out = "";
    for (let i = 1; i <= pageCount; i++) {
      onStage?.(`pdf:ocr-page-${i}/${pageCount}`);
      onPage?.(i, pageCount);

      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        OCR_MAX_RENDER_SCALE,
        Math.max(1, OCR_TARGET_LONG_EDGE_PX / Math.max(base.width, base.height)),
      );
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));

      // pdf.js renders onto a transparent canvas; tesseract needs an opaque
      // white background or dark scans invert into noise.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;

      const result = await worker.recognize(canvas);
      page.cleanup();

      out += `\n\n[Page ${i}]\n${(result.data.text || "").trim()}`;
      if (out.length >= maxChars) {
        out = out.slice(0, maxChars) + "\n\n[...truncated]";
        break;
      }
    }
    return out;
  } finally {
    await worker.terminate();
    // Release the canvas bitmap eagerly - Safari holds it until GC otherwise.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function extractPdfText(
  file: File,
  maxChars = Number.POSITIVE_INFINITY,
  // Diagnostic hook: reports the current step so the caller can record where a
  // crash happened (Android Chrome can kill the tab mid-parse with no error).
  onStage?: (stage: string) => void,
  // Progress hook: fired per page so the UI can show a real progress bar.
  onPage?: (page: number, total: number) => void,
): Promise<{ text: string; pageCount: number }> {
  let pdf: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
  try {
    onStage?.("pdf:reading-bytes");
    const buf = new Uint8Array(await file.arrayBuffer());
    onStage?.("pdf:creating-document");
    pdf = await getDocument({
      data: buf,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
      // Security (CVE-2024-4367): a malicious PDF can smuggle JavaScript through
      // the font path and have pdf.js execute it via eval/Function in the app's
      // origin. We're pinned to pdfjs 3.x for old-iOS-Safari support, so disable
      // the eval-backed code paths instead of relying on a newer release. Text
      // extraction does not need them; pdf.js falls back to its safe interpreter.
      isEvalSupported: false,
      // Don't auto-prompt for passwords - surface a clear error instead.
      password: "",
    }).promise;
    onStage?.("pdf:document-loaded");

    const pageCount = pdf.numPages;
    let out = "";

    for (let i = 1; i <= pageCount; i++) {
      onStage?.(`pdf:reading-page-${i}/${pageCount}`);
      onPage?.(i, pageCount);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((it: unknown) =>
          typeof (it as { str?: string }).str === "string" ? (it as { str: string }).str : "",
        )
        .join(" ");

      out += `\n\n[Page ${i}]\n${pageText}`;
      if (out.length >= maxChars) {
        out = out.slice(0, maxChars) + "\n\n[...truncated]";
        break;
      }
    }

    // No text layer at all -> a scanned/image-only PDF. Small ones get OCR'd
    // here in the browser; big ones are handed back to the caller via the
    // __SCANNED_PDF_LARGE__ sentinel, which routes them to server-side OCR
    // (src/lib/server-ocr.ts) instead of pinning a phone CPU for an hour.
    // NOTE: the "[Page N]" labels make `out` non-empty even when every page is
    // blank, so strip them before judging (same trick as the extract-pdf edge
    // function) - a bare `out.trim()` check never fires.
    if (!out.replace(/\[Page \d+\]/g, "").trim()) {
      if (pageCount > MAX_CLIENT_OCR_PAGES) {
        throw new Error("__SCANNED_PDF_LARGE__");
      }
      out = await ocrPdfPages(pdf, pageCount, maxChars, onStage, onPage);
      // OCR found nothing either (blank pages, extreme noise, non-Latin
      // script) - fall through to the same "scanned" error as before.
      if (!out.replace(/\[Page \d+\]/g, "").trim()) {
        throw new Error("__SCANNED_PDF__");
      }
    }

    return { text: out, pageCount };
  } catch (error) {
    // Always log the raw error - invaluable when a future PDF fails.
    console.error("extract pdf text", {
      name: file.name,
      type: file.type,
      size: file.size,
      error,
    });

    const errAny = error as { name?: string; code?: number; message?: string };
    const message = errAny?.message || "";

    // Routing sentinel, not a user-facing failure: the caller catches this and
    // sends the file to server-side OCR. Must survive the catch untranslated.
    if (message === "__SCANNED_PDF_LARGE__") {
      throw error;
    }

    if (message === "__SCANNED_PDF__") {
      throw new Error(
        "This PDF has no selectable text and OCR couldn't read its pages. Try a clearer scan, or upload the pages as images (PNG/JPG) instead.",
      );
    }

    // pdfjs throws named exceptions for these - match on .name first, then
    // fall back to message text since the legacy build sometimes loses the name.
    if (errAny?.name === "PasswordException" || /password/i.test(message)) {
      throw new Error(
        "This PDF is password-protected. Remove the password (Print → Save as PDF on iPhone usually works) and try again.",
      );
    }

    if (errAny?.name === "InvalidPDFException" || /invalid pdf|corrupt/i.test(message)) {
      throw new Error(
        "This PDF appears to be damaged. Try re-downloading it, or open it once in your PDF reader and save a fresh copy.",
      );
    }

    if (errAny?.name === "MissingPDFException" || /missing pdf/i.test(message)) {
      throw new Error(
        "Could not read this PDF - the file may not have finished downloading from iCloud. Open it in Files first to force a local copy, then try again.",
      );
    }

    if (/out of memory|allocation/i.test(message)) {
      throw new Error(
        "This PDF is too large for your device's browser to parse. Try splitting it into smaller files (under ~50 MB each).",
      );
    }

    // Unknown error - surface the underlying message so the user has
    // something actionable to share with support.
    throw new Error(
      `Could not read this PDF in the browser${message ? `: ${message}` : ""}. Try opening it on a computer and re-saving as a standard PDF.`,
    );
  } finally {
    if (pdf) {
      try {
        await pdf.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
