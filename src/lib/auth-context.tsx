import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  name: string | null;
  university: string | null;
  year: string | null;
  course: string | null;
  curriculum: string | null;
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
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_REQUEST_TIMEOUT_MS = 12_000;
const AUTH_CONFIG_ERROR =
  "Authentication is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your hosting environment, then redeploy.";

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
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

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
        currentUser.user_metadata?.name ?? currentUser.user_metadata?.full_name ?? "";
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
      setAuthError(getAuthErrorMessage(error));
      setProfile(null);
    }
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const failAuth = (error: unknown) => {
      console.error("auth init", error);
      if (!active) return;
      setAuthError(getAuthErrorMessage(error));
      setSession(null);
      setUser(null);
      setProfile(null);
      setLoading(false);
    };

    try {
      // Set up auth listener FIRST
      const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
        if (!active) return;

        setAuthError(null);
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) {
          // defer to avoid deadlock with supabase client
          setLoading(true);
          setTimeout(() => {
            if (!active) return;
            void loadProfile(sess.user).finally(() => {
              if (active) setLoading(false);
            });
          }, 0);
        } else {
          setProfile(null);
          setLoading(false);
        }
      });

      unsubscribe = () => sub.subscription.unsubscribe();

      // Then fetch existing session
      void withTimeout(supabase.auth.getSession(), "Checking your sign-in session")
        .then(async ({ data }) => {
          if (!active) return;
          setAuthError(null);
          setSession(data.session);
          setUser(data.session?.user ?? null);
          if (data.session?.user) {
            await loadProfile(data.session.user);
          } else {
            setProfile(null);
          }
        })
        .catch((error) => {
          console.error("get session", error);
          if (!active) return;
          setAuthError(getAuthErrorMessage(error));
          setSession(null);
          setUser(null);
          setProfile(null);
        })
        .finally(() => {
          if (active) setLoading(false);
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
    }),
    [user, session, profile, loading, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
