import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { FounderStory } from "@/components/founder-story";
import { LoadingDots } from "@/components/loading-dots";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { STUDY_LEVELS } from "@/lib/study-levels";
import { ThemeToggle } from "@/components/theme-toggle";

// Onboarding used to open with a medicine-or-law card picker, and the rest of
// the app branched off that one choice. G&D is open to every course now, so the
// first thing we ask is simply what the student studies, in their own words -
// that free text is what steers the AI's reasoning, vocabulary, and examples.
//
// Two steps, four fields, and only two of them are required. Name and field of
// study genuinely change every answer, so they come first and the Continue
// button gates on them. School and level only refine the pitch, so step 2 never
// blocks anyone: leave both blank and "Start studying" still works. Nothing
// here justifies itself in a paragraph either - if a question needs a sentence
// of explanation to be worth answering, it does not belong in a new student's
// first sixty seconds.
export function OnboardingPage() {
  return <OnboardingFlow />;
}

function OnboardingFlow() {
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 0 - the two answers that actually change how G&D replies.
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");

  // Step 1 - refinements, both optional.
  const [university, setUniversity] = useState("");
  const [level, setLevel] = useState("");

  const totalSteps = 2;

  useEffect(() => {
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

  const next = () => setStep((s) => s + 1);
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const canContinueStep0 = name.trim().length > 0 && course.trim().length > 0;

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("user_profiles").upsert({
        id: user.id,
        name: name.trim(),
        course: course.trim(),
        university: university.trim() || null,
        year: level || null,
        // The discipline and study_track columns stay in the database, but
        // nothing reads them for teaching any more - the AI adapts from the
        // free-text course. We write null so no student is left sitting on a
        // stale medicine/law branch.
        discipline: null,
        study_track: null,
        onboarded: true,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success("All set. Ask your first question.");
      navigate({ to: "/app/chat" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  const onNext = () => {
    if (step === 0) {
      next();
    } else {
      void finish();
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

  return (
    <div className="luxury-auth-page relative flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto bg-background">
      <div className="symbiote-blob auth-blob-one" />
      <div className="symbiote-blob auth-blob-two" />

      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="luxury-brand-text">G&D</div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="truncate text-xs text-muted-foreground">
            Step {step + 1} of {totalSteps}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 items-start justify-center px-4 pb-8 pt-6 sm:items-center sm:px-6 sm:pb-12 sm:pt-6">
        <div className="w-full max-w-lg">
          {/* Progress bar */}
          <div className="mb-4 flex gap-1 sm:mb-6">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>

          <div className="luxury-panel rounded-lg p-5 shadow-elegant backdrop-blur sm:p-8">
            {/* ── Step 0: name + field of study (both required) ── */}
            {step === 0 && (
              <>
                <h2 className="text-xs font-medium uppercase tracking-wider text-primary-glow">
                  About you
                </h2>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  What are you studying?
                </h1>

                <div className="mt-6 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Your name
                    </label>
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Course or field of study
                    </label>
                    <input
                      value={course}
                      onChange={(e) => setCourse(e.target.value)}
                      placeholder="e.g. Mechanical Engineering, Nursing, Accounting, Law"
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── Step 1: school + level (both optional, never blocking) ── */}
            {step === 1 && (
              <>
                <h2 className="text-xs font-medium uppercase tracking-wider text-primary-glow">
                  Your studies
                </h2>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  Where are you studying?
                </h1>

                <div className="mt-6 space-y-4">
                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      School or university
                      <span className="text-[10px] font-normal opacity-60">optional</span>
                    </label>
                    <input
                      autoFocus
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      placeholder="Where you study"
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      Level
                      <span className="text-[10px] font-normal opacity-60">optional</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {STUDY_LEVELS.map((l) => (
                        <button
                          key={l}
                          type="button"
                          // Tapping the selected level again clears it, so an
                          // optional field stays genuinely optional once
                          // someone has touched it.
                          onClick={() => setLevel((current) => (current === l ? "" : l))}
                          className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                            level === l
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-background hover:bg-surface-elevated"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Navigation */}
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
              <button
                type="button"
                onClick={onNext}
                disabled={saving || (step === 0 && !canContinueStep0)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-4 py-2.5 font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50 sm:px-5"
              >
                {saving && <LoadingDots />}
                {step === totalSteps - 1 ? "Start studying" : "Continue"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <FounderStory className="mt-4" />
        </div>
      </main>
    </div>
  );
}
