// The shared shell for the two progression moments (rank-up, opening streak).
//
// Both are now a CENTRED card rather than a corner toast, which is a stronger
// moment but a much easier way to trap someone. So the posture is deliberate:
//
//   - It is NOT a Radix dialog. No focus trap, no scroll lock, no aria-modal,
//     nothing behind it made inert. It is a `role="status"` announcement that
//     happens to be in the middle of the screen.
//   - Four independent ways out: Escape, the X, clicking the scrim, and an
//     auto-dismiss timer. The student never has to find the close button.
//   - The card paints on .luxury-panel, which is opaque in all four skins
//     (see --panel in styles.css). A centred card over a translucent panel is
//     the exact bug the Personalize dialog had.
//
// The motion is one gesture, used by both cards: THE BAR FILLS, AND WHAT IT IS
// FILLING TOWARD RESOLVES WHEN IT LANDS. Nothing else moves. A pile of
// competing effects reads as noise; one thing arriving reads as a moment.

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { prefersReducedMotion } from "@/lib/progression-moments";

/** Must match the transition on RankProgressBar (rank-badge.tsx). */
export const MOMENT_FILL_MS = 700;
/** A beat after the bar tops out, so the landing reads as a consequence of it. */
const LAND_DELAY_MS = 90;

export type MomentReveal = {
  /** True once the bar is allowed to leave 0 and run to its target. */
  fill: boolean;
  /** True once the bar has arrived — the cue for the badge/flame to land. */
  landed: boolean;
};

/**
 * Drives both phases of the moment.
 *
 * prefers-reduced-motion collapses the whole thing to its end state on the
 * first frame: fully filled bar, badge already in place, nothing animating.
 * The card still appears, still says the same thing, still dismisses.
 */
export function useMomentReveal(active: boolean): MomentReveal {
  const [reveal, setReveal] = useState<MomentReveal>({ fill: false, landed: false });

  useEffect(() => {
    if (!active) {
      setReveal({ fill: false, landed: false });
      return;
    }
    if (prefersReducedMotion()) {
      setReveal({ fill: true, landed: true });
      return;
    }
    // Two frames, not one. The bar has to actually paint at 0% before its width
    // may change, or the browser coalesces both values into a single style
    // recalculation and the bar simply appears pre-filled — which is precisely
    // the "it doesn't animate" complaint this replaces.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReveal({ fill: true, landed: false }));
    });
    const land = window.setTimeout(
      () => setReveal({ fill: true, landed: true }),
      MOMENT_FILL_MS + LAND_DELAY_MS,
    );
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(land);
    };
  }, [active]);

  return reveal;
}

export function MomentOverlay({
  open,
  labelledBy,
  autoDismissMs,
  onDismiss,
  children,
}: {
  open: boolean;
  labelledBy: string;
  autoDismissMs: number;
  onDismiss: () => void;
  children: ReactNode;
}) {
  // Hooks run unconditionally; the early return is below all of them.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [open, autoDismissMs, onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      // A column flex box with `my-auto` on the card, rather than
      // `items-center`. Both centre it, but auto margins collapse to zero when
      // the card is taller than the space (a short landscape phone), so it
      // scrolls from the top instead of having its head cut off above the
      // scroll origin — which is what `items-center` would do here.
      className="fixed inset-0 z-[120] flex flex-col items-center overflow-y-auto px-4"
      // env() in an inline style rather than an arbitrary Tailwind class: the
      // Capacitor build runs under a notch and a home indicator, and the card is
      // centred in whatever is left between them.
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        aria-hidden="true"
        onClick={onDismiss}
        className="gd-moment-scrim absolute inset-0 bg-black/60"
      />
      <div
        role="status"
        aria-live="polite"
        aria-labelledby={labelledBy}
        // 22rem caps it well inside a 360px phone (which leaves 328px here), and
        // the card is centred by flex rather than by a translate, so the
        // entrance animation owns `transform` outright and cannot knock it
        // off-centre — the trap the old corner cards had to work around.
        className="gd-moment-card luxury-panel relative my-auto w-[min(22rem,100%)] shrink-0 rounded-2xl p-5 text-center shadow-elegant"
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
