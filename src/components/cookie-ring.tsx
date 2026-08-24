// The cookie meter: a ring, not a bar - the owner's specific ask, so a
// student can see what is left at a glance the same way a phone shows
// battery as a ring rather than a strip.
//
// Inline SVG, two concentric circles: a fixed track and a
// stroke-dashoffset-animated fill. That is the whole mechanism - a circle
// whose stroke-dasharray equals its own circumference can be "unwound" by
// animating stroke-dashoffset, so there is no path math, no canvas, and
// nothing that needs recomputing on resize. No library, matching the house
// rule against new UI vocabulary.
//
// Same 700ms ease-out as RankProgressBar (rank-badge.tsx) and the same
// motion-reduce:transition-none - one motion language for every meter in the
// app, just wrapped around a circle instead of laid out flat.

const VIEWBOX = 36;
const RADIUS = 15;
const STROKE_WIDTH = 3.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Left at or below this, the ring switches to the amber already used for
 *  warnings in -app.practice-page.tsx - not a second warning colour, the same one. */
const LOW_THRESHOLD = 10;

export function CookieRing({
  remaining,
  allowance,
  onClick,
  size = 36,
  className = "",
}: {
  remaining: number;
  allowance: number;
  onClick: () => void;
  size?: number;
  className?: string;
}) {
  // allowance is 0 only in a state that should not render (see the "unavailable"
  // contract in useCookies) - guarded here anyway so a stray 0/0 never divides
  // by zero and draws a full ring that means nothing.
  const safeAllowance = allowance > 0 ? allowance : 1;
  const safeRemaining = Math.max(0, Math.min(remaining, safeAllowance));
  const fraction = safeRemaining / safeAllowance;
  // Rotated -90deg (below) so the arc starts at 12 o'clock and empties
  // clockwise, the direction a countdown reads.
  const dashoffset = CIRCUMFERENCE * (1 - fraction);
  const low = remaining <= LOW_THRESHOLD;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${remaining} of ${allowance} cookies left today`}
      title="Cookies left today"
      className={`relative inline-grid shrink-0 place-items-center rounded-full transition-opacity hover:opacity-80 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width={size}
        height={size}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-foreground/[0.08]"
        />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashoffset}
          className={`transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none ${
            low ? "stroke-amber-600 dark:stroke-amber-400" : "stroke-pop"
          }`}
        />
      </svg>
      {/* aria-hidden: the button's own aria-label already says this once - a
          screen reader must not hear the number a second time from inside it. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center text-[10px] font-semibold tabular-nums"
      >
        {remaining}
      </span>
    </button>
  );
}
