import posthog from "posthog-js";

const posthogProjectToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
const posthogHost = import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";

let analyticsInitialized = false;

export function initAnalytics({ autocapture = true }: { autocapture?: boolean } = {}) {
  if (!posthogProjectToken) {
    if (import.meta.env.DEV) {
      console.warn(
        "[analytics] VITE_POSTHOG_PROJECT_TOKEN is missing. PostHog events will not be sent.",
      );
    }
    return posthog;
  }

  if (analyticsInitialized) return posthog;

  posthog.init(posthogProjectToken, {
    api_host: posthogHost,
    defaults: "2026-01-30",
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: autocapture
      ? {
          dom_event_allowlist: ["click", "change", "submit"],
          element_allowlist: ["a", "button", "form", "input", "select", "textarea", "label"],
        }
      : false,
    // Session replay (rrweb) continuously serializes the DOM on the JS main
    // thread and buffers it in memory. On the Android WebView (esp. low-RAM
    // devices) this caused repeated ~1s main-thread freezes - typing on the
    // login screen would lock the whole app.
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
  });

  analyticsInitialized = true;
  return posthog;
}

export function isAnalyticsEnabled() {
  return analyticsInitialized;
}

export function capturePageview(path?: string) {
  if (!analyticsInitialized || typeof window === "undefined") return;

  const url = new URL(path ?? window.location.href, window.location.origin);
  posthog.capture("$pageview", {
    $current_url: url.toString(),
  });
}

export { posthog };
