// Guest ("try without an account") sessions, built on Supabase anonymous auth.
// A guest gets a real auth.uid(), so RLS, storage, embeddings, and edge
// functions all work unchanged; later they can attach an email or Google
// identity from /auth and keep everything they made.
//
// NOTE: requires "Allow anonymous sign-ins" to be enabled in the Supabase
// dashboard (Authentication → Sign In / Up). Without it the API returns
// "Anonymous sign-ins are disabled" and callers should fall back to /auth.
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Documents a guest can upload before we ask them to create an account. */
export const GUEST_DOCUMENT_LIMIT = 2;

/** True when the signed-in user is an anonymous (guest) session. */
export function isGuestUser(user: User | null | undefined): boolean {
  return Boolean(user?.is_anonymous);
}

/**
 * Starts an anonymous Supabase session. Resolves once the session exists -
 * the AuthProvider listener picks it up and creates the profile, so callers
 * can simply navigate to /app (the shell routes new users to onboarding).
 * Throws with a readable message when anonymous sign-ins are disabled.
 */
export async function startGuestSession(): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      error.message.toLowerCase().includes("disabled")
        ? "Guest mode isn't available right now - please create a free account instead."
        : error.message,
    );
  }
}
