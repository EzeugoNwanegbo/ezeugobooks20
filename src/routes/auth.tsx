import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthSearch = { mode?: "signup" | "signin" };
const AUTH_ACTION_TIMEOUT_MS = 15_000;
const AUTH_CONFIG_ERROR =
  "Authentication is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your hosting environment, then redeploy.";

async function loadSupabase() {
  const module = await import("@/integrations/supabase/client");
  return module.supabase;
}

function getAuthErrorMessage(error: unknown, fallback = "Authentication failed") {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();

  if (message.includes("Missing Supabase environment variables")) {
    return AUTH_CONFIG_ERROR;
  }

  if (normalized.includes("redirect") || normalized.includes("not allowed")) {
    return "Supabase blocked the confirmation redirect. Add this domain to Supabase Auth URL settings, then try again.";
  }

  return message;
}

function withAuthTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out. Check your connection and try again.`));
    }, AUTH_ACTION_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

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
  return (
    <AuthProvider>
      <AuthFlow />
    </AuthProvider>
  );
}

function AuthFlow() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    navigate({ to: profile?.onboarded ? "/app/chat" : "/onboarding", replace: true });
  }, [loading, user, profile, navigate]);

  if (loading || user) {
    return (
      <div className="luxury-auth-page min-h-screen flex items-center justify-center bg-background">
        <div className="symbiote-blob auth-blob-one" />
        <div className="symbiote-blob auth-blob-two" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setAuthNotice(null);
    try {
      const trimmedEmail = email.trim();
      const supabase = await loadSupabase();

      if (isSignup) {
        const { data, error } = await withAuthTimeout(
          supabase.auth.signUp({
            email: trimmedEmail,
            password,
            options: { emailRedirectTo: `${window.location.origin}/onboarding` },
          }),
          "Creating your account",
        );
        if (error) throw error;

        if (data.session) {
          toast.success("Account created! Let's set up your profile.");
          navigate({ to: "/onboarding" });
          return;
        }

        setPassword("");
        setIsSignup(false);
        setAuthNotice("Account created. Check your email to confirm it, then sign in here.");
        toast.success("Account created. Check your email to confirm it.");
      } else {
        const { error } = await withAuthTimeout(
          supabase.auth.signInWithPassword({ email: trimmedEmail, password }),
          "Signing in",
        );
        if (error) throw error;
        toast.success("Welcome back!");
        navigate({ to: "/app/chat" });
      }
    } catch (err) {
      toast.error(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (googleSubmitting) return;

    setGoogleSubmitting(true);
    setAuthNotice(null);
    try {
      const supabase = await loadSupabase();
      const { error } = await withAuthTimeout(
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth`,
          },
        }),
        "Starting Google sign-in",
      );
      if (error) throw error;
    } catch (err) {
      toast.error(getAuthErrorMessage(err, "Google sign-in failed"));
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="luxury-auth-page min-h-screen bg-background relative overflow-hidden flex flex-col">
      <div className="symbiote-blob auth-blob-one" />
      <div className="symbiote-blob auth-blob-two" />

      <header className="relative z-10 flex items-center justify-between px-6 py-6">
        <Link to="/" className="luxury-brand-text">
          G&D
        </Link>
        <ThemeToggle />
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
            {authNotice && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-foreground">
                {authNotice}
              </div>
            )}

            <button
              onClick={handleGoogle}
              type="button"
              disabled={googleSubmitting}
              className="mt-6 w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-background/70 hover:bg-surface-elevated transition-colors text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {googleSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              {googleSubmitting
                ? "Opening Google..."
                : isSignup
                  ? "Create account with Google"
                  : "Sign in with Google"}
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              or use email
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
                  autoComplete="email"
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
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-primary text-primary-foreground font-medium shadow-glow hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting
                  ? isSignup
                    ? "Creating..."
                    : "Signing in..."
                  : isSignup
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            <p className="text-xs text-muted-foreground text-center mt-5">
              {isSignup ? "Already have an account?" : "New here?"}{" "}
              <button
                type="button"
                className="text-primary hover:underline font-medium"
                onClick={() => {
                  setAuthNotice(null);
                  setIsSignup(!isSignup);
                }}
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
