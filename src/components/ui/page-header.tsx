import type { ReactNode } from "react";
import { CookieHeaderRing } from "@/components/cookie-header-ring";

// The shared top-of-page header used across the app: a small accent eyebrow, a
// light display title, an optional subtitle, and an optional actions slot
// (search, primary button). Keeps every screen's header rhythm identical.
//
// It also carries the cookie meter, so what is left today is readable at the
// top of a page without opening the sidebar. CookieHeaderRing finds its own
// balance and renders nothing when there is none to show, which is why this
// stays a presentational component with no new props: the alternative was
// passing a balance and an onClick through all ten screens that use this.
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
      className={`gd-page-header flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between ${className}`}
    >
      <div className="gd-page-heading min-w-0 flex-1">
        <span className="gd-eyebrow inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.16em] text-pop">
          {eyebrow}
        </span>
        <h1 className="mt-2 text-balance font-display text-3xl font-medium tracking-[-0.035em] text-foreground sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {/* Mobile already has a credit meter in the shell; reserve this row
          there only when the page supplies actions. */}
      <div
        className={`gd-page-actions shrink-0 flex-wrap items-center gap-2 ${actions ? "flex" : "hidden md:flex"}`}
      >
        <CookieHeaderRing />
        {actions}
      </div>
    </header>
  );
}
