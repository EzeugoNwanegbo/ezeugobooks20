import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, SUPABASE_ANON_KEY_VALUE, SUPABASE_URL_VALUE } from "./supabase";

// Mirrors the website's Profile (src/lib/auth-context.tsx). The row is loaded
// with select("*"), so every column already arrives over the wire — these
// fields were simply invisible to the native app, which is why mobile students
// got no discipline framework, no admin surface and no social layer.
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
  is_admin: boolean | null;
  // Gamification, as the web app syncs it onto the profile row (see
  // syncLeaderboard in src/lib/gamification.ts). The native app READS these for
  // the rank badge, progress bar and streak; it does not yet award points
  // itself, so a number here is always the server's, never a local guess.
  points?: number | null;
  weekly_points?: number | null;
  current_streak?: number | null;
  // Social layer. OPTIONAL on purpose: select("*") never names a column, so
  // these arrive as undefined against a database without the social migration.
  // `| null` would have lied about that — see the same note on the web type.
  username?: string | null;
  username_set_at?: string | null;
  discoverable_by?: string | null;
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
  return error instanceof Error ? error.message : "Authentication failed to initialize.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // The user id whose profile is already loaded, so background token refreshes
  // (which fire on app foreground) don't re-enter the full-screen loading state.
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
        (currentUser.user_metadata?.name as string | undefined) ??
        (currentUser.user_metadata?.full_name as string | undefined) ??
        "";
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
        } catch {
          /* fall through */
        }
      }
      setAuthError(getAuthErrorMessage(error));
      setProfile(null);
    }
  };

  useEffect(() => {
    let active = true;
    let listenerFired = false;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!active) return;
      listenerFired = true;
      setAuthError(null);
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        if (loadedUserIdRef.current === sess.user.id) return;
        loadedUserIdRef.current = sess.user.id;
        setLoading(true);
        setTimeout(() => {
          if (!active) return;
          void loadProfile(sess.user).finally(() => {
            if (active) setLoading(false);
          });
        }, 0);
      } else {
        loadedUserIdRef.current = null;
        setProfile(null);
        setLoading(false);
      }
    });

    void withTimeout(supabase.auth.getSession(), "Checking your sign-in session")
      .then(async ({ data }) => {
        if (!active) return;
        setAuthError(null);
        if (data.session?.user) {
          setSession(data.session);
          setUser(data.session.user);
          if (loadedUserIdRef.current !== data.session.user.id) {
            loadedUserIdRef.current = data.session.user.id;
            await loadProfile(data.session.user);
          }
        } else if (!listenerFired) {
          setSession(null);
          setUser(null);
          setProfile(null);
        }
      })
      .catch((error) => {
        if (!active) return;
        setAuthError(getAuthErrorMessage(error));
      })
      .finally(() => {
        if (active && !listenerFired) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
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
        const res = await fetch(`${SUPABASE_URL_VALUE}/functions/v1/delete-account`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY_VALUE,
          },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
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
