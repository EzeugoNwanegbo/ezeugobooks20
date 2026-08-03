import { Capacitor } from "@capacitor/core";

/**
 * True when running inside the Capacitor native shell (the installed app),
 * as opposed to a normal browser tab. Safe to call during module load.
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Bootstraps the native shell. Mirrors what the old Expo WebView wrapper did
 * via injected JS: marks the document as native so the `gd-native-app` /
 * `gd_native_app` styling + behavior (safe-area padding, hidden web chrome,
 * native auth flow) applies to the Capacitor build too. Also configures the
 * Android status bar so the WebView stops drawing underneath it.
 */
export function initNativeShell(): void {
  if (typeof window === "undefined" || !isNativeApp()) return;

  try {
    document.documentElement.classList.add("gd-native-app");
    window.localStorage.setItem("gd_native_app", "1");
  } catch {
    // localStorage can be unavailable in some embedded webviews; the class
    // alone is enough for the CSS to take effect.
    document.documentElement.classList.add("gd-native-app");
  }

  // Catch OAuth redirect deep links (gandd://auth#...) and finish the session.
  void import("./native-auth")
    .then(({ initNativeAuthDeepLinks }) => initNativeAuthDeepLinks())
    .catch(() => {});

  // StatusBar is Android/iOS only. Import lazily so the web bundle never pulls
  // native code, and guard every call.
  void import("@capacitor/status-bar")
    .then(async ({ StatusBar, Style }) => {
      try {
        // Keep the WebView below the status bar instead of behind it, and match
        // the active theme's background so there's no mismatched strip on cold
        // start. This has to follow the theme: brutal and light both run on
        // paper, and a black bar above them reads as a bug.
        // Capacitor's Style.Dark means light CONTENT, i.e. for a dark bar.
        const stored = window.localStorage.getItem("gd-theme");
        const theme =
          stored === "light" || stored === "brutal" || stored === "neo" ? stored : "dark";
        const bar = {
          dark: { style: Style.Dark, color: "#060606" },
          light: { style: Style.Light, color: "#e3d6bf" },
          brutal: { style: Style.Light, color: "#f4f1e8" },
          // Matches --neo-plate, so the bar disappears into the sheet.
          neo: { style: Style.Dark, color: "#272a30" },
        }[theme];

        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: bar.style });
        await StatusBar.setBackgroundColor({ color: bar.color });
      } catch (error) {
        console.warn("[native] status bar setup failed", error);
      }
    })
    .catch(() => {
      // Plugin not available (e.g. running on web) - ignore.
    });
}
