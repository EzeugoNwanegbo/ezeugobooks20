import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { AppErrorBoundary } from "./components/error-boundary";
import { initNativeShell, isNativeApp } from "./lib/native";
import { PostHogProvider } from "@posthog/react";
import { capturePageview, initAnalytics, posthog } from "./lib/analytics";
import "./styles.css";

// Mark the document as the native app and configure the status bar before the
// first paint, so safe-area styling and native auth behavior apply from the
// very first frame.
initNativeShell();
initAnalytics({ autocapture: !isNativeApp() });

// TEMPORARY: on-device event log (top of screen) to diagnose the login-input
// freeze. Native only. Remove once fixed (see src/lib/native-diagnostics.ts).
if (isNativeApp()) {
  void import("./lib/native-diagnostics").then(({ initNativeDiagnostics }) =>
    initNativeDiagnostics(),
  );
}

// Stamp the build id so you can verify which build is actually live: open the
// console (BUILD ...) or inspect <html data-build="...">.
if (typeof window !== "undefined") {
  console.log(`BUILD ${__BUILD_ID__}`);
  document.documentElement.setAttribute("data-build", __BUILD_ID__);
}

// Surface otherwise-silent failures (e.g. a rejected promise during an upload
// on a memory-constrained Android device) instead of letting the page sit
// blank. These only log - the ErrorBoundary handles anything thrown in render.
if (typeof window !== "undefined") {
  // In the native app we can't open a console, so paint runtime errors as an
  // on-screen banner the user can screenshot. Web (production) only logs.
  const showErrorBanner = (label: string, detail: unknown) => {
    if (!isNativeApp()) return;
    try {
      const text =
        detail instanceof Error
          ? `${detail.message}\n${detail.stack ?? ""}`
          : String(detail);
      let banner = document.getElementById("gd-error-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "gd-error-banner";
        banner.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:2147483647;max-height:60vh;overflow:auto;" +
          "background:#b00020;color:#fff;font:12px/1.4 monospace;padding:12px 14px;white-space:pre-wrap;" +
          "box-shadow:0 2px 12px rgba(0,0,0,.4);";
        banner.addEventListener("click", () => banner?.remove());
        document.body.appendChild(banner);
      }
      banner.textContent = `build ${__BUILD_ID__}\n[${label}] ${text}\n\n(tap to dismiss)`;
    } catch {
      // never let the error reporter throw
    }
  };

  window.addEventListener("error", (event) => {
    console.error("[window.error]", event.error || event.message);
    showErrorBanner("error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[window.unhandledrejection]", event.reason);
    showErrorBanner("promise", event.reason);
  });
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found.");
}

const router = getRouter();
capturePageview();
router.subscribe("onResolved", (event) => {
  if (event.hrefChanged) {
    capturePageview(event.toLocation.href);
  }
});

createRoot(root).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </PostHogProvider>
  </StrictMode>,
);
