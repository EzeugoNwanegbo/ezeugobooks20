// Remembers the last in-app section the user was on, so reopening the app
// returns them where they left off instead of always dumping them on a fixed
// landing screen. Only the section path is stored - the chat page restores its
// own active conversation from its session cache.

const KEY = "gd-last-route";

const ALLOWED = [
  "/app/chat",
  "/app/library",
  "/app/history",
  "/app/studybody",
  "/app/practice",
  "/app/feedback",
  "/app/settings",
] as const;

export type AppRoute = (typeof ALLOWED)[number];

export function rememberRoute(path: string): void {
  try {
    const match = ALLOWED.find((route) => path === route || path.startsWith(`${route}/`));
    if (match) window.localStorage.setItem(KEY, match);
  } catch {
    // localStorage may be unavailable in some embedded webviews - best effort.
  }
}

export function lastRoute(): AppRoute {
  try {
    const stored = window.localStorage.getItem(KEY) as AppRoute | null;
    if (stored && ALLOWED.includes(stored)) return stored;
  } catch {
    // ignore
  }
  return "/app/chat";
}
