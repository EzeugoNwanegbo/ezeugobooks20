import { Circle, Moon, Square, Sun } from "lucide-react";
import { useEffect, useState } from "react";

// Four looks, one control, cycled in this order. Neither `brutal` nor `neo` is a
// light/dark variant — each is its own complete skin (see the BRUTALISM and
// NEOMORPHISM blocks in styles.css), so it replaces the .dark/.light class
// rather than stacking on it.
export type Theme = "dark" | "light" | "brutal" | "neo";

// Dark leads: it is the default, so the cycle starts from what a new student
// actually sees. Anyone who has already chosen a theme keeps their choice —
// this only decides what happens with nothing stored.
const THEMES: Theme[] = ["dark", "light", "brutal", "neo"];
const DEFAULT_THEME: Theme = "dark";

const THEME_STORAGE_KEY = "gd-theme";

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
  dark: "Dark mode",
  light: "Light mode",
  brutal: "Brutal mode",
  neo: "Soft mode",
};

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "brutal" || value === "neo";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of THEMES) root.classList.toggle(name, name === theme);
  root.style.colorScheme = COLOR_SCHEME[theme];
}

export function ThemeToggle({
  className = "",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  // The button has always shown where it takes you, not where you are.
  const Icon =
    nextTheme === "dark"
      ? Moon
      : nextTheme === "light"
        ? Sun
        : nextTheme === "brutal"
          ? Square
          : Circle;

  return (
    <button
      type="button"
      aria-label={`Switch to ${LABELS[nextTheme].toLowerCase()}`}
      title={`Switch to ${LABELS[nextTheme].toLowerCase()}`}
      onClick={() => {
        setTheme(nextTheme);
        applyTheme(nextTheme);
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-pop/35 bg-pop/10 text-pop shadow-sm transition-colors hover:bg-pop/20 hover:text-pop ${
        showLabel ? "w-full px-3 text-sm font-medium" : "w-9"
      } ${className}`}
    >
      {/* The heavy stroke is brutal mode's tell at icon size. */}
      <Icon className="h-4 w-4" strokeWidth={nextTheme === "brutal" ? 3 : 2} />
      {showLabel && <span>{LABELS[nextTheme]}</span>}
    </button>
  );
}
