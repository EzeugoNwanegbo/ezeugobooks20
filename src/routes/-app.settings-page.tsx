import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
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
  const [university, setUniversity] = useState("");
  const [year, setYear] = useState<string>("Year 1");
  const [examFormat, setExamFormat] = useState<"MCQ" | "SAQ" | "OSCE" | "Viva">("MCQ");
  const [mode, setMode] = useState<"Simplified" | "Detailed">("Simplified");
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setUniversity(profile.university ?? "");
    setYear(profile.year ?? "Year 1");
    setExamFormat(profile.exam_format ?? "MCQ");
    setMode(profile.preferred_mode ?? "Simplified");
  }, [profile]);

  const save = async () => {
    if (!user || saving) return;
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
              This permanently deletes your account and all associated data — documents,
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

      <div className="mx-auto max-w-2xl px-3 py-5 sm:px-4 sm:py-8 md:px-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="font-display text-4xl font-light leading-none sm:text-5xl">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:mt-1">
            Personalize how G&D answers and manage your account.
          </p>
        </div>

        {/* Profile */}
        <section className="luxury-panel rounded-lg p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-primary-glow">
            Your profile
          </h2>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                School, college, or university
              </label>
              <input
                value={university}
                onChange={(e) => setUniversity(e.target.value)}
                placeholder="Where you study"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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

            <div>
              <label className="text-xs font-medium text-muted-foreground">Exam format</label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {EXAM_FORMATS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setExamFormat(item.value)}
                    className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                      examFormat === item.value
                        ? "border-primary bg-primary/15 text-primary"
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
              <div className="mt-2 grid grid-cols-2 gap-2">
                {MODES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                      mode === item
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background hover:bg-surface-elevated"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        {/* Appearance */}
        <section className="luxury-panel mt-4 flex items-center justify-between rounded-lg p-5 sm:p-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-primary-glow">
              Appearance
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Switch between light and dark.</p>
          </div>
          <ThemeToggle />
        </section>

        {/* Account */}
        <section className="luxury-panel mt-4 rounded-lg p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-primary-glow">
            Account
          </h2>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate({ to: "/" });
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-destructive/40 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
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
