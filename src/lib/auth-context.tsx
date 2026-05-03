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
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_REQUEST_TIMEOUT_MS = 12_000;

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (currentUser: User) => {
    try {
      const { data, error } = await withTimeout(
        supabase.from("user_profiles").select("*").eq("id", currentUser.id).maybeSingle(),
        "Loading your profile",
      );

      if (error) throw error;

      if (data) {
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

      setProfile(created as Profile);
    } catch (error) {
      console.error("load profile", error);
      setProfile(null);
    }
  };

  useEffect(() => {
    let active = true;

    // Set up auth listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!active) return;

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

    // Then fetch existing session
    void withTimeout(supabase.auth.getSession(), "Checking your sign-in session")
      .then(async ({ data }) => {
        if (!active) return;
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
        setSession(null);
        setUser(null);
        setProfile(null);
      })
      .finally(() => {
        if (active) setLoading(false);
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
      refreshProfile: async () => {
        if (user) await loadProfile(user);
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [user, session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
