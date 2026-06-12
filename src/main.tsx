import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { AppErrorBoundary } from "./components/error-boundary";
import { initNativeShell } from "./lib/native";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";
import "./styles.css";

posthog.init(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN, {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  defaults: "2026-01-30",
});

// Mark the document as the native app and configure the status bar before the
// first paint, so safe-area styling and native auth behavior apply from the
// very first frame.
initNativeShell();

// Stamp the build id so you can verify which build is actually live: open the
// console (BUILD ...) or inspect <html data-build="...">.
if (typeof window !== "undefined") {
  console.log(`BUILD ${__BUILD_ID__}`);
  document.documentElement.setAttribute("data-build", __BUILD_ID__);
}

// Surface otherwise-silent failures (e.g. a rejected promise during an upload
// on a memory-constrained Android device) instead of letting the page sit
// blank. These only log — the ErrorBoundary handles anything thrown in render.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    console.error("[window.error]", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[window.unhandledrejection]", event.reason);
  });
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <AppErrorBoundary>
        <RouterProvider router={getRouter()} />
      </AppErrorBoundary>
    </PostHogProvider>
  </StrictMode>,
);
