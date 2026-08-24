// The "five days active" moment — the showing-up half of the upload ladder,
// as distinct from the rank-up half RankUpCelebration already owns.
//
// Reuses the same centred-card shell (progression-moment.tsx) and the same
// pop/resolve animation classes as RankUpCelebration, but there is no bar to
// fill here: five active days is a single crossing, not a range with a
// position inside it, so there is nothing this could sensibly animate FROM.
// The pop-in classes already carry their own timing and their own
// prefers-reduced-motion off-switch (see .gd-moment-badge / .gd-moment-resolve
// in styles.css), so this does not also reach for useMomentReveal — that hook
// exists to keep a bar and a payload in sync, and there is no bar.
//
// Per the owner's "no explaining text, just clean" rule this names the number
// and nothing else — no paragraph about what changed or why, unlike
// RankUpCelebration's footer line, because a rank-up carries other news (a new
// title, a new badge) that this moment does not.

import { Upload } from "lucide-react";
import { MomentOverlay } from "@/components/progression-moment";

/** Long enough to read four words and a number. */
const AUTO_DISMISS_MS = 6000;

export function UploadBonusUnlockCelebration({
  total,
  onDismiss,
}: {
  /** The new daily upload total, or null when there is nothing to show. */
  total: number | null;
  onDismiss: () => void;
}) {
  if (total == null) return null;

  return (
    <MomentOverlay
      open
      labelledBy="gd-upload-bonus-title"
      autoDismissMs={AUTO_DISMISS_MS}
      onDismiss={onDismiss}
    >
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-pop">
        <Upload className="h-3.5 w-3.5" />5 days active
      </div>

      {/* The visible copy is the number and its unit only. The fuller sentence
          screen readers get is not shown on screen - see the header note. */}
      <h2 id="gd-upload-bonus-title" className="sr-only">
        {total} uploads unlocked a day
      </h2>
      <div
        aria-hidden="true"
        className="gd-moment-badge mt-3 font-display text-4xl font-light tabular-nums"
      >
        {total}
      </div>
      <p aria-hidden="true" className="gd-moment-resolve mt-1 text-[13px] text-muted-foreground">
        uploads a day
      </p>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-pop px-4 py-2 text-[12px] font-semibold text-pop-foreground transition-opacity hover:opacity-90"
      >
        Back to it
      </button>
    </MomentOverlay>
  );
}
