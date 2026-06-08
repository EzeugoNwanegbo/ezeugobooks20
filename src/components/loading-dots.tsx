// Three dots that bounce in a wave — the app's loading indicator, used in place
// of a spinning ring. Dots inherit the current text colour (bg-current), so
// dropping it inside a button or a `text-primary` wrapper just works.

type Size = "sm" | "md" | "lg";

const DOT: Record<Size, string> = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
  lg: "h-2.5 w-2.5",
};

const GAP: Record<Size, string> = {
  sm: "gap-1",
  md: "gap-1.5",
  lg: "gap-1.5",
};

export function LoadingDots({
  size = "sm",
  className = "",
}: {
  size?: Size;
  className?: string;
}) {
  const dot = DOT[size];
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-flex items-center ${GAP[size]} ${className}`}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`${dot} rounded-full bg-current`}
          style={{
            animation: "gd-dot-wave 1.2s ease-in-out infinite",
            animationDelay: `${index * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}
