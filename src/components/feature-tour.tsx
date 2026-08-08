// The spotlight overlay that walks a new student through the app.
//
// It dims the page, cuts a hole around the element the current step is about,
// and floats a card next to it. Anchors are found by `data-tour="..."`, polled
// on every frame while a step is showing - that one loop covers route changes,
// the mobile drawer sliding open, smooth scrolling, resize, and lazy content,
// without any of them needing to notify the tour.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { TOUR_STEPS, markTourSeen } from "@/lib/feature-tour";

type Box = { top: number; left: number; width: number; height: number };

const CARD_WIDTH = 340;
const GAP = 14;
const EDGE = 12;
// Roughly the tallest a card gets; only used to decide above/below before the
// real height is measured on the first frame.
const CARD_HEIGHT_ESTIMATE = 190;

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

export function FeatureTour({
  open,
  onClose,
  onOpenMobileNav,
  onCloseMobileNav,
}: {
  open: boolean;
  onClose: () => void;
  /** Reveals drawer-only anchors on small screens. */
  onOpenMobileNav?: () => void;
  onCloseMobileNav?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT_ESTIMATE);
  const cardRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<Box | null>(null);
  const scrolledForStep = useRef<string | null>(null);

  const step = TOUR_STEPS[Math.min(index, TOUR_STEPS.length - 1)]!;
  const isLast = index >= TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    markTourSeen();
    onCloseMobileNav?.();
    setIndex(0);
    onClose();
  }, [onClose, onCloseMobileNav]);

  // Restart from the top whenever the tour is reopened.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Put the app in the state this step describes: right route, drawer open or
  // shut. Kept separate from the measuring loop so it runs once per step.
  useEffect(() => {
    if (!open) return;
    if (step.route && !location.pathname.startsWith(step.route)) {
      navigate({ to: step.route });
    }
    if (step.needsMobileNav && isMobileViewport()) onOpenMobileNav?.();
    else onCloseMobileNav?.();
    scrolledForStep.current = null;
    // location.pathname is intentionally omitted: reacting to it would re-run
    // this on the navigation it just triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step.id]);

  // Track the anchor's position for as long as the step is showing.
  useEffect(() => {
    if (!open) return;
    if (!step.anchor) {
      boxRef.current = null;
      setBox(null);
      return;
    }

    let frame = 0;
    const tick = () => {
      // Several anchors exist twice - once in the desktop sidebar/header and
      // once in the mobile drawer/pill row - with the inactive copy hidden at
      // zero size. Take the first one actually laid out.
      const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${step.anchor}"]`);
      let element: HTMLElement | null = null;
      let rect: DOMRect | undefined;
      for (const candidate of candidates) {
        const candidateRect = candidate.getBoundingClientRect();
        if (candidateRect.width > 0 && candidateRect.height > 0) {
          element = candidate;
          rect = candidateRect;
          break;
        }
      }
      const visible = Boolean(rect);
      const next: Box | null = rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : null;

      // Bring an off-screen anchor into view once per step, then let the loop
      // follow it as the smooth scroll settles.
      if (element && rect && visible && scrolledForStep.current !== step.id) {
        const margin = 80;
        if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
          element.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        scrolledForStep.current = step.id;
      }

      if (!sameBox(boxRef.current, next)) {
        boxRef.current = next;
        setBox(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, step.anchor, step.id]);

  useLayoutEffect(() => {
    if (!open) return;
    const height = cardRef.current?.offsetHeight;
    if (height) setCardHeight(height);
  }, [open, step.id, box]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;

  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - EDGE * 2);

  // Centred when there is nothing to point at; otherwise below the anchor, or
  // above it when below would run off the bottom.
  let cardTop: number;
  let cardLeft: number;
  if (!box) {
    cardTop = Math.max(EDGE, viewportHeight / 2 - cardHeight / 2);
    cardLeft = Math.max(EDGE, viewportWidth / 2 - width / 2);
  } else {
    const below = box.top + box.height + GAP;
    const above = box.top - GAP - cardHeight;
    cardTop = below + cardHeight <= viewportHeight - EDGE ? below : Math.max(EDGE, above);
    cardLeft = Math.min(
      Math.max(EDGE, box.left + box.width / 2 - width / 2),
      viewportWidth - width - EDGE,
    );
  }

  return (
    <div className="gd-feature-tour" role="dialog" aria-modal="true" aria-label="App guide">
      {/* Swallows every click on the app underneath, so the tour drives. */}
      <div className="fixed inset-0 z-[190]" onClick={(event) => event.stopPropagation()} />

      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[195] rounded-xl transition-[top,left,width,height] duration-200 ease-out"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            // Warm-neutral scrim so the dimmed page stays the palette's Black
            // rather than the old cool navy-black.
            boxShadow: "0 0 0 9999px rgba(7, 7, 7, 0.72)",
            outline: "2px solid var(--pop, #a58763)",
            outlineOffset: 0,
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 z-[195] bg-[rgba(7,7,7,0.72)]" />
      )}

      <div
        ref={cardRef}
        className="fixed z-[200] rounded-2xl border border-border/70 bg-background p-4 shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
        style={{ top: cardTop, left: cardLeft, width }}
      >
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {index + 1} of {TOUR_STEPS.length}
          </p>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip the guide"
            className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {step.title}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1" aria-hidden="true">
            {TOUR_STEPS.map((item, itemIndex) => (
              <span
                key={item.id}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  itemIndex === index ? "w-4 bg-pop" : "w-1.5 bg-foreground/15"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pop px-3 py-1.5 text-[12px] font-semibold text-pop-foreground transition-opacity hover:opacity-90"
            >
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Got it
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
