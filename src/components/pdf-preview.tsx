// In-app PDF preview: see the file before deciding to download it.
//
// Detailed+ answers can be turned into a study-notes PDF (src/lib/notes-pdf.ts).
// That used to go straight to the browser's download folder, so the only way to
// find out what the PDF looked like was to save it and open it. This renders the
// real pages inline in the answer — same bytes the download hands over — with an
// expand-to-full-screen reader for a proper read-through.
//
// Pages are painted to <canvas> via pdfjs rather than embedded with <iframe>;
// see src/lib/pdf-render.ts for why that matters on mobile and in the native app.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Download, Loader2, Maximize2, X } from "lucide-react";
import {
  getPdfPageAspect,
  openPdfBytes,
  renderPdfPage,
  type RenderablePdf,
} from "@/lib/pdf-render";

// A page wider than this stops gaining legibility and starts costing memory.
const MAX_PAGE_WIDTH = 900;
// Fallback proportions (A4 portrait) while a page's real aspect is unknown.
const DEFAULT_ASPECT = 297 / 210;

/** One rendered page. Paints only once it is near the viewport. */
function PdfPage({
  pdf,
  pageNumber,
  width,
  eager = false,
}: {
  pdf: RenderablePdf;
  pageNumber: number;
  width: number;
  eager?: boolean;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [visible, setVisible] = useState(eager);
  const [painted, setPainted] = useState(false);

  // Real page proportions, so the placeholder reserves the right space and the
  // scroll position doesn't jump as pages paint in.
  useEffect(() => {
    let active = true;
    getPdfPageAspect(pdf, pageNumber)
      .then((value) => {
        if (active) setAspect(value);
      })
      .catch(() => {
        /* keep the A4 fallback */
      });
    return () => {
      active = false;
    };
  }, [pdf, pageNumber]);

  // In the full-screen reader a long document would otherwise paint every page
  // at once; only pages within a screen or so of the viewport are drawn.
  useEffect(() => {
    if (eager || visible) return;
    const holder = holderRef.current;
    if (!holder || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, [eager, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || width <= 0) return;

    setPainted(false);
    const render = renderPdfPage(pdf, pageNumber, canvas, width);
    let active = true;
    render.done
      .then(() => {
        if (active) setPainted(true);
      })
      .catch((error) => {
        console.error("pdf preview page", error);
      });
    return () => {
      active = false;
      render.cancel();
    };
  }, [pdf, pageNumber, width, visible]);

  return (
    <div
      ref={holderRef}
      className="gd-pdf-page relative mx-auto bg-white shadow-[0_1px_10px_-4px_rgba(0,0,0,0.45)] ring-1 ring-black/10"
      style={{ width, aspectRatio: `1 / ${aspect ?? DEFAULT_ASPECT}` }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`Page ${pageNumber}`} />
      {!painted && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-black/30" />
        </div>
      )}
    </div>
  );
}

/** Tracks an element's content width so pages render at their true CSS size. */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export type PdfPreviewProps = {
  bytes: Uint8Array;
  filename: string;
  title: string;
  /** True once the file has been written to the student's downloads. */
  saved?: boolean;
  onDownload: () => void;
  onDismiss?: () => void;
};

export default function PdfPreview({
  bytes,
  filename,
  title,
  saved = false,
  onDownload,
  onDismiss,
}: PdfPreviewProps) {
  const [pdf, setPdf] = useState<RenderablePdf | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frameRef, frameWidth] = useMeasuredWidth<HTMLDivElement>();
  const [sheetRef, sheetWidth] = useMeasuredWidth<HTMLDivElement>();

  useEffect(() => {
    let active = true;
    let opened: RenderablePdf | null = null;

    openPdfBytes(bytes)
      .then((doc) => {
        opened = doc;
        if (!active) {
          void doc.destroy();
          return;
        }
        setPdf(doc);
        setPageCount(doc.numPages);
      })
      .catch((error) => {
        console.error("pdf preview open", error);
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      // Frees the worker's copy of the document; the caller still holds `bytes`.
      void opened?.destroy();
    };
  }, [bytes]);

  // Full-screen reader: Esc closes it, and the page behind it must not scroll.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        <span className="text-muted-foreground">Couldn't render the preview.</span>
        <button
          type="button"
          onClick={onDownload}
          className="font-medium text-pop underline-offset-2 hover:underline"
        >
          Download the PDF instead
        </button>
      </div>
    );
  }

  const pageWidth = Math.min(MAX_PAGE_WIDTH, Math.max(0, frameWidth - 24));
  const sheetPageWidth = Math.min(MAX_PAGE_WIDTH, Math.max(0, sheetWidth - 24));
  const canPage = pageCount > 1;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12.5px] font-medium text-foreground">{title}</p>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {pageCount ? `${page} / ${pageCount}` : "…"}
        </span>
      </div>

      {/* The preview window itself — a fixed slice of the screen, not the page. */}
      <div
        ref={frameRef}
        className="mt-2 flex max-h-[52vh] min-h-[180px] items-start justify-center overflow-y-auto overscroll-contain rounded-lg bg-foreground/[0.06] p-3"
      >
        {pdf && pageWidth > 0 ? (
          <PdfPage pdf={pdf} pageNumber={page} width={pageWidth} eager />
        ) : (
          <div className="flex h-[180px] items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Preparing preview…
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {canPage && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount}
              aria-label="Next page"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-35"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={!pdf}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-50"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Expand
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 rounded-lg bg-pop px-2.5 py-1 text-[12px] font-medium text-pop-foreground transition-opacity hover:opacity-90"
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          {saved ? "Download again" : "Download PDF"}
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            Close
          </button>
        )}
        {saved && (
          <span className="text-[11.5px] text-muted-foreground">Saved to your downloads.</span>
        )}
      </div>

      {expanded &&
        pdf &&
        typeof document !== "undefined" &&
        // Portalled to <body>: the answer bubble clips and transforms its
        // children, which would trap a fixed-position overlay inside it.
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={`${title} preview`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {filename} · {pageCount} {pageCount === 1 ? "page" : "pages"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDownload}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-pop px-3 py-1.5 text-[12.5px] font-medium text-pop-foreground transition-opacity hover:opacity-90"
                >
                  {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  <span className="hidden sm:inline">{saved ? "Saved" : "Download"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close preview"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Continuous scroll — reading a document, not clicking through it. */}
            <div ref={sheetRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <div className="flex flex-col items-center gap-4">
                {sheetPageWidth > 0 &&
                  Array.from({ length: pageCount }, (_, index) => (
                    <PdfPage
                      key={index + 1}
                      pdf={pdf}
                      pageNumber={index + 1}
                      width={sheetPageWidth}
                      eager={index === 0}
                    />
                  ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
