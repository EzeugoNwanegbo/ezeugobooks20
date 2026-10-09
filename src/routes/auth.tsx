import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff, Mail, BookOpen } from "lucide-react";
import { AuthStudyPanel } from "@/components/auth-study-panel";
import { FounderStory } from "@/components/founder-story";
import { LoadingDots } from "@/components/loading-dots";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native";
import { lastRoute } from "@/lib/last-route";
import { signInWithGoogleNative } from "@/lib/native-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import "@/styles/auth-flow.css";

// "upgrade" = a guest (anonymous) session attaching a real identity. The page
// must NOT bounce them to the app, and must link credentials to the existing
// user instead of signing up fresh - otherwise their guest work is orphaned.
type AuthSearch = { mode?: "signup" | "signin" | "upgrade" };
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
    mode: s.mode === "signup" ? "signup" : s.mode === "upgrade" ? "upgrade" : "signin",
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
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const native = isNativeApp();
  // Guest session attaching a real identity - only valid while the anonymous
  // session is alive; otherwise fall back to the normal sign-in form.
  const isUpgrade = mode === "upgrade" && Boolean(user?.is_anonymous);
  const authBusy = submitting || googleSubmitting;

  useEffect(() => {
    // Navigate as soon as the session + profile are ready. This deliberately
    // does NOT depend on `submitting`: on a successful sign-up we keep
    // `submitting` true to avoid flashing the bare form, so gating navigation
    // on it would deadlock here.
    if (loading || !user || !profile) return;
    // Guests upgrading stay here to attach an email/Google identity.
    if (isUpgrade) return;
    navigate({ to: profile?.onboarded ? lastRoute() : "/onboarding", replace: true });
  }, [loading, user, profile, navigate, isUpgrade]);

  if (user && authError && !profile) {
    return (
      <div className="luxury-auth-page gd-entry-page items-center justify-center px-5">
        <div className="gd-entry-panel w-full max-w-md">
          <span className="gd-entry-eyebrow">One more step</span>
          <h1>Let’s reconnect your workspace.</h1>
          <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="gd-entry-submit flex-1"
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

  if (loading || (user && !isUpgrade)) {
    return (
      <div className="luxury-auth-page gd-entry-page items-center justify-center">
        <div className="gd-entry-loading" role="status" aria-live="polite">
          <div className="luxury-brand-text">G&D</div>
          <p>Opening your study space…</p>
          <div className="gd-entry-loading-dots" aria-hidden="true">
            <LoadingDots />
          </div>
        </div>
      </div>
    );
  }

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authBusy) return;

    setSubmitting(true);
    setAuthNotice(null);
    setFormError(null);
    // When the action ends with us navigating away (sign-up that returns a
    // session, or a successful sign-in) we keep `submitting` true so the
    // "Creating.../Signing in..." state holds until the auth listener loads
    // the profile and the navigation effect fires. Resetting it here is what
    // caused the bare form to flash back on slower devices.
    let keepSubmitting = false;
    try {
      const trimmedEmail = email.trim();
      const supabase = await loadSupabase();

      if (isUpgrade) {
        // Attach the email + password to the existing anonymous user - same
        // auth.uid(), so every document/chat the guest made stays theirs. The
        // email lands as "pending" until they click the confirmation link.
        const { error } = await withAuthTimeout(
          supabase.auth.updateUser(
            { email: trimmedEmail, password },
            { emailRedirectTo: `${window.location.origin}/auth` },
          ),
          "Saving your account",
        );
        if (error) throw error;
        setPassword("");
        setAuthNotice(
          `Almost done - we sent a confirmation link to ${trimmedEmail}. Click it to finish creating your account. Everything you made as a guest stays with you.`,
        );
        toast.success("Check your email to confirm your account.");
      } else if (isSignup) {
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
          // Signed in immediately - hold the submitting state until navigation.
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
      const message = getAuthErrorMessage(err);
      setFormError(message);
      toast.error(message);
    } finally {
      if (!keepSubmitting) setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (authBusy) return;

    setGoogleSubmitting(true);
    setAuthNotice(null);
    setFormError(null);
    try {
      if (isUpgrade) {
        // Link Google to the existing anonymous user (manual linking must be
        // enabled in the Supabase dashboard). A plain OAuth sign-in here would
        // create/switch accounts and orphan the guest's work.
        const supabase = await loadSupabase();
        const { error } = await withAuthTimeout(
          supabase.auth.linkIdentity({
            provider: "google",
            options: { redirectTo: `${window.location.origin}/auth` },
          }),
          "Connecting Google",
        );
        if (error) throw error;
        return; // browser redirects to Google; spinner holds until then
      }

      if (native) {
        // System-browser flow: Google blocks OAuth inside embedded webviews,
        // and the deep-link listener finishes the session on redirect back.
        await withAuthTimeout(signInWithGoogleNative(), "Starting Google sign-in");
        // Browser.open resolves after handoff, including when the user later
        // cancels. Keep email and another Google attempt available on return.
        setGoogleSubmitting(false);
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
      const message = getAuthErrorMessage(err, "Google sign-in failed");
      setFormError(message);
      toast.error(message);
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="luxury-auth-page gd-entry-page">
      <header className="gd-entry-header">
        <Link to="/" className="gd-entry-brand" aria-label="G&D home">
          <span className="luxury-brand-text">G&D</span>
          <span className="gd-entry-brand-label">
            YOUR PERSONAL
            <br />
            STUDY SPACE
          </span>
        </Link>
        <div className="gd-entry-header-actions">
          <Link to="/" className="gd-entry-home-link">
            <ArrowLeft size={13} /> Back to home
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="gd-entry-main">
        <AuthStudyPanel />
        <div className="gd-entry-form-column">
          <div className="gd-entry-panel">
            <span className="gd-entry-eyebrow">
              {isUpgrade ? "Make it yours" : isSignup ? "A fresh start" : "Back to your studies"}
            </span>
            <h1>
              {isUpgrade
                ? "Keep your work."
                : isSignup
                  ? "Your next chapter."
                  : "Good to see you again."}
            </h1>
            <p className="gd-entry-form-intro">
              {isUpgrade
                ? "Connect an email or Google account to keep everything from your guest session."
                : isSignup
                  ? "Create your account and bring your studies together."
                  : "Sign in to pick up where you left off."}
            </p>

            {!isUpgrade && (
              <div className="gd-entry-mode-toggle" aria-label="Account access">
                <button
                  type="button"
                  aria-pressed={!isSignup}
                  disabled={authBusy}
                  onClick={() => {
                    setAuthNotice(null);
                    setFormError(null);
                    setIsSignup(false);
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  aria-pressed={isSignup}
                  disabled={authBusy}
                  onClick={() => {
                    setAuthNotice(null);
                    setFormError(null);
                    setIsSignup(true);
                  }}
                >
                  Create account
                </button>
              </div>
            )}

            {authNotice && (
              <div className="gd-entry-notice" role="status">
                <Mail size={16} />
                <span>{authNotice}</span>
              </div>
            )}
            {formError && (
              <div className="gd-entry-error" role="alert">
                <CircleAlert size={16} />
                <span>{formError}</span>
              </div>
            )}

            {/* Linking must preserve the anonymous user's existing work. */}
            {!(isUpgrade && native) && (
              <>
                <button
                  onClick={handleGoogle}
                  type="button"
                  disabled={authBusy}
                  className="gd-entry-google"
                >
                  {googleSubmitting ? <LoadingDots /> : <GoogleIcon />}
                  {googleSubmitting ? "Opening Google…" : "Continue with Google"}
                </button>
                <div className="gd-entry-divider">or continue with email</div>
              </>
            )}

            <form
              onSubmit={handleEmail}
              className={`gd-entry-form${isUpgrade && native ? " gd-entry-form-direct" : ""}`}
              aria-busy={authBusy}
            >
              <div className="gd-entry-field">
                <label htmlFor="gd-auth-email">Email address</label>
                <input
                  id="gd-auth-email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@example.com"
                />
              </div>
              <div className="gd-entry-field">
                <label htmlFor="gd-auth-password">Password</label>
                <div className="gd-entry-password">
                  <input
                    id="gd-auth-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isSignup || isUpgrade ? "new-password" : "current-password"}
                    aria-describedby={isSignup || isUpgrade ? "gd-auth-password-hint" : undefined}
                    placeholder={
                      isSignup || isUpgrade ? "Create a password" : "Enter your password"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="gd-entry-password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    <span>{showPassword ? "Hide" : "Show"}</span>
                  </button>
                </div>
                {(isSignup || isUpgrade) && (
                  <p id="gd-auth-password-hint" className="gd-entry-field-hint">
                    Use at least 6 characters.
                  </p>
                )}
              </div>
              <button type="submit" disabled={authBusy} className="gd-entry-submit">
                {submitting && <LoadingDots />}
                {submitting
                  ? isUpgrade
                    ? "Saving your account…"
                    : isSignup
                      ? "Creating your account…"
                      : "Signing you in…"
                  : isUpgrade
                    ? "Save my account"
                    : isSignup
                      ? "Create my account"
                      : "Sign in to G&D"}
                {!submitting && <ArrowRight size={15} />}
              </button>
            </form>

            {isUpgrade ? (
              <p className="gd-entry-switch">
                Not ready yet?{" "}
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => navigate({ to: lastRoute() })}
                >
                  Keep exploring as a guest
                </button>
              </p>
            ) : (
              <p className="gd-entry-switch">
                {isSignup ? "Already part of G&D?" : "Starting something new?"}{" "}
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    setAuthNotice(null);
                    setFormError(null);
                    setIsSignup(!isSignup);
                  }}
                >
                  {isSignup ? "Sign in" : "Create an account"}
                </button>
              </p>
            )}
          </div>
          <FounderStory className="gd-entry-founder" />
        </div>
      </main>

      <footer className="gd-entry-footer">
        <span>
          <BookOpen size={13} /> A little curiosity goes a long way.
        </span>
        <span>Make room for understanding.</span>
      </footer>
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
