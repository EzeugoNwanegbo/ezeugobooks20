import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "./native";

// Custom URL scheme registered for the app (see AndroidManifest.xml intent
// filter). Supabase redirects back here after Google completes, with the
// session tokens in the URL fragment.
export const NATIVE_AUTH_REDIRECT = "gandd://auth";

let deepLinkListenerReady = false;

/**
 * Completes a Supabase session from an OAuth redirect deep link such as
 * `gandd://auth#access_token=...&refresh_token=...`. Returns true when a
 * session was established.
 */
async function completeSessionFromUrl(url: string): Promise<boolean> {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return false;

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    console.error("[native-auth] setSession failed", error);
    return false;
  }
  return true;
}

/**
 * Registers a one-time listener that catches the OAuth redirect deep link and
 * finishes the sign-in. Idempotent. Call once during native startup.
 */
export function initNativeAuthDeepLinks(): void {
  if (!isNativeApp() || deepLinkListenerReady) return;
  deepLinkListenerReady = true;

  void import("@capacitor/app")
    .then(({ App }) => {
      void App.addListener("appUrlOpen", (event) => {
        if (!event.url?.startsWith("gandd://")) return;
        void completeSessionFromUrl(event.url).finally(() => {
          // Close the in-app browser tab so the user lands back on the app.
          void import("@capacitor/browser").then(({ Browser }) => Browser.close()).catch(() => {});
        });
      });
    })
    .catch((error) => console.warn("[native-auth] deep link listener failed", error));
}

/**
 * Starts Google sign-in from the native app. Opens the system browser (Google
 * blocks OAuth inside embedded webviews), then the deep-link listener above
 * finishes the session when the browser redirects back to `gandd://auth`.
 */
export async function signInWithGoogleNative(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_AUTH_REDIRECT,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Google sign-in could not start. Please try again.");

  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url });
}
