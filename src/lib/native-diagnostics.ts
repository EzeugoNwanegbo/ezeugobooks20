// TEMPORARY on-device diagnostics for the native (Capacitor) app.
//
// Symptom: keyboard opens, user types a few words, then the WHOLE APP FREEZES,
// and typed text doesn't appear. No JS error is thrown. Web login works on the
// same phone's browser, so this is WebView-specific. This overlay (pinned to the
// TOP so the keyboard can't cover it) records every focus/keystroke/input event
// so the LAST line before the freeze tells us exactly what locked up.
//
// Remove this (and its call in main.tsx) once the input bug is fixed.

const MAX_LINES = 16;

export function initNativeDiagnostics(): void {
  if (typeof window === "undefined") return;

  let panel: HTMLDivElement | null = null;
  const lines: string[] = [];

  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const render = () => {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "gd-native-diag";
      // Pinned to the TOP, above everything, ignoring pointer events so it can
      // never steal taps. Padded for the status bar / notch.
      panel.style.cssText =
        "position:fixed;left:0;right:0;top:0;z-index:2147483647;max-height:46vh;overflow:hidden;" +
        "background:rgba(0,0,0,.9);color:#7CFC9A;font:11px/1.3 monospace;" +
        "padding:calc(env(safe-area-inset-top) + 6px) 10px 8px;white-space:pre-wrap;" +
        "word-break:break-word;pointer-events:none;border-bottom:1px solid #2a2a2a;";
      document.body.appendChild(panel);
    }
    panel.textContent = `DIAG ${stamp()}\n` + lines.slice(-MAX_LINES).join("\n");
  };

  const log = (msg: string) => {
    lines.push(`${stamp()} ${msg}`);
    // ALSO log to console → surfaces in `adb logcat` (tag chromium) regardless
    // of whether the WebView is repainting. This distinguishes "input never
    // arrives" from "input arrives but screen doesn't repaint".
    try {
      console.log(`GDDIAG ${stamp()} ${msg}`);
    } catch {
      /* ignore */
    }
    try {
      render();
    } catch {
      /* logging must never throw and mask the bug */
    }
  };

  const describe = (el: EventTarget | null): string => {
    if (!(el instanceof HTMLElement)) return "?";
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    return type ? `${tag}[${type}]` : tag;
  };

  document.addEventListener("focusin", (e) => log(`focusin ${describe(e.target)}`), true);
  document.addEventListener(
    "keydown",
    (e) => {
      log(`keydown ${(e as KeyboardEvent).key}`);
      // After the event settles, report the focused field's value length -
      // reveals whether the DOM value changed even if the screen never painted.
      setTimeout(() => {
        const a = document.activeElement as HTMLInputElement | null;
        if (a && "value" in a) log(`  active ${describe(a)} val=${a.value.length}`);
      }, 0);
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      const target = e.target as HTMLInputElement | null;
      const len = target && "value" in target ? target.value.length : -1;
      log(`input ${describe(e.target)} len=${len}`);
    },
    true,
  );
  document.addEventListener("compositionstart", () => log("compositionstart"), true);
  document.addEventListener(
    "compositionupdate",
    (e) => log(`compupdate "${(e as CompositionEvent).data}"`),
    true,
  );
  document.addEventListener(
    "compositionend",
    (e) => log(`compend "${(e as CompositionEvent).data}"`),
    true,
  );

  const vv = window.visualViewport;
  if (vv) vv.addEventListener("resize", () => log(`vv ${Math.round(vv.height)}h`));

  // Freeze watchdog: when the interval is delayed a lot, the JS thread was
  // blocked. Reports once the thread frees up (if it ever does).
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap > 1000) log(`!! FROZE ~${gap}ms`);
  }, 250);

  log(`ready ${window.innerWidth}x${window.innerHeight}`);
}
