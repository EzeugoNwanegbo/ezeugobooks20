// Shared direction hint for the main-tab slide transition. The tab-swipe gesture
// (MainTabContainer) and the BottomNav set the direction just before navigating;
// the next screen's MainTabContainer consumes it once on mount so it slides in
// from the correct side. Kept module-level (not context) so it survives the
// route swap that happens between two separate screen mounts.

export const TAB_ROUTES = ["/chat", "/library", "/links", "/coach"] as const;

let pendingDir: -1 | 0 | 1 = 0;

export function setPendingDir(dir: -1 | 0 | 1) {
  pendingDir = dir;
}

export function consumePendingDir(): -1 | 0 | 1 {
  const dir = pendingDir;
  pendingDir = 0;
  return dir;
}

export function tabIndex(pathname: string): number {
  const i = (TAB_ROUTES as readonly string[]).indexOf(pathname);
  return i < 0 ? 0 : i;
}
