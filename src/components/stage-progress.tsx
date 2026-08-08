// A progress line for a wait made of real, discrete awaited steps.
//
// Two rules it exists to keep:
//
// 1. No invented percentage. Nothing between the click and the questions knows
//    what fraction of the work is done — the model call has no progress channel —
//    so a bar claiming 60% is a guess the student can feel when it stalls. This
//    reports "Step 2 of 3" and names the step, and the step only advances when
//    the awaited call it names has actually returned. Nothing interpolates.
//
// 2. Failure lands. If a step throws, the line stops on that step and says what
//    broke, instead of animating forever over a request that is already dead.
//
// Visually this is the chat page's answer loader (`gd-forming-*`): the same orb
// and the same rising, sheening status word, so the app has one language for
// "working on it" rather than two. The reduced-motion and low-power guards for
// those classes already live in styles.css.
import { AlertTriangle } from "lucide-react";

export type ProgressStage = {
  key: string;
  /** Named for the work actually happening, e.g. "Writing your questions". */
  label: string;
  /** Optional line under the label. Worth using on the long step. */
  note?: string;
};

export function StageProgress({
  stages,
  currentIndex,
  error,
  className = "",
}: {
  stages: readonly ProgressStage[];
  /** Index of the stage now in flight — or, when `error` is set, the one that failed. */
  currentIndex: number;
  /** Non-null stops the line and shows the failure on the current stage. */
  error?: string | null;
  className?: string;
}) {
  if (!stages.length) return null;
  const index = Math.min(Math.max(currentIndex, 0), stages.length - 1);
  const stage = stages[index];
  const failed = Boolean(error);

  return (
    <div
      className={`rounded-xl border p-3 ${failed ? "border-destructive/30 bg-destructive/5" : "border-border"} ${className}`}
      role="status"
      aria-live="polite"
      aria-busy={!failed}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Step {index + 1} of {stages.length}
        </span>
        {failed && <span className="text-[11px] font-semibold text-destructive">Stopped</span>}
      </div>

      {failed ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {stage.label} failed. {error}
          </span>
        </p>
      ) : (
        <span className="gd-forming-status mt-1.5">
          <span className="gd-forming-orb" aria-hidden="true" />
          {/* key re-mounts the word so its rise-in plays on each real advance. */}
          <span key={stage.key} className="gd-forming-label">
            {stage.label}…
          </span>
        </span>
      )}

      {/* One segment per real step. Filled = finished, not = a fraction guessed. */}
      <div className="mt-2.5 flex gap-1" aria-hidden="true">
        {stages.map((item, position) => (
          <span
            key={item.key}
            className={`h-1 flex-1 rounded-full ${
              position < index
                ? "bg-pop"
                : position === index
                  ? failed
                    ? "bg-destructive"
                    : "bg-pop/60 animate-pulse motion-reduce:animate-none"
                  : "bg-foreground/10"
            }`}
          />
        ))}
      </div>

      {!failed && stage.note && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{stage.note}</p>
      )}
    </div>
  );
}
