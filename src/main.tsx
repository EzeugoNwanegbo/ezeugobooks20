import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { AppErrorBoundary } from "./components/error-boundary";
import "./styles.css";

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
    <AppErrorBoundary>
      <RouterProvider router={getRouter()} />
    </AppErrorBoundary>
  </StrictMode>,
);
