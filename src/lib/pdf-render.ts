// Rendering PDFs to canvas, for previewing a file in the app before it is ever
// downloaded. Deliberately separate from src/lib/pdf.ts: that module is the
// *extraction* pipeline (text + OCR of files the student uploads), this one only
// paints pages. Both talk to the same pdfjs legacy build, so the browser loads
// one copy either way.
//
// Canvas, not <iframe>/<embed>: the Android WebView the native app ships in
// refuses to render a PDF in an iframe (it offers a download instead), and iOS
// only shows the first page. Painting pages ourselves is the one approach that
// behaves identically on desktop, mobile Safari and the Capacitor shell.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";

GlobalWorkerOptions.workerSrc = workerUrl;

// Same CDN data files as the extraction path (see src/lib/pdf.ts) - a PDF with
// subset or non-Latin fonts needs them to draw correctly.
const PDFJS_VERSION = "3.11.174";
const CMAP_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
const STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;

// Retina looks better, but a 3x canvas of an A4 page is ~35 MB of pixels and
// will be evicted (or crash the tab) on a mid-range phone. 2 is the ceiling.
const MAX_DEVICE_PIXEL_RATIO = 2;

export type RenderablePdf = Awaited<ReturnType<typeof getDocument>["promise"]>;

/**
 * Open in-memory PDF bytes for rendering. The caller keeps ownership of `bytes`
 * (they are usually also headed for the download), so a copy is handed to pdfjs
 * — it takes the buffer over and would otherwise leave the original detached.
 */
export async function openPdfBytes(bytes: Uint8Array): Promise<RenderablePdf> {
  return getDocument({
    data: bytes.slice(),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    isEvalSupported: false,
  }).promise;
}

/** Page proportions, so a placeholder can hold the right space before paint. */
export async function getPdfPageAspect(pdf: RenderablePdf, pageNumber: number): Promise<number> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return viewport.height / viewport.width;
}

/**
 * Paint one page into `canvas`, sized to `cssWidth` CSS pixels wide.
 *
 * Returns `{ done, cancel }` rather than a bare promise: page renders are
 * interruptible and MUST be stopped when the viewer pages away or resizes, or
 * two paints end up racing for the same canvas and the loser leaves a half-drawn
 * page on screen. `cancel` is safe to call at any point, including before the
 * page has even been fetched.
 */
export function renderPdfPage(
  pdf: RenderablePdf,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): { done: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let task: { cancel: () => void; promise: Promise<void> } | null = null;

  const done = (async () => {
    const page = await pdf.getPage(pageNumber);
    if (cancelled) return;

    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(
      MAX_DEVICE_PIXEL_RATIO,
      typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    );
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${Math.round(viewport.height / dpr)}px`;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d context unavailable");
    // pdf.js draws onto transparency; the page stock is white.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    task = page.render({ canvasContext: context, viewport });
    try {
      await task.promise;
    } catch (error) {
      // A cancelled render is the expected outcome of paging away, not a failure.
      if ((error as { name?: string })?.name !== "RenderingCancelledException") throw error;
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}
