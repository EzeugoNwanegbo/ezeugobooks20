import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native";
import { lastRoute } from "@/lib/last-route";
import { signInWithGoogleNative } from "@/lib/native-auth";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthSearch = { mode?: "signup" | "signin" };
const AUTH_ACTION_TIMEOUT_MS = 20_000;
const AUTH_CONFIG_ERROR =
  "Authentication is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your hosting environment, then redeploy.";
const EMAIL_CONFIRM_NOTICE =
  "Account created. A confirmation email has been sent. Please confirm your email, then come back here to sign in.";

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
      { title: "Sign in - G&D" },
      { name: "description", content: "Sign in to G&D to search your study files." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  return <AuthFlow />;
}

function AuthFlow() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user, profile, loading, authError, refreshProfile, signOut } = useAuth();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const native = isNativeApp();

  useEffect(() => {
    // Navigate as soon as the session + profile are ready. This deliberately
    // does NOT depend on `submitting`: on a successful sign-up we keep
    // `submitting` true to avoid flashing the bare form, so gating navigation
    // on it would deadlock here.
    if (loading || !user || !profile) return;
    navigate({ to: profile?.onboarded ? lastRoute() : "/onboarding", replace: true });
  }, [loading, user, profile, navigate]);

  if (user && authError && !profile) {
    return (
      <div className="luxury-auth-page flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="symbiote-blob auth-blob-one" />
        <div className="symbiote-blob auth-blob-two" />
        <div className="luxury-panel w-full max-w-md rounded-lg p-5 text-center shadow-elegant sm:p-6">
          <h1 className="font-display text-3xl font-light leading-none">Profile could not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-glow"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex flex-1 items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || user) {
    return (
      <div className="luxury-auth-page flex min-h-dvh items-center justify-center bg-background">
        <div className="symbiote-blob auth-blob-one" />
        <div className="symbiote-blob auth-blob-two" />
        <div className="text-center">
          <div className="luxury-brand-text">G&D</div>
          <p className="mt-2 text-xs text-muted-foreground">Opening your workspace...</p>
        </div>
      </div>
    );
  }

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setAuthNotice(null);
    // When the action ends with us navigating away (sign-up that returns a
    // session, or a successful sign-in) we keep `submitting` true so the
    // "Creating.../Signing in..." state holds until the auth listener loads
    // the profile and the navigation effect fires. Resetting it here is what
    // caused the bare form to flash back on slower devices.
    let keepSubmitting = false;
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
          // Signed in immediately — hold the submitting state until navigation.
          keepSubmitting = true;
          toast.success("Welcome to G&D!");
        } else {
          // Project has email confirmation enabled, so no session is returned.
          setPassword("");
          setIsSignup(false);
          setAuthNotice(EMAIL_CONFIRM_NOTICE);
          toast.success("Check your email to confirm your account.");
        }
      } else {
        const { error } = await withAuthTimeout(
          supabase.auth.signInWithPassword({ email: trimmedEmail, password }),
          "Signing in",
        );
        if (error) throw error;
        keepSubmitting = true;
        toast.success("Welcome back!");
        navigate({ to: lastRoute() });
      }
    } catch (err) {
      toast.error(getAuthErrorMessage(err));
    } finally {
      if (!keepSubmitting) setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (googleSubmitting) return;

    setGoogleSubmitting(true);
    setAuthNotice(null);
    try {
      if (native) {
        // System-browser flow: Google blocks OAuth inside embedded webviews,
        // and the deep-link listener finishes the session on redirect back.
        await withAuthTimeout(signInWithGoogleNative(), "Starting Google sign-in");
        // Keep the spinner up; we hand off to the browser and the deep-link
        // handler completes the session when the user returns.
        return;
      }

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
    <div className="luxury-auth-page relative flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto bg-background">
      <div className="symbiote-blob auth-blob-one" />
      <div className="symbiote-blob auth-blob-two" />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
        <Link to="/" className="luxury-brand-text">
          G&D
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-start justify-center px-4 pb-8 pt-8 sm:items-center sm:px-6 sm:pb-12 sm:pt-6">
        <div className="w-full max-w-md">
          <div className="luxury-panel rounded-lg p-5 shadow-elegant backdrop-blur sm:p-8">
            <h1 className="font-display text-3xl font-light leading-none sm:text-4xl">
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

            <>
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
            </>

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
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-24 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="********"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 inline-flex min-w-20 items-center justify-center gap-1 rounded-r-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    <span>{showPassword ? "Hide" : "Show"}</span>
                  </button>
                </div>
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
