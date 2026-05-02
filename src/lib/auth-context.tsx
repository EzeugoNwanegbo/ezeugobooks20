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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (currentUser: User) => {
    const { data } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (data) {
      setProfile(data as Profile);
      return;
    }

    const fallbackName =
      currentUser.user_metadata?.name ?? currentUser.user_metadata?.full_name ?? "";
    const { data: created, error } = await supabase
      .from("user_profiles")
      .insert({ id: currentUser.id, name: fallbackName })
      .select("*")
      .single();

    if (error) {
      console.error("create profile", error);
      setProfile(null);
      return;
    }

    setProfile(created as Profile);
  };

  useEffect(() => {
    // Set up auth listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        // defer to avoid deadlock with supabase client
        setTimeout(() => loadProfile(sess.user), 0);
      } else {
        setProfile(null);
      }
    });

    // Then fetch existing session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadProfile(data.session.user);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
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
