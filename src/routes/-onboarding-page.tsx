import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleAlert } from "lucide-react";
import { FounderStory } from "@/components/founder-story";
import { LoadingDots } from "@/components/loading-dots";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { STUDY_LEVELS } from "@/lib/study-levels";
import { ThemeToggle } from "@/components/theme-toggle";
import "@/styles/auth-flow.css";

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
  const [saveError, setSaveError] = useState<string | null>(null);

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
    if (!user || saving) return;
    setSaving(true);
    setSaveError(null);
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
      const message = err instanceof Error ? err.message : "Could not save profile";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const onNext = () => {
    if (saving || !canContinueStep0) return;
    if (step === 0) {
      next();
    } else {
      void finish();
    }
  };

  if (loading || !user) {
    return (
      <div className="luxury-auth-page gd-entry-page items-center justify-center">
        <div className="gd-entry-loading" role="status" aria-live="polite">
          <div className="luxury-brand-text">G&D</div>
          <p>Preparing your study space…</p>
          <div className="gd-entry-loading-dots" aria-hidden="true">
            <LoadingDots />
          </div>
        </div>
      </div>
    );
  }

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
          <span className="text-xs text-muted-foreground">
            Step {step + 1} of {totalSteps}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="gd-entry-main gd-setup-main">
        <aside className="gd-entry-story gd-setup-story" aria-label="Your setup progress">
          <span className="gd-entry-eyebrow">Start with what matters</span>
          <h2>
            Your studies.
            <br />
            <span>Your starting point.</span>
          </h2>
          <p className="gd-entry-story-copy">
            A little context helps G&D explain things in the language of your course.
          </p>
          <ol className="gd-setup-step-list">
            <li
              className={`gd-setup-step${step > 0 ? " gd-setup-step-complete" : ""}`}
              aria-current={step === 0 ? "step" : undefined}
            >
              <span className="gd-setup-step-number">{step > 0 ? <Check size={14} /> : "01"}</span>
              <div>
                <span className="gd-setup-step-title">Your starting point</span>
                <span className="gd-setup-step-detail">Your name and what you study</span>
              </div>
            </li>
            <li className="gd-setup-step" aria-current={step === 1 ? "step" : undefined}>
              <span className="gd-setup-step-number">02</span>
              <div>
                <span className="gd-setup-step-title">A little more context</span>
                <span className="gd-setup-step-detail">Your school and level, if you like</span>
              </div>
            </li>
          </ol>
          <div className="gd-setup-course-note">
            <BookOpen size={17} />
            <span>
              {course.trim()
                ? `A study space for ${course.trim()}.`
                : "Every course has a place here."}
            </span>
          </div>
        </aside>

        <div className="gd-entry-form-column">
          <div className="gd-entry-panel gd-setup-panel">
            <div className="gd-setup-progress" aria-hidden="true">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span key={i} data-active={i <= step} />
              ))}
            </div>
            <span className="gd-entry-eyebrow">
              {step === 0 ? "01 / Your starting point" : "02 / Your studies"}
            </span>
            <h1>{step === 0 ? "Let’s make this yours." : "A little more context."}</h1>
            <p className="gd-entry-form-intro">
              {step === 0
                ? "Tell us what to call you and what you’re studying."
                : "Help us match your stage of study. Both fields are optional."}
            </p>

            {saveError && (
              <div className="gd-entry-error" role="alert">
                <CircleAlert size={16} />
                <span>{saveError}</span>
              </div>
            )}

            <form
              className="gd-entry-form"
              aria-busy={saving}
              onSubmit={(event) => {
                event.preventDefault();
                onNext();
              }}
            >
              {step === 0 && (
                <>
                  <div className="gd-entry-field">
                    <label htmlFor="gd-setup-name">Your name</label>
                    <input
                      id="gd-setup-name"
                      name="name"
                      autoFocus
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="What should we call you?"
                    />
                  </div>
                  <div className="gd-entry-field">
                    <label htmlFor="gd-setup-course">Course or field of study</label>
                    <input
                      id="gd-setup-course"
                      name="course"
                      required
                      value={course}
                      onChange={(e) => setCourse(e.target.value)}
                      placeholder="e.g. Nursing, Engineering, Accounting"
                      aria-describedby="gd-setup-course-hint"
                    />
                    <p id="gd-setup-course-hint" className="gd-entry-field-hint">
                      This helps us tailor explanations and examples.
                    </p>
                  </div>
                  <p className="gd-setup-required-note">Both fields are needed to get started.</p>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="gd-entry-field">
                    <label htmlFor="gd-setup-university">
                      School or university <span className="gd-setup-field-optional">Optional</span>
                    </label>
                    <input
                      id="gd-setup-university"
                      name="university"
                      autoFocus
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      placeholder="Where you study"
                    />
                  </div>
                  <fieldset>
                    <legend className="gd-entry-field-label">
                      Study level <span className="gd-setup-field-optional">Optional</span>
                    </legend>
                    <div className="gd-setup-levels">
                      {STUDY_LEVELS.map((l) => (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={level === l}
                          disabled={saving}
                          onClick={() => setLevel((current) => (current === l ? "" : l))}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    <p className="gd-entry-field-hint">
                      You can leave these blank and start studying now.
                    </p>
                  </fieldset>
                </>
              )}

              <div className="gd-setup-navigation">
                {step > 0 ? (
                  <button type="button" onClick={prev} disabled={saving} className="gd-setup-back">
                    <ArrowLeft size={14} /> Back
                  </button>
                ) : (
                  <span className="gd-setup-required-note">Step 1 of 2</span>
                )}
                <button
                  type="submit"
                  disabled={saving || (step === 0 && !canContinueStep0)}
                  className="gd-entry-submit"
                >
                  {saving ? (
                    <>
                      <LoadingDots /> Getting things ready…
                    </>
                  ) : (
                    <>
                      {step === totalSteps - 1 ? "Start studying" : "Continue"}
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
          <FounderStory className="gd-entry-founder" />
        </div>
      </main>

      <footer className="gd-entry-footer">
        <span>
          <BookOpen size={13} /> Your next good question starts here.
        </span>
        <span>Made for your way of learning.</span>
      </footer>
    </div>
  );
}
