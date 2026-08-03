import { Circle, Moon, Square, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

// Four looks. Neither `brutal` nor `neo` is a light/dark variant — each is its
// own complete skin (see the BRUTALISM and NEOMORPHISM blocks in styles.css),
// so it replaces the .dark/.light class rather than stacking on it.
export type Theme = "dark" | "light" | "brutal" | "neo";

// Dark leads: it is the default, so the cycle starts from what a new student
// actually sees. Anyone who has already chosen a theme keeps their choice —
// this only decides what happens with nothing stored.
const THEMES: Theme[] = ["dark", "light", "brutal", "neo"];
const DEFAULT_THEME: Theme = "dark";

const THEME_STORAGE_KEY = "gd-theme";
// Several toggles can be mounted at once (sidebar, mobile top bar, mobile
// drawer). Without a broadcast, switching in one leaves the others showing a
// stale active state.
const THEME_EVENT = "gd:theme";

// Brutalism runs on paper, so the browser should still paint form controls,
// scrollbars and overscroll for a light background. Neomorphism is a dark
// charcoal skin, so it takes the dark scheme.
const COLOR_SCHEME: Record<Theme, string> = {
  dark: "dark",
  light: "light",
  brutal: "light",
  neo: "dark",
};

const LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  brutal: "Brutal",
  neo: "Soft",
};

const ICONS: Record<Theme, LucideIcon> = {
  dark: Moon,
  light: Sun,
  brutal: Square,
  neo: Circle,
};

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "brutal" || value === "neo";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of THEMES) root.classList.toggle(name, name === theme);
  root.style.colorScheme = COLOR_SCHEME[theme];
}

/** Shared theme state: reads once on mount, then follows the broadcast. */
function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = getStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (isTheme(next)) setThemeState(next);
    };
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the theme still applies for this session.
    }
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  }, []);

  return [theme, setTheme];
}

/**
 * All four themes at once, with the active one marked. Cycling made sense at
 * two or three skins; at four it can take three taps to reach the one you want,
 * and a button captioned with the NEXT theme reads like the current one. This
 * is the control for anywhere with room for it — chiefly the side menu.
 */
export function ThemePicker({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useTheme();

  return (
    <div className={className}>
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Appearance
      </div>
      <div role="radiogroup" aria-label="Theme" className="flex items-center gap-1">
        {THEMES.map((name) => {
          const Icon = ICONS[name];
          const active = name === theme;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${LABELS[name]} theme`}
              title={`${LABELS[name]} theme`}
              onClick={() => setTheme(name)}
              className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg border transition-colors ${
                active
                  ? "border-pop/70 bg-pop/20 text-pop"
                  : "border-border text-muted-foreground hover:border-pop/40 hover:bg-pop/10 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={name === "brutal" ? 3 : 2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The compact cycling control, for places with room for exactly one button —
 * the mobile top bar, the auth and onboarding headers.
 */
export function ThemeToggle({
  className = "",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [theme, setTheme] = useTheme();

  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  // The button has always shown where it takes you, not where you are.
  const Icon = ICONS[nextTheme];

  return (
    <button
      type="button"
      aria-label={`Switch to ${LABELS[nextTheme].toLowerCase()} theme`}
      title={`Switch to ${LABELS[nextTheme].toLowerCase()} theme`}
      onClick={() => setTheme(nextTheme)}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-pop/60 bg-pop/15 text-pop shadow-sm transition-colors hover:bg-pop/25 hover:text-pop ${
        showLabel ? "w-full px-3 text-sm font-medium" : "w-9"
      } ${className}`}
    >
      {/* The heavy stroke is brutal mode's tell at icon size. */}
      <Icon className="h-4 w-4" strokeWidth={nextTheme === "brutal" ? 3 : 2} />
      {showLabel && <span>{LABELS[nextTheme]} mode</span>}
    </button>
  );
}
