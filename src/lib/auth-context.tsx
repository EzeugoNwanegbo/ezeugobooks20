import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { usePostHog } from "@posthog/react";
import { supabase } from "@/integrations/supabase/client";
import { isAnalyticsEnabled } from "@/lib/analytics";

export type Profile = {
  id: string;
  name: string | null;
  university: string | null;
  year: string | null;
  course: string | null;
  discipline: "medicine" | "law" | null;
  study_track: string | null;
  curriculum: string | null;
  personalization_background: string | null;
  exam_format: "MCQ" | "SAQ" | "OSCE" | "Viva" | null;
  preferred_mode: "Simplified" | "Detailed" | null;
  weak_areas: string[] | null;
  recent_topics: string[] | null;
  onboarded: boolean | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  authError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_REQUEST_TIMEOUT_MS = 20_000;
const AUTH_CONFIG_ERROR =
  "Authentication is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your hosting environment, then redeploy.";
const guestAuthContext: AuthContextValue = {
  user: null,
  session: null,
  profile: null,
  loading: false,
  authError: null,
  refreshProfile: async () => {},
  signOut: async () => {},
  deleteAccount: async () => {},
};

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out. Check your connection and try again.`));
    }, AUTH_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function getAuthErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication failed to initialize.";

  if (message.includes("Missing Supabase environment variables")) {
    return AUTH_CONFIG_ERROR;
  }

  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const posthog = usePostHog();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // The user id whose profile is already loaded. Used to skip the full-screen
  // loading state on background token refreshes (which fire whenever the tab
  // regains focus - e.g. returning from the Android file picker). Re-entering
  // loading there unmounts the app and cancels in-progress uploads.
  const loadedUserIdRef = useRef<string | null>(null);

  const loadProfile = async (currentUser: User) => {
    try {
      const { data, error } = await withTimeout(
        supabase.from("user_profiles").select("*").eq("id", currentUser.id).maybeSingle(),
        "Loading your profile",
      );

      if (error) throw error;

      if (data) {
        setAuthError(null);
        setProfile(data as Profile);
        return;
      }

      const fallbackName =
        currentUser.user_metadata?.name ??
        currentUser.user_metadata?.full_name ??
        // Anonymous (guest) sessions have no identity to derive a name from.
        (currentUser.is_anonymous ? "Guest" : "");
      const { data: created, error: createError } = await withTimeout(
        supabase
          .from("user_profiles")
          .insert({ id: currentUser.id, name: fallbackName })
          .select("*")
          .single(),
        "Creating your profile",
      );

      if (createError) throw createError;

      setAuthError(null);
      setProfile(created as Profile);
    } catch (error) {
      console.error("load profile", error);
      // On timeout, retry once silently before showing an error
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("timed out")) {
        try {
          const { data } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", currentUser.id)
            .maybeSingle();
          if (data) {
            setAuthError(null);
            setProfile(data as Profile);
            return;
          }
        } catch (_) {
          // fall through to error state
        }
      }
      setAuthError(getAuthErrorMessage(error));
      setProfile(null);
    }
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const failAuth = (error: unknown) => {
      console.error("[AuthProvider] Auth initialization failed:", error);
      if (!active) return;
      setAuthError(getAuthErrorMessage(error));
      setSession(null);
      setUser(null);
      setProfile(null);
      setLoading(false);
    };

    try {
      console.log("[AuthProvider] Setting up auth listener...");
      // Track whether the listener has already fired with a session so that a
      // slower getSession() response doesn't clobber the listener's state.
      // This prevents the sign-up-loop on mobile browsers (e.g. Samsung
      // Internet) where localStorage may be unavailable and getSession()
      // returns null even though onAuthStateChange just fired with a session.
      let listenerFired = false;

      // Set up auth listener FIRST
      const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
        console.log("[AuthProvider] Auth state changed:", { event: _event, session: !!sess });
        if (!active) return;

        listenerFired = true;
        setAuthError(null);
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) {
          // Background events (TOKEN_REFRESHED on tab refocus, USER_UPDATED, or
          // SIGNED_IN re-fired for the same user) must NOT re-enter the loading
          // state - that unmounts the whole app and kills any in-progress
          // upload. Only the first load / a genuine user change loads the
          // profile behind the full-screen splash.
          if (loadedUserIdRef.current === sess.user.id) return;
          loadedUserIdRef.current = sess.user.id;
          if (isAnalyticsEnabled()) {
            posthog?.identify(sess.user.id, {
              email: sess.user.email,
              name: sess.user.user_metadata?.name ?? sess.user.user_metadata?.full_name,
            });
          }
          // defer to avoid deadlock with supabase client
          setLoading(true);
          setTimeout(() => {
            if (!active) return;
            void loadProfile(sess.user).finally(() => {
              if (active) setLoading(false);
            });
          }, 0);
        } else {
          loadedUserIdRef.current = null;
          if (isAnalyticsEnabled()) {
            posthog?.reset();
          }
          setProfile(null);
          setLoading(false);
        }
      });

      unsubscribe = () => sub.subscription.unsubscribe();

      // Then fetch existing session
      console.log("[AuthProvider] Fetching existing session...");
      void withTimeout(supabase.auth.getSession(), "Checking your sign-in session")
        .then(async ({ data }) => {
          console.log("[AuthProvider] Got existing session:", !!data.session);
          if (!active) return;
          setAuthError(null);
          if (data.session?.user) {
            setSession(data.session);
            setUser(data.session.user);
            // Skip if the listener already loaded this user's profile, so we
            // don't double-fetch on initial mount.
            if (loadedUserIdRef.current !== data.session.user.id) {
              loadedUserIdRef.current = data.session.user.id;
              await loadProfile(data.session.user);
            }
          } else if (!listenerFired) {
            // Only null-out state when the listener hasn't already established
            // a session - avoids overwriting a just-created sign-up session.
            setSession(null);
            setUser(null);
            setProfile(null);
          }
        })
        .catch((error) => {
          console.error("[AuthProvider] Failed to get session:", error);
          if (!active) return;
          setAuthError(getAuthErrorMessage(error));
          if (!listenerFired) {
            setSession(null);
            setUser(null);
            setProfile(null);
          }
        })
        .finally(() => {
          // If the listener already fired with a session, it owns the loading
          // lifecycle (it flips loading=false after the profile loads). Racing
          // it to false here is what produced a transient loading=false /
          // user=null render that bounced freshly-signed-up users to /auth.
          if (active && !listenerFired) setLoading(false);
        });
    } catch (error) {
      failAuth(error);
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      loading,
      authError,
      refreshProfile: async () => {
        if (user) await loadProfile(user);
      },
      signOut: async () => {
        try {
          await supabase.auth.signOut();
        } catch (error) {
          setAuthError(getAuthErrorMessage(error));
        }
      },
      deleteAccount: async () => {
        if (!session?.access_token) throw new Error("Not signed in");
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            apikey: anonKey,
          },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "Failed to delete account");
        }
        await supabase.auth.signOut();
      },
    }),
    [user, session, profile, loading, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  return ctx ?? guestAuthContext;
}
