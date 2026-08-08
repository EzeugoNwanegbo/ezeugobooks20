// The rank-up moment.
//
// Three rules, in priority order:
//   1. It must never stand between a student and their work. So: no scrim, no
//      focus steal, no aria-modal, nothing behind it disabled. Same posture as
//      library-announcement.tsx — this is an announcement, not an interruption.
//   2. It must be skippable. Escape, the X, or the button all dismiss it, and
//      it also retires itself after a few seconds on its own.
//   3. It must respect prefers-reduced-motion. The entrance, the badge pop and
//      the sweep across the bar are all motion-gated; the card still appears
//      and still says the same thing, it just does not move.
//
// It fires at most once per rank per device — see takeRankCelebration() in
// src/lib/progression-moments.ts, which is what decides whether this mounts.

import { useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { uploadBonusGain, type AcademicRank } from "@/lib/ranks";
import { BASE_DAILY_UPLOADS } from "@/lib/allowances";

/** Long enough to read two short lines, short enough not to linger. */
const AUTO_DISMISS_MS = 6500;

export function RankUpCelebration({
  rank,
  onDismiss,
}: {
  rank: AcademicRank | null;
  onDismiss: () => void;
}) {
  // Hooks run unconditionally; the early return below is after all of them.
  useEffect(() => {
    if (!rank) return;
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [rank, onDismiss]);

  useEffect(() => {
    if (!rank) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rank, onDismiss]);

  if (!rank) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby="gd-rankup-title"
      // Phones: under the mobile top bar and clear of the composer. Wider
      // screens: bottom-right. z-[120] matches the announcement card, keeping
      // it below the tour overlay and any real dialog.
      className="gd-rankup fixed left-1/2 top-[calc(3.5rem+env(safe-area-inset-top))] z-[120] w-[min(21rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-pop/40 bg-surface p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:bottom-4 sm:left-auto sm:right-4 sm:top-auto sm:translate-x-0"
    >
      <div className="flex items-start gap-3">
        <span className="gd-rankup-badge">
          <RankBadge rank={rank} size="lg" className="h-11 w-11 rounded-xl" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-pop">
            <Sparkles className="h-3.5 w-3.5" />
            Rank up
          </div>
          <h2
            id="gd-rankup-title"
            className="mt-0.5 truncate text-base font-semibold tracking-[-0.02em] text-foreground"
          >
            {rank.name}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {/* Only claim an upload gain when this rank actually raises the
                number. Several ranks share a bonus, and "+10 uploads a day" on
                a rank that changed nothing is a promise the Library breaks. */}
            {uploadBonusGain(rank) > 0
              ? `${rank.threshold.toLocaleString()} points. Your daily uploads go up to ${BASE_DAILY_UPLOADS + rank.uploadBonus}.`
              : `${rank.threshold.toLocaleString()} points. Keep the streak and the next one is close.`}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-pop px-3 py-1.5 text-[12px] font-semibold text-pop-foreground transition-opacity hover:opacity-90"
          >
            Back to it
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
