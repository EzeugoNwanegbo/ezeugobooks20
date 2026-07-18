import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Scale, Stethoscope } from "lucide-react";
import { FounderStory } from "@/components/founder-story";
import { LoadingDots } from "@/components/loading-dots";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";

type Discipline = "medicine" | "law";

// Sub-tracks per discipline. The chosen track is stored on the profile and
// feeds the AI's reasoning framework (pitch/depth), so keep the labels concrete.
const TRACKS: Record<Discipline, string[]> = {
  medicine: ["Pre-clinical", "Clinical"],
  law: ["LLB", "Bar / Professional", "Postgraduate"],
};

const DISCIPLINE_LABEL: Record<Discipline, string> = {
  medicine: "Medicine",
  law: "Law",
};

export function OnboardingPage() {
  return <OnboardingFlow />;
}

function OnboardingFlow() {
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 0 fields
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline | null>(null);

  // Step 1 fields
  const [university, setUniversity] = useState("");
  const [level, setLevel] = useState("100");
  const [track, setTrack] = useState<string>("");

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

  const canContinueStep0 = name.trim().length > 0 && discipline !== null;
  const canContinueStep1 = university.trim().length > 0 && track.length > 0;

  const chooseDiscipline = (d: Discipline) => {
    setDiscipline(d);
    // Default the track to the first option for that discipline so step 1 is
    // valid immediately; the student can change it there.
    setTrack(TRACKS[d][0]);
  };

  const finish = async () => {
    if (!user || !discipline) return;
    setSaving(true);
    try {
      const courseLabel = `${DISCIPLINE_LABEL[discipline]}${track ? ` - ${track}` : ""}`;
      const { error } = await supabase.from("user_profiles").upsert({
        id: user.id,
        name: name.trim(),
        university: university.trim(),
        year: level,
        discipline,
        study_track: track,
        // Keep the free-text `course` column populated for backward compatibility
        // and any UI that still reads it.
        course: courseLabel,
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
            The study AI built for medical and law students. Upload your material and get exact,
            source-backed answers in seconds.
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
            {/* ── Step 0: Name + Discipline ── */}
            {step === 0 && (
              <>
                <h2 className="text-xs font-medium uppercase tracking-wider text-primary-glow">
                  About you
                </h2>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  What are you studying?
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  G&D tunes its answers to your field, so this matters.
                </p>

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
                      Your course
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <DisciplineCard
                        selected={discipline === "medicine"}
                        onClick={() => chooseDiscipline("medicine")}
                        icon={<Stethoscope className="h-6 w-6" />}
                        title="Medicine"
                        subtitle="Clinical reasoning, high-yield exam prep"
                      />
                      <DisciplineCard
                        selected={discipline === "law"}
                        onClick={() => chooseDiscipline("law")}
                        icon={<Scale className="h-6 w-6" />}
                        title="Law"
                        subtitle="IRAC, cases, statutes & problem questions"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Step 1: School + Track + Level ── */}
            {step === 1 && discipline && (
              <>
                <h2 className="text-xs font-medium uppercase tracking-wider text-primary-glow">
                  Your studies
                </h2>
                <h1 className="mt-3 font-display text-3xl font-light leading-none sm:text-4xl">
                  Where are you studying?
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your school, stage, and level help answers fit your{" "}
                  {DISCIPLINE_LABEL[discipline].toLowerCase()} course.
                </p>

                <div className="mt-6 space-y-4">
                  <input
                    autoFocus
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    placeholder="School, college, or university"
                    className="w-full rounded-lg border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                  />

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Stage
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {TRACKS[discipline].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTrack(t)}
                          className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                            track === t
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-background hover:bg-surface-elevated"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Current level
                    </label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {["100", "200", "300", "400", "500", "600"].map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setLevel(l)}
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
                disabled={
                  saving ||
                  (step === 0 && !canContinueStep0) ||
                  (step === 1 && !canContinueStep1)
                }
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

function DisciplineCard({
  selected,
  onClick,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-background hover:bg-surface-elevated"
      }`}
    >
      <span className={selected ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <span className="text-base font-semibold">{title}</span>
      <span
        className={`text-xs leading-snug ${
          selected ? "text-primary/80" : "text-muted-foreground"
        }`}
      >
        {subtitle}
      </span>
    </button>
  );
}
