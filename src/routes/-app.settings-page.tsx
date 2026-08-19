import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, Copy, Flame, LogOut, Sparkles, Upload } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { RankSummary } from "@/components/rank-badge";
import { uploadAllowance } from "@/lib/allowances";
import { emptyGamificationStats, loadGamificationStats } from "@/lib/gamification";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PERSONALIZATION_PROMPT } from "@/lib/personalization";
import { studyLevelOptions } from "@/lib/study-levels";
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

// Settings used to be one long scroll of unrelated controls with two separate
// save buttons and a paragraph under half of them. It is now four plain groups
// in the order a student thinks about them - who I am, how G&D answers, how it
// looks, my account - with a single save.
//
// Two structural rules hold this together:
//   1. ONE primary action. Every field on this page writes to the same row in
//      user_profiles, so there is no reason to make people save twice. The save
//      bar is sticky and only appears once something has actually changed, so
//      the screen is quiet until there is a decision to make.
//   2. Rare or destructive things get out of the way. The personalization
//      import is a once-ever setup with a long prompt to copy, so it lives
//      behind a disclosure; deleting an account sits last, quiet, under a rule.
//
// The medicine/law picker that used to sit at the top is gone entirely: course
// is free text now and the AI adapts from it, so there is nothing to choose.

const EXAM_FORMATS = ["MCQ", "SAQ", "OSCE", "Viva"] as const;
const EXAM_FORMAT_LABEL: Record<(typeof EXAM_FORMATS)[number], string> = {
  MCQ: "Quiz",
  SAQ: "Short answer",
  OSCE: "Practical",
  Viva: "Oral",
};
const MODES = ["Simplified", "Detailed"] as const;

type ExamFormat = (typeof EXAM_FORMATS)[number];
type Mode = (typeof MODES)[number];

export function SettingsPage() {
  const { user, profile, refreshProfile, signOut, deleteAccount } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [university, setUniversity] = useState("");
  const [level, setLevel] = useState("");
  const [examFormat, setExamFormat] = useState<ExamFormat>("MCQ");
  const [mode, setMode] = useState<Mode>("Simplified");
  const [background, setBackground] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [stats, setStats] = useState(emptyGamificationStats);

  useEffect(() => {
    if (!user) return;
    setStats(loadGamificationStats(user.id));
    const onChange = () => setStats(loadGamificationStats(user.id));
    window.addEventListener("gd:gamification", onChange);
    return () => window.removeEventListener("gd:gamification", onChange);
  }, [user]);

  const allowance = uploadAllowance(user?.id ?? "guest", stats.points);

  // The saved profile is the single baseline: the form hydrates from it, the
  // dirty check compares against it, and Discard snaps back to it.
  const saved = {
    name: profile?.name ?? "",
    course: profile?.course ?? "",
    university: profile?.university ?? "",
    level: profile?.year ?? "",
    examFormat: profile?.exam_format ?? "MCQ",
    mode: profile?.preferred_mode ?? "Simplified",
    background: profile?.personalization_background ?? "",
  };

  const hydrate = () => {
    setName(saved.name);
    setCourse(saved.course);
    setUniversity(saved.university);
    setLevel(saved.level);
    setExamFormat(saved.examFormat);
    setMode(saved.mode);
    setBackground(saved.background);
  };

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setCourse(profile.course ?? "");
    setUniversity(profile.university ?? "");
    setLevel(profile.year ?? "");
    setExamFormat(profile.exam_format ?? "MCQ");
    setMode(profile.preferred_mode ?? "Simplified");
    setBackground(profile.personalization_background ?? "");
  }, [profile]);

  const dirty =
    name !== saved.name ||
    course !== saved.course ||
    university !== saved.university ||
    level !== saved.level ||
    examFormat !== saved.examFormat ||
    mode !== saved.mode ||
    background.trim() !== saved.background.trim();

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PERSONALIZATION_PROMPT);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      toast.error("Couldn't copy automatically — select the text and copy it.");
    }
  };

  const save = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({
          name: name.trim() || null,
          course: course.trim() || null,
          university: university.trim() || null,
          year: level || null,
          exam_format: examFormat,
          preferred_mode: mode,
          personalization_background: background.trim() || null,
          // The discipline and study_track columns still exist, but nothing
          // reads them for teaching any more - the AI adapts from the free-text
          // course. Clearing them on save retires the old medicine/law values
          // instead of leaving them to rot on the row.
          discipline: null,
          study_track: null,
        })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      toast.success("Saved");
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

  const levelOptions = studyLevelOptions(saved.level);

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

      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-5 sm:gap-5 sm:px-4 sm:py-8 md:px-8">
        <PageHeader eyebrow="Settings" title="Settings" className="mb-1 sm:mb-2" />

        {/* ── You ── */}
        <Section title="You">
          <Field label="Name">
            <TextInput value={name} onChange={setName} placeholder="Your full name" />
          </Field>

          <Field label="What you study">
            <TextInput
              value={course}
              onChange={setCourse}
              placeholder="e.g. Mechanical Engineering, Nursing, Accounting, Law"
            />
          </Field>

          <Field label="School or university">
            <TextInput value={university} onChange={setUniversity} placeholder="Where you study" />
          </Field>

          <Field label="Level">
            <ChoiceGrid
              options={levelOptions}
              value={level}
              onChange={setLevel}
              className="grid-cols-2 sm:grid-cols-4"
            />
          </Field>
        </Section>

        {/* ── Answers ── */}
        <Section title="Answers">
          <Field label="Exam format">
            <Segmented
              options={EXAM_FORMATS}
              value={examFormat}
              onChange={setExamFormat}
              getLabel={(value) => EXAM_FORMAT_LABEL[value]}
            />
          </Field>

          <Field label="Explanation style">
            <Segmented options={MODES} value={mode} onChange={setMode} />
          </Field>

          {/* Importing a background from another AI is a once-ever setup with a
              long prompt to copy, so it stays folded away until wanted. The
              summary still carries its state, so nobody has to open it to find
              out whether it is switched on. */}
          <details className="group rounded-xl border border-border bg-background/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <Sparkles className="h-4 w-4 shrink-0 text-pop" />
              Personalization
              {background.trim() ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-leaf/30 bg-leaf/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-leaf">
                  <Check className="h-3 w-3" />
                  On
                </span>
              ) : (
                <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Off
                </span>
              )}
            </summary>

            <div className="space-y-3 border-t border-border px-3 py-3">
              <div className="rounded-lg border border-border bg-background/60 p-3">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                  {PERSONALIZATION_PROMPT}
                </p>
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  className="btn-pop mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  {copiedPrompt ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedPrompt ? "Copied" : "Copy prompt"}
                </button>
              </div>

              <textarea
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                rows={5}
                placeholder="Paste your AI's reply here…"
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
              />
            </div>
          </details>
        </Section>

        {/* ── Rank + what it has earned. Framed as an expansion, never a budget:
            the upload line says what this rank has ADDED, and nothing here is
            enforced (see the header note in src/lib/allowances.ts). ── */}
        <Section title="Your rank">
          <RankSummary points={stats.points} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat icon={<Flame className="h-3.5 w-3.5" />} label="Streak">
              {stats.currentStreak}d
              <span className="ml-2 text-xs text-muted-foreground">
                best {stats.longestStreak}d
              </span>
            </Stat>
            <Stat icon={<Upload className="h-3.5 w-3.5" />} label="Daily uploads">
              {allowance.total}
              <span className="ml-2 text-xs text-muted-foreground">
                {allowance.rankBonus > 0
                  ? `${allowance.base} base + ${allowance.rankBonus} rank bonus`
                  : allowance.nextBonusRankName
                    ? `${allowance.base} base · ${allowance.nextBonusRankName} makes it ${allowance.nextBonusTotal}`
                    : `${allowance.base} base`}
              </span>
            </Stat>
          </div>
        </Section>

        {/* ── Appearance + account: the app-level controls, kept out of the way
            of the study settings above. ── */}
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">Appearance</h2>
            <ThemeToggle />
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">Account</h2>
            <p className="mt-2 truncate text-sm text-muted-foreground">{user?.email}</p>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate({ to: "/" });
              }}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground sm:w-auto"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>

          {/* Last thing on the page, deliberately quiet: irreversible, rarely
              wanted, and already guarded by a confirmation dialog. */}
          <div className="mt-5 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline"
            >
              Delete account
            </button>
          </div>
        </section>

        {/* The one primary action, and it only exists when there is something
            to save. Sticky so it stays reachable from anywhere in the scroll. */}
        {dirty && (
          <div className="sticky bottom-0 z-10 -mx-3 flex items-center justify-end gap-2 border-t border-border bg-background/85 px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4 md:-mx-8 md:px-8">
            <button
              type="button"
              onClick={hydrate}
              disabled={saving}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              Discard
            </button>
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
        )}
      </div>
    </div>
  );
}

// ─── Layout primitives ───────────────────────────────────────────────────────
// Small and local on purpose: every group on this page is a titled card of
// evenly spaced fields, and spelling that out once keeps the rhythm identical
// without another shared component to maintain.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
    />
  );
}

function ChoiceGrid({
  options,
  value,
  onChange,
  className = "",
}: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`grid gap-2 ${className}`}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          // Re-tapping the active choice clears it, so an answer given by
          // accident can be taken back without a "none" button.
          onClick={() => onChange(value === option ? "" : option)}
          className={`rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
            value === option
              ? "border-pop/45 bg-pop/10 text-pop"
              : "border-border bg-background hover:bg-surface-elevated"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Stat({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-display text-xl font-light tabular-nums">{children}</div>
    </div>
  );
}
