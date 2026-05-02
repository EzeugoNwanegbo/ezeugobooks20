import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Loader2, ArrowRight, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [{ title: "Set up your profile — MedAI Hub" }],
  }),
  component: OnboardingPage,
});

const STEPS = ["About you", "Your studies", "Your exams", "Your style"] as const;

function OnboardingPage() {
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [year, setYear] = useState("300L");
  const [examFormat, setExamFormat] = useState<"MCQ" | "SAQ" | "OSCE" | "Viva">("MCQ");
  const [mode, setMode] = useState<"Simplified" | "Detailed">("Simplified");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
    if (profile?.onboarded) navigate({ to: "/app/chat" });
    if (profile?.name && !name) setName(profile.name);
  }, [loading, user, profile, navigate, name]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({
          name,
          university,
          year,
          exam_format: examFormat,
          preferred_mode: mode,
          onboarded: true,
        })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      toast.success("You're all set!");
      navigate({ to: "/app/chat" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="luxury-auth-page min-h-screen flex items-center justify-center">
        <div className="symbiote-blob auth-blob-one" />
        <div className="symbiote-blob auth-blob-two" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="luxury-auth-page min-h-screen bg-background relative overflow-hidden flex flex-col">
      <div className="symbiote-blob auth-blob-one" />
      <div className="symbiote-blob auth-blob-two" />

      <header className="relative z-10 px-6 py-6 flex items-center justify-between">
        <div className="luxury-brand-text">MedAI Hub</div>
        <span className="text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </span>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-lg">
          {/* progress */}
          <div className="flex gap-1 mb-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>

          <div className="luxury-panel rounded-lg p-8 shadow-elegant backdrop-blur">
            <h2 className="text-xs font-medium uppercase tracking-wider text-primary-glow">
              {STEPS[step]}
            </h2>

            {step === 0 && (
              <>
                <h1 className="font-display text-4xl font-light leading-none mt-3">
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
                <h1 className="font-display text-4xl font-light leading-none mt-3">
                  Where do you study?
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Your university and current year so answers fit your curriculum.
                </p>
                <div className="mt-6 space-y-3">
                  <input
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    placeholder="University (e.g. University of Lagos)"
                    className="w-full px-4 py-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-base"
                  />
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Current year/level
                    </label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {["100L", "200L", "300L", "400L", "500L", "600L"].map((y) => (
                        <button
                          key={y}
                          type="button"
                          onClick={() => setYear(y)}
                          className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                            year === y
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-background hover:bg-surface-elevated"
                          }`}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="font-display text-4xl font-light leading-none mt-3">
                  Your exam format?
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  We'll tailor exam tips and practice questions to match.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  {(["MCQ", "SAQ", "OSCE", "Viva"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setExamFormat(f)}
                      className={`py-3 rounded-lg border font-semibold transition-colors ${
                        examFormat === f
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-background hover:bg-surface-elevated"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="font-display text-4xl font-light leading-none mt-3">
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
                      body: "Full mechanisms, clinical correlations, exam pearls.",
                    },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setMode(o.v)}
                      className={`w-full text-left p-4 rounded-lg border transition-colors ${
                        mode === o.v
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:bg-surface-elevated"
                      }`}
                    >
                      <div className="font-semibold">{o.title}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{o.body}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={prev}
                disabled={step === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={next}
                  disabled={(step === 0 && !name.trim()) || (step === 1 && !university.trim())}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-gradient-primary text-primary-foreground font-medium shadow-glow hover:opacity-90 disabled:opacity-50"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finish}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-gradient-primary text-primary-foreground font-medium shadow-glow hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
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
