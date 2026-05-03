import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type AuthSearch = { mode?: "signup" | "signin" };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): AuthSearch => ({
    mode: s.mode === "signup" ? "signup" : "signin",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — G&D" },
      { name: "description", content: "Sign in to G&D to access your study assistant." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (profile && !profile.onboarded) {
        navigate({ to: "/onboarding" });
      } else if (profile?.onboarded) {
        navigate({ to: "/app/chat" });
      }
    }
  }, [loading, user, profile, navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/onboarding` },
        });
        if (error) throw error;
        toast.success("Account created! Let's set up your profile.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
        },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    }
  };

  return (
    <div className="luxury-auth-page min-h-screen bg-background relative overflow-hidden flex flex-col">
      <div className="symbiote-blob auth-blob-one" />
      <div className="symbiote-blob auth-blob-two" />

      <header className="relative z-10 px-6 py-6">
        <Link to="/" className="luxury-brand-text">
          G&D
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          <div className="luxury-panel rounded-lg p-8 shadow-elegant backdrop-blur">
            <h1 className="font-display text-4xl font-light leading-none">
              {isSignup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isSignup
                ? "Join G&D and start studying smarter."
                : "Sign in to continue your studies."}
            </p>

            <button
              onClick={handleGoogle}
              type="button"
              className="mt-6 w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-background/70 hover:bg-surface-elevated transition-colors text-sm font-medium text-foreground"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              or
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleEmail} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-primary text-primary-foreground font-medium shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSignup ? "Create account" : "Sign in"}
              </button>
            </form>

            <p className="text-xs text-muted-foreground text-center mt-5">
              {isSignup ? "Already have an account?" : "New here?"}{" "}
              <button
                type="button"
                className="text-primary hover:underline font-medium"
                onClick={() => setIsSignup(!isSignup)}
              >
                {isSignup ? "Sign in" : "Create one"}
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <span className="font-display text-lg leading-none text-foreground" aria-hidden>
      G
    </span>
  );
}
