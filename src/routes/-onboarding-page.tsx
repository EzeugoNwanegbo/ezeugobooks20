import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";

const STEPS = ["About you", "Your studies", "Your exams", "Your style"] as const;

export function OnboardingPage() {
  return <OnboardingFlow />;
}

function OnboardingFlow() {
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile } = useAuth();
  // One-time welcome screen shown before the profile wizard. The whole
  // onboarding flow only ever renders for not-yet-onboarded users, so this is
  // naturally shown once and never again to returning users.
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [year, setYear] = useState("Year 1");
  const [examFormat, setExamFormat] = useState<"MCQ" | "SAQ" | "OSCE" | "Viva">("MCQ");
  const [mode, setMode] = useState<"Simplified" | "Detailed">("Simplified");

  useEffect(() => {
    // Wait for auth to settle before deciding anything — never redirect on the
    // transient loading=false/user=null window.
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (profile?.onboarded) {
      navigate({ to: "/app/chat" });
      return;
    }
    if (profile?.name && !name) setName(profile.name);
  }, [loading, user, profile, navigate, name]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("user_profiles").upsert({
        id: user.id,
        name,
        university,
        year,
        exam_format: examFormat,
        preferred_mode: mode,
        onboarded: true,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success("You're all set! Ask your first question.");
      navigate({ to: "/app/chat" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="luxury-auth-page flex min-h-dvh items-center justify-center">
        <div className="symbiote-blob auth-blob-one" />
        <div className="symbiote-blob auth-blob-two" />
        <div className="text-center">
          <div className="luxury-brand-text">G&D</div>
          <p className="mt-2 text-xs text-muted-foreground">Preparing your setup...</p>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="luxury-auth-page relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-6 text-center">
        <div className="symbiote-blob auth-blob-one" />
        <div className="symbiote-blob auth-blob-two" />
        <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>
        <div className="relative z-10 flex flex-col items-center">
          <div className="luxury-brand-text text-6xl sm:text-7xl">G&D</div>
          <span
            aria-hidden="true"
            className="ai-symbiote-mark is-active mt-8 inline-flex h-20 w-20 items-center justify-center sm:h-24 sm:w-24"
          >
            <span className="ai-symbiote-dot h-3 w-3" />
          </span>
          <p className="mt-8 max-w-xs text-sm text-muted-foreground sm:text-base">
            Upload your study files and get exact, source-backed answers in seconds.
          </p>
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="mt-10 inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
          >
            Get Started
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="luxury-auth-page relative flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto bg-background">
      <div className="symbiote-blob auth-blob-one" />
      <div className="symbiote-blob auth-blob-two" />

      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="luxury-brand-text">G&D</div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="truncate text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-start justify-center px-4 pb-8 pt-6 sm:items-center sm:px-6 sm:pb-12 sm:pt-6">
        <div className="w-full max-w-lg">
          <div className="mb-4 flex gap-1 sm:mb-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>

          <div className="luxury-panel rounded-lg p-5 shadow-elegant backdrop-blur sm:p-8">
            <h2 className="text-xs font-medium uppercase tracking-wider text-primary-glow">
              {STEPS[step]}
            </h2>

            {step === 0 && (
              <>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  What's your name?
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  We use this to personalize your study sessions.
                </p>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="mt-6 w-full px-4 py-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-base"
                />
              </>
            )}

            {step === 1 && (
              <>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  Where are you studying?
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Your school and current level help answers fit your course.
                </p>
                <div className="mt-6 space-y-3">
                  <input
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    placeholder="School, college, or university"
                    className="w-full px-4 py-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-base"
                  />
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Current year/level
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {["Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Other"].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setYear(item)}
                          className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                            year === item
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-background hover:bg-surface-elevated"
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  Your exam format?
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  We'll tailor exam tips and practice questions to match.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  {[
                    { value: "MCQ" as const, label: "Quiz" },
                    { value: "SAQ" as const, label: "Short answer" },
                    { value: "OSCE" as const, label: "Practical" },
                    { value: "Viva" as const, label: "Oral" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setExamFormat(item.value)}
                      className={`py-3 rounded-lg border font-semibold transition-colors ${
                        examFormat === item.value
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-background hover:bg-surface-elevated"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  How should we explain?
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  You can switch this any time during a chat.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    {
                      v: "Simplified" as const,
                      title: "Simplified",
                      body: "Plain English, real-world analogies, short answers.",
                    },
                    {
                      v: "Detailed" as const,
                      title: "Detailed",
                      body: "Deeper reasoning, key details, examples, and exam points.",
                    },
                  ].map((item) => (
                    <button
                      key={item.v}
                      type="button"
                      onClick={() => setMode(item.v)}
                      className={`w-full text-left p-4 rounded-lg border transition-colors ${
                        mode === item.v
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:bg-surface-elevated"
                      }`}
                    >
                      <div className="font-semibold">{item.title}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{item.body}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-7 flex items-center justify-between gap-3 sm:mt-8">
              <button
                type="button"
                onClick={prev}
                disabled={step === 0}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 sm:px-3"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={next}
                  disabled={(step === 0 && !name.trim()) || (step === 1 && !university.trim())}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-4 py-2.5 font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50 sm:px-5"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finish}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-4 py-2.5 font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50 sm:px-5"
                >
                  {saving && <LoadingDots />}
                  Start studying
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
