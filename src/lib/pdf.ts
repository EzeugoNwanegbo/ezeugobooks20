// pdfjs-dist 3.x legacy build supports iOS Safari ~11+ and does NOT use
// Promise.withResolvers (the ES2024 API that breaks pre-iOS-17.4 Safari in
// pdfjs 4.x/5.x). UMD `.js` files instead of `.mjs`.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
import { annotateBookPages } from "@/lib/book-pages";

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

/**
 * How many pages to OCR at once.
 *
 * Sized by MEMORY, not by cores. Every page in flight holds a full-size canvas
 * bitmap (~17 MB of RGBA at our render target) plus that worker's tesseract
 * wasm heap, and mobile browsers kill the tab rather than throw, so phones stay
 * low however many cores they report. One core is left free so the tab stays
 * responsive - an upload that freezes the UI reads as broken even when it is
 * making progress.
 */
function ocrPoolSize(pageCount: number): number {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const cores = nav?.hardwareConcurrency || 2;
  const mobile = /Android|iPhone|iPad|iPod/i.test(nav?.userAgent ?? "");
  return Math.max(1, Math.min(mobile ? 2 : 4, cores - 1, pageCount));
}

// OCR pass for scanned PDFs: render each page to an offscreen canvas via
// pdf.js, then run tesseract over the pixels - the same engine and parameters
// as image uploads (src/lib/image-ocr.ts). tesseract is lazy-imported so text
// PDFs never pay for the OCR bundle.
//
// WHY A POOL. This used to be a single worker walking the pages in order, on
// the reasoning that worker boot costs several seconds so one boot beats fifty.
// That reasoning is sound and still holds - but it put the entire job on one
// core, and recognising a page costs far more than booting a worker does. A
// 50-page scan ran for minutes with every other core idle. Now a small pool
// boots once, concurrently, and each worker pulls the next page off a shared
// counter, so the boot cost is still paid once while the recognise time
// divides by the pool size.
//
// Each worker owns its own canvas for the whole run. Sharing one canvas is what
// forced the old sequential shape: a canvas being recognised cannot also be the
// canvas the next page renders onto.
async function ocrPdfPages(
  pdf: PdfDocument,
  pageCount: number,
  maxChars: number,
  onStage?: (stage: string) => void,
  onPage?: (page: number, total: number) => void,
): Promise<string> {
  onStage?.("pdf:ocr-loading-engine");
  const { createWorker } = await import("tesseract.js");

  const poolSize = ocrPoolSize(pageCount);
  const workerTimeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(new Error("OCR engine took too long to load. Check your connection and try again.")),
      OCR_WORKER_INIT_MS,
    ),
  );

  // Boot the pool in parallel so the pool costs the same wall-clock wait as the
  // single worker did. The timeout covers the whole boot, not each worker.
  const workers = await Promise.race([
    Promise.all(Array.from({ length: poolSize }, () => createWorker("eng", 1, {}))),
    workerTimeout,
  ]);

  const canvases = workers.map(() => document.createElement("canvas"));
  const contexts = canvases.map((canvas) => canvas.getContext("2d"));
  if (contexts.some((context) => !context)) {
    await Promise.all(workers.map((worker) => worker.terminate()));
    throw new Error("Could not prepare pages for OCR.");
  }

  // Page text lands here by index, never by append order: with several workers
  // in flight the pages finish out of order, and a scan reassembled out of
  // order is worse than no scan at all.
  //
  // null means "never processed" (we halted before claiming it) and is skipped
  // on reassembly; "" means "processed, genuinely blank" and still earns its
  // [Page N] marker, because a blank page inside a scan is information.
  const pageText = new Array<string | null>(pageCount).fill(null);

  let nextPage = 1; // shared counter - JS is single-threaded, so ++ is atomic here
  let charTotal = 0;
  let halted = false;
  let completed = 0;

  try {
    await Promise.all(
      workers.map(async (worker, slot) => {
        const canvas = canvases[slot];
        const context = contexts[slot]!;

        await worker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });

        for (;;) {
          if (halted) return;
          const i = nextPage++;
          if (i > pageCount) return;

          const page = await pdf.getPage(i);
          try {
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(
              OCR_MAX_RENDER_SCALE,
              Math.max(1, OCR_TARGET_LONG_EDGE_PX / Math.max(base.width, base.height)),
            );
            const viewport = page.getViewport({ scale });
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));

            // pdf.js renders onto a transparent canvas; tesseract needs an
            // opaque white background or dark scans invert into noise.
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: context, viewport }).promise;

            const result = await worker.recognize(canvas);
            pageText[i - 1] = (result.data.text || "").trim();
          } finally {
            page.cleanup();
          }

          // Progress is pages DONE, not the page number just claimed: with a
          // pool the highest claimed number runs ahead of the real count and
          // the bar would jump.
          completed += 1;
          onStage?.(`pdf:ocr-page-${completed}/${pageCount}`);
          onPage?.(completed, pageCount);

          charTotal += pageText[i - 1]?.length ?? 0;
          // Stop claiming new pages once we already have more text than the
          // caller will keep. Pages already in flight still finish and are
          // still used - they are paid for either way.
          if (charTotal >= maxChars) halted = true;
        }
      }),
    );

    let out = "";
    for (let i = 1; i <= pageCount; i++) {
      const text = pageText[i - 1];
      if (text === null) continue; // never claimed - we stopped before reaching it
      out += `\n\n[Page ${i}]\n${text}`;
      if (out.length >= maxChars) {
        out = out.slice(0, maxChars) + "\n\n[...truncated]";
        break;
      }
    }
    return out;
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    // Release the canvas bitmaps eagerly - Safari holds them until GC otherwise.
    canvases.forEach((canvas) => {
      canvas.width = 0;
      canvas.height = 0;
    });
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

    // The sheet number is not the number printed on the page: a scanned
    // textbook carries a cover, contents and preface first, so sheet 47 is
    // printed page 23. Citing the sheet sends a student to the wrong chapter of
    // the physical book. Done here, once, so the text layer and the OCR pool
    // both get it. A no-op when no consistent offset exists.
    return { text: annotateBookPages(out), pageCount };
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
