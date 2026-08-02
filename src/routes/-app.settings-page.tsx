import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { LogOut, Trash2, Copy, Check, Sparkles } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PERSONALIZATION_PROMPT } from "@/lib/personalization";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Discipline = "medicine" | "law";
const DISCIPLINE_LABEL: Record<Discipline, string> = { medicine: "Medicine", law: "Law" };
const TRACKS: Record<Discipline, string[]> = {
  medicine: ["Pre-clinical", "Clinical"],
  law: ["LLB", "Bar / Professional", "Postgraduate"],
};

const YEARS = ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Other"] as const;
const EXAM_FORMATS = [
  { value: "MCQ" as const, label: "Quiz" },
  { value: "SAQ" as const, label: "Short answer" },
  { value: "OSCE" as const, label: "Practical" },
  { value: "Viva" as const, label: "Oral" },
];
const MODES = ["Simplified", "Detailed"] as const;

export function SettingsPage() {
  const { user, profile, refreshProfile, signOut, deleteAccount } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [track, setTrack] = useState<string>("");
  const [university, setUniversity] = useState("");
  const [year, setYear] = useState<string>("Year 1");
  const [examFormat, setExamFormat] = useState<"MCQ" | "SAQ" | "OSCE" | "Viva">("MCQ");
  const [mode, setMode] = useState<"Simplified" | "Detailed">("Simplified");
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [background, setBackground] = useState("");
  const [savedBackground, setSavedBackground] = useState("");
  const [savingBackground, setSavingBackground] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setDiscipline(profile.discipline ?? null);
    setTrack(profile.study_track ?? "");
    setUniversity(profile.university ?? "");
    setYear(profile.year ?? "Year 1");
    setExamFormat(profile.exam_format ?? "MCQ");
    setMode(profile.preferred_mode ?? "Simplified");
    setBackground(profile.personalization_background ?? "");
    setSavedBackground(profile.personalization_background ?? "");
  }, [profile]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PERSONALIZATION_PROMPT);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      toast.error("Couldn't copy automatically — select the text and copy it.");
    }
  };

  const saveBackground = async (next: string) => {
    if (!user || savingBackground) return;
    setSavingBackground(true);
    try {
      const value = next.trim();
      const { error } = await supabase
        .from("user_profiles")
        .update({ personalization_background: value || null })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      setBackground(value);
      setSavedBackground(value);
      toast.success(value ? "Personalization saved" : "Personalization removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save personalization");
    } finally {
      setSavingBackground(false);
    }
  };

  // Switching discipline changes which tracks apply; default to the first.
  const chooseDiscipline = (d: Discipline) => {
    setDiscipline(d);
    if (!TRACKS[d].includes(track)) setTrack(TRACKS[d][0]);
  };

  const save = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      const courseLabel = discipline
        ? `${DISCIPLINE_LABEL[discipline]}${track ? ` - ${track}` : ""}`
        : (profile?.course ?? null);
      const { error } = await supabase
        .from("user_profiles")
        .update({
          name,
          discipline,
          study_track: track || null,
          course: courseLabel,
          university,
          year,
          exam_format: examFormat,
          preferred_mode: mode,
        })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await deleteAccount();
      navigate({ to: "/" });
    } catch {
      setDeletingAccount(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account and all associated data - documents,
              conversations, study plans, and profile information. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              disabled={deletingAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAccount ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-5 sm:px-4 sm:py-8 sm:gap-5 md:px-8">
        <PageHeader
          eyebrow="Settings"
          title="Settings"
          subtitle="Personalize how G&D answers and manage your account."
          className="mb-2 sm:mb-3"
        />

        {/* Profile */}
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">Your profile</h2>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Course</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["medicine", "law"] as Discipline[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => chooseDiscipline(d)}
                    className={`rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
                      discipline === d
                        ? "border-pop/45 bg-pop/10 text-pop"
                        : "border-border bg-background hover:bg-surface-elevated"
                    }`}
                  >
                    {DISCIPLINE_LABEL[d]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Changes how G&amp;D reasons, the examples it uses, and the look of the app.
              </p>
            </div>

            {discipline && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Stage</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {TRACKS[discipline].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTrack(t)}
                      className={`rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
                        track === t
                          ? "border-pop/45 bg-pop/10 text-pop"
                          : "border-border bg-background hover:bg-surface-elevated"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                School, college, or university
              </label>
              <input
                value={university}
                onChange={(e) => setUniversity(e.target.value)}
                placeholder="Where you study"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Year / level</label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {YEARS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setYear(item)}
                    className={`rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
                      year === item
                        ? "border-pop/45 bg-pop/10 text-pop"
                        : "border-border bg-background hover:bg-surface-elevated"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Exam format</label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {EXAM_FORMATS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setExamFormat(item.value)}
                    className={`rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
                      examFormat === item.value
                        ? "border-pop/45 bg-pop/10 text-pop"
                        : "border-border bg-background hover:bg-surface-elevated"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Default explanation style
              </label>
              <Segmented
                className="mt-2"
                options={MODES}
                value={mode}
                onChange={setMode}
              />
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="btn-pop inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {saving && <LoadingDots />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        {/* Personalization */}
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-pop">
              <Sparkles className="h-3.5 w-3.5 text-pop" />
              Personalization
            </h2>
            {savedBackground ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-leaf/30 bg-leaf/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-leaf">
                <Check className="h-3 w-3" />
                Active
              </span>
            ) : (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Not set up
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Bring what another AI already knows about you into G&D. Copy the prompt, paste it into
            the AI you study with, then paste its reply below — G&D uses it to tailor every answer.
          </p>

          <div className="mt-4 rounded-lg border border-border bg-background/60 p-3">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {PERSONALIZATION_PROMPT}
            </p>
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="btn-pop mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedPrompt ? "Copied" : "Copy prompt"}
            </button>
          </div>

          <label className="mt-4 block text-xs font-medium text-muted-foreground">
            What your AI knows about you
          </label>
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            rows={5}
            placeholder="Paste what your AI said about you here…"
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void saveBackground(background)}
              disabled={savingBackground || background.trim() === savedBackground}
              className="btn-pop inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold"
            >
              {savingBackground && <LoadingDots />}
              {savingBackground ? "Saving…" : "Save personalization"}
            </button>
            {savedBackground && (
              <button
                type="button"
                onClick={() => void saveBackground("")}
                disabled={savingBackground}
                className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            )}
          </div>
        </section>

        {/* Appearance */}
        <section className="flex items-center justify-between rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cycle through dark, light and brutal.
            </p>
          </div>
          <ThemeToggle />
        </section>

        {/* Account */}
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">Account</h2>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate({ to: "/" });
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-destructive/40 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete account
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
