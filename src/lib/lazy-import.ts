// Dynamic imports that survive a deploy happening while the tab is open.
//
// Every code-split chunk carries a content hash in its filename (e.g.
// `pdf-BT5q_uiQ.js`). When a new deploy ships, the old hashed files are
// replaced. A tab that was opened before the deploy still holds the OLD chunk
// names in memory, so the first time it lazy-loads a chunk it hasn't fetched
// yet, it requests a filename that no longer exists on the server and gets:
//   "Failed to fetch dynamically imported module: .../pdf-BT5q_uiQ.js"
// Cache headers can't help — the page is already loaded with stale references.
// The only real recovery is to reload once: the fresh index.html points at the
// current chunk names.

const RELOAD_FLAG = "gd-chunk-reload-at";
// If a reload doesn't fix it within this window, it's a genuine failure (a
// truly broken deploy, offline, etc.) — stop reloading and let the error show
// so we never trap the user in a reload loop.
const RELOAD_COOLDOWN_MS = 15_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(message)
  );
}

function reloadedRecently(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_FLAG) || 0);
    return Date.now() - last < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markReloaded(): void {
  try {
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage can be unavailable (private mode / some webviews).
  }
}

function clearReloadGuard(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // best effort
  }
}

// Reload once (guarded against loops). Returns true if a reload was triggered.
function reloadForStaleChunk(): boolean {
  if (typeof window === "undefined" || reloadedRecently()) return false;
  markReloaded();
  window.location.reload();
  return true;
}

/**
 * If `error` is a stale-chunk load failure, reload once to pick up the current
 * build. Returns true when a reload was triggered (the caller should expect the
 * page to navigate away and should not continue).
 */
export function recoverFromChunkError(error: unknown): boolean {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  return reloadForStaleChunk();
}

/**
 * Wrap a dynamic `import()` so a stale-deploy chunk failure reloads the app once
 * instead of surfacing a dead-end error. A healthy load clears the guard so a
 * later deploy can recover again.
 */
export async function importChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const mod = await load();
    clearReloadGuard();
    return mod;
  } catch (error) {
    if (recoverFromChunkError(error)) {
      // A reload is underway; never resolve, so callers don't run against a
      // page that's about to be replaced.
      return new Promise<T>(() => {});
    }
    throw error;
  }
}

/**
 * Global safety net for route-level and any other lazy chunks. Vite fires
 * `vite:preloadError` on the window when a preloaded dynamic import fails;
 * preventing the default stops Vite from throwing, and we reload instead.
 */
export function installChunkReloadHandler(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadForStaleChunk();
  });
}
