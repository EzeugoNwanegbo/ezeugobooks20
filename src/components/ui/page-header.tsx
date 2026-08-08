import type { ReactNode } from "react";

// The shared top-of-page header used across the app: a small accent eyebrow, a
// light display title, an optional subtitle, and an optional actions slot
// (search, primary button). Keeps every screen's header rhythm identical.
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className = "",
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <span className="gd-eyebrow inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.16em] text-pop">
          {eyebrow}
        </span>
        <h1 className="mt-2 text-balance font-display text-3xl font-light tracking-[-0.02em] text-foreground sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
