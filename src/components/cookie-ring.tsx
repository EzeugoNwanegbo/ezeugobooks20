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

/**
 * When the ring turns amber - the same amber -app.practice-page.tsx already
 * uses for warnings, not a second warning colour.
 *
 * A FRACTION, NOT A COUNT. This was a flat `remaining <= 10`, which was a
 * sensible fifth of the day when the allowance was the 30-60 earned ladder.
 * The allowance is now 15 (supabase/migrations/20260829120000_cookie_budget_15.sql),
 * and a fixed 10 against 15 means the meter is amber from the fifth message of
 * the morning until midnight - two thirds of every day spent looking like an
 * emergency, which is how a warning colour stops meaning anything. A fifth of
 * whatever the allowance happens to be says the same thing at 15, at 60, and at
 * 200 after a grant, and never needs editing again when the number moves.
 *
 * The floor of 2 is for very small allowances, where a fifth would round to
 * zero or one and the warning would arrive at the same moment as the refusal.
 */
function isLow(remaining: number, allowance: number): boolean {
  return remaining <= Math.max(2, Math.ceil(allowance * 0.2));
}

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
  const low = isLow(safeRemaining, safeAllowance);

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
