import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const authRequestId = useRef(0);
  const currentSessionRef = useRef<Session | null>(null);
  const loadedProfileUserIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (currentUser: User) => {
    try {
      const { data, error } = await withTimeout(
        supabase.from("user_profiles").select("*").eq("id", currentUser.id).maybeSingle(),
        "Loading your profile",
      );

      if (error) throw error;

      if (data) {
        setAuthError(null);
        loadedProfileUserIdRef.current = currentUser.id;
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
      loadedProfileUserIdRef.current = currentUser.id;
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
            loadedProfileUserIdRef.current = currentUser.id;
            setProfile(data as Profile);
            return;
          }
        } catch (_) {
          // fall through to error state
        }
      }
      setAuthError(getAuthErrorMessage(error));
      loadedProfileUserIdRef.current = null;
      setProfile(null);
    }
  }, []);

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
      // Set up auth listener FIRST
      const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
        console.log("[AuthProvider] Auth state changed:", { event: _event, session: !!sess });
        if (!active) return;

        const requestId = ++authRequestId.current;
        const previousUserId = currentSessionRef.current?.user?.id ?? null;
        const nextUser = sess?.user ?? null;
        const nextUserId = nextUser?.id ?? null;
        const hasLoadedProfile = nextUserId && loadedProfileUserIdRef.current === nextUserId;

        currentSessionRef.current = sess;
        setAuthError(null);
        setSession(sess);
        setUser(nextUser);
        if (nextUser) {
          if (previousUserId === nextUserId && hasLoadedProfile) {
            setLoading(false);
            return;
          }

          // defer to avoid deadlock with supabase client
          setLoading(true);
          setTimeout(() => {
            if (!active) return;
            void loadProfile(nextUser).finally(() => {
              if (active && requestId === authRequestId.current) setLoading(false);
            });
          }, 0);
        } else {
          loadedProfileUserIdRef.current = null;
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
          const requestId = ++authRequestId.current;
          currentSessionRef.current = data.session;
          setAuthError(null);
          setSession(data.session);
          setUser(data.session?.user ?? null);
          if (data.session?.user) {
            await loadProfile(data.session.user);
          } else {
            loadedProfileUserIdRef.current = null;
            setProfile(null);
          }
          if (active && requestId === authRequestId.current) setLoading(false);
        })
        .catch((error) => {
          console.error("[AuthProvider] Failed to get session:", error);
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
  }, [loadProfile]);

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
    [user, session, profile, loading, authError, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  return ctx ?? guestAuthContext;
}
