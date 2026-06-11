import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

// Custom URL scheme registered for the app (see app.json "scheme"). Supabase
// must list this exact value under Auth → URL Configuration → Redirect URLs.
export const NATIVE_AUTH_REDIRECT = "gandd://auth";

/**
 * Reads the access/refresh tokens out of the OAuth redirect URL fragment and
 * establishes the Supabase session. Returns true on success.
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
 * Starts Google sign-in. Opens the system auth browser (Google blocks OAuth in
 * embedded webviews) and finishes the Supabase session from the redirect back
 * to gandd://auth. Throws on failure so the caller can surface a message.
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

  const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_AUTH_REDIRECT);
  if (result.type !== "success" || !result.url) {
    // User dismissed the browser, or it returned without a redirect URL.
    throw new Error("Google sign-in was cancelled.");
  }

  const ok = await completeSessionFromUrl(result.url);
  if (!ok) throw new Error("Could not complete Google sign-in. Please try again.");
}
