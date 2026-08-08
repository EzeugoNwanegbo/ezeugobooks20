import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { PERSONALIZATION_PROMPT } from "@/lib/personalization";

/**
 * The "who I am" import flow: copy a prompt, run it in whatever AI the student
 * already studies with, paste the reply back here, and it is saved to the
 * profile and fed into every G&D answer.
 *
 * One component, two surfaces, so the copy and the paste box can never drift:
 *   variant="card"  - the in-chat nudge (own chrome + a dismiss X).
 *   variant="plain" - the body of the sidebar's Personalize dialog, which
 *                     brings its own frame and close button.
 *
 * Both surfaces hand `onSave` the trimmed draft; saving an empty box clears a
 * background that already exists (see savePersonalizationBackground).
 */
export function PersonalizationPanel({
  initialBackground,
  onSave,
  onDismiss,
  variant = "card",
  note,
  readOnly = false,
}: {
  initialBackground: string;
  onSave: (text: string) => Promise<void>;
  onDismiss?: () => void;
  variant?: "card" | "plain";
  note?: ReactNode;
  /** Guests with nowhere to save: show the flow, disable the write. */
  readOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(initialBackground);
  const [saving, setSaving] = useState(false);

  // Reopening the dialog after a save must show what is actually stored, not a
  // stale first-mount draft.
  useEffect(() => {
    setDraft(initialBackground);
  }, [initialBackground]);

  const hasSaved = initialBackground.trim().length > 0;
  const dirty = draft.trim() !== initialBackground.trim();

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PERSONALIZATION_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy automatically — select the text and copy it.");
    }
  };

  const save = async () => {
    if (!dirty || saving || readOnly) return;
    setSaving(true);
    try {
      await onSave(draft.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={
        variant === "card"
          ? "relative mx-auto mb-6 max-w-2xl overflow-hidden rounded-2xl border border-pop/25 bg-pop/[0.04] p-4 text-left sm:p-5"
          : "text-left"
      }
    >
      {/* A full 44x44 target (the mobile Capacitor build is a real target), with
          its own outline and fill so it reads as a control rather than as
          decoration - the 28px muted glyph it replaces was hard to find and
          harder to hit. The glyph is --foreground at 80%, not --muted-foreground:
          a dismiss control is not a hint. Tokens only (--border, --background,
          --foreground, --pop).
          The header below reserves room for it so nothing runs underneath
          at narrow widths. Focus is an `outline`, not a ring: rings are
          box-shadows, and the .neo skin overwrites box-shadow on every bordered
          rounded box, which would swallow it. */}
      {variant === "card" && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background/80 text-foreground/80 transition-colors hover:border-pop/50 hover:bg-pop/10 hover:text-pop focus-visible:text-pop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pop sm:right-3 sm:top-3"
        >
          <X className="h-5 w-5" strokeWidth={2.25} />
        </button>
      )}

      {variant === "card" && (
        <>
          <div
            className={`flex items-center gap-1.5 text-pop ${onDismiss ? "pr-12 sm:pr-14" : ""}`}
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
              Personalize G&amp;D
            </span>
          </div>
          <h3
            className={`mt-2 text-lg font-semibold tracking-[-0.01em] text-foreground ${onDismiss ? "pr-12 sm:pr-14" : ""}`}
          >
            {hasSaved
              ? "Your background — edit it any time"
              : "Make G&D understand you from day one"}
          </h3>
        </>
      )}

      <p
        className={`text-sm leading-relaxed text-muted-foreground ${variant === "card" ? "mt-1" : ""}`}
      >
        Already study with another AI? It has learned how you think and where you struggle. Bring
        that over so every G&amp;D answer is tailored to you — no starting from scratch.
      </p>

      <ol className="mt-3 space-y-1.5 text-sm text-foreground">
        <li className="flex gap-2">
          <span className="font-semibold text-pop">1.</span> Copy the prompt below.
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-pop">2.</span> Paste it into the AI you already study
          with (ChatGPT, etc.).
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-pop">3.</span> Copy its reply and paste it in the box.
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-pop">4.</span> Save — and you're personalized.
        </li>
      </ol>

      <div className="mt-3 rounded-xl border border-border/70 bg-background/70 p-3">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
          {PERSONALIZATION_PROMPT}
        </p>
        <button
          type="button"
          onClick={copyPrompt}
          className="btn-pop mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        readOnly={readOnly}
        placeholder="Paste what your AI said about you here…"
        className="mt-3 w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40 read-only:opacity-70"
      />
      {note && <div className="mt-2 text-[12px] text-muted-foreground">{note}</div>}
      {!readOnly && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-pop inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold"
          >
            {saving ? "Saving…" : hasSaved ? "Update background" : "Save background"}
          </button>
        </div>
      )}
    </div>
  );
}
