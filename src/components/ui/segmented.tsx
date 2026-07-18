import type { ReactNode } from "react";

// Animated segmented control: the active option is highlighted by a coloured
// thumb that slides between equal-width segments (the same motion used in the
// chat composer). Shared so every screen's tabs/toggles animate identically.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  getIcon,
  getLabel,
  getTitle,
  className = "",
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  getIcon?: (option: T) => ReactNode;
  getLabel?: (option: T) => string;
  getTitle?: (option: T) => string;
  className?: string;
}) {
  const count = options.length;
  const activeIndex = Math.max(0, options.indexOf(value));

  return (
    <div
      className={`relative flex rounded-xl border border-border/70 bg-foreground/[0.03] p-0.5 ${className}`}
    >
      <span
        aria-hidden
        className="segmented-thumb pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-lg"
        style={{
          width: `calc((100% - 0.25rem) / ${count})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            title={getTitle?.(option)}
            onClick={() => onChange(option)}
            className={`relative z-10 flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-center text-xs font-medium leading-tight transition-colors sm:px-2.5 ${
              active ? "text-pop-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {getIcon?.(option)}
            {getLabel ? getLabel(option) : option}
          </button>
        );
      })}
    </div>
  );
}
