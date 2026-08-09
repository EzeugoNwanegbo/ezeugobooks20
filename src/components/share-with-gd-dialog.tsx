// The share-with-G&D prompt, raised once per upload batch.
//
// ── WHY THIS DIALOG HAS NO WAY OUT EXCEPT THE TWO BUTTONS ───────────────────
// The owner's spec: "the share for everyone should be like a pop up with the
// button there, no x in the pop up - what removes it is by choosing share with
// us or keep for me."
//
// So: no X, no click-outside-to-close, and Escape does not dismiss it either.
// A question with a real answer either way is not a nuisance to be swatted, and
// an X would make "not now" the cheapest answer to a question that is cheapest
// to answer honestly. Both answers are one click, the same size, side by side.
//
// THAT IS ONLY DEFENSIBLE IF THE DIALOG IS ALSO IMPOSSIBLE TO GET STUCK IN, so:
//
//   * "Keep for me" writes NOTHING. It cannot fail, it needs no network, and it
//     is always available - including immediately after a failed share. That is
//     the property that makes removing the X safe rather than hostile.
//   * A failed share is shown in full, and the student may retry or keep. The
//     dialog never becomes an unclosable box over a broken save.
//   * Focus is trapped, so a keyboard user cannot tab out into a page they
//     cannot see or reach; and both buttons are always reachable, which is the
//     other half of trapping focus honestly.
//   * Escape does not close, but it does not silently do nothing either - a
//     swallowed key is how a keyboard user concludes the app is broken. It
//     moves focus to "Keep for me" and says so. The quiet exit is then one
//     Enter away, which is as close to Escape's usual meaning as this dialog
//     can honestly get.
//
// NOT A DARK PATTERN. "Share with G&D" is emphasised because it is the
// recommended action, and that is the whole of its advantage: the two buttons
// are the same height, the same width, adjacent, and both enabled from the
// first frame. No delay, no countdown, no pre-checked box, no "are you sure?"
// on the quiet one, and the quiet one is the one Escape reaches.
import { useEffect, useRef, useState } from "react";
import { HeartHandshake, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { DAILY_POINT_CAPS, EVENT_POINTS } from "@/lib/gamification";

export type SharePromptFile = { id: string; fileName: string };

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ShareWithGdDialog({
  files,
  onKeep,
  onShare,
}: {
  /** The files this one prompt covers. Never empty when rendered. */
  files: SharePromptFile[];
  /** Dismiss, keeping everything private. Writes nothing, so it cannot fail. */
  onKeep: () => void;
  /**
   * Contribute every file above to the pool. Resolves to an error message if
   * some file could not be shared, or null when all of them were. The caller
   * closes the dialog on success and narrows `files` to the failures on
   * failure, so a retry retries only what actually failed.
   */
  onShare: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<"share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [escapeHint, setEscapeHint] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const count = files.length;

  // Open on the recommended action. The other button is one Tab (or one
  // Escape) away, and neither is disabled, so this is a starting point rather
  // than a default that costs anything to change.
  useEffect(() => {
    shareRef.current?.focus();
  }, []);

  // The page behind is unreachable and must not scroll under the dialog -
  // particularly on the Capacitor build, where a scrolling body behind a fixed
  // overlay reads as the app having lost its place.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Focus trap + Escape. Captured on the document so nothing downstream (a
  // stray global handler, a toast, the router) sees the key first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const node = panelRef.current;
      if (!node) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setEscapeHint(true);
        keepRef.current?.focus();
        return;
      }

      if (event.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !node.contains(active);

      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const share = async () => {
    if (busy) return;
    setBusy("share");
    setError(null);
    try {
      const message = await onShare();
      // On success the caller unmounts this dialog; there is nothing to do here.
      if (message) setError(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const perFile = EVENT_POINTS.document_shared;
  const dailyCap = DAILY_POINT_CAPS.document_shared;

  return (
    // The scrim has no onClick: clicking outside is not an answer to the
    // question, so it does nothing.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/95 backdrop-blur-sm"
      // Nothing here is a text field, so the mobile keyboard never opens over
      // it. Centring is therefore safe on a 360px screen; the panel itself
      // scrolls if the viewport is shorter than the copy.
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-gd-title"
        aria-describedby="share-gd-body"
        className="luxury-panel max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-5 shadow-lg sm:p-6"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pop/10 text-pop">
            <HeartHandshake className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 id="share-gd-title" className="font-display text-xl font-light leading-tight">
              Share this with G&amp;D?
            </h2>
            {/* How many files this one answer covers. Saying "1 file" rather
                than the name keeps the sentence identical in both cases; the
                names are listed below when there is more than one. */}
            <p className="text-xs text-muted-foreground">
              {count === 1 ? files[0].fileName : `Your answer covers all ${count} files`}
            </p>
          </div>
        </div>

        <div id="share-gd-body" className="mt-4 space-y-3 text-sm text-muted-foreground">
          <p>
            <span className="text-foreground">
              This document is in our safe hands then — a delete won&apos;t affect us.
            </span>{" "}
            We keep one copy for G&amp;D so the next student who uploads the same book
            doesn&apos;t have to store it all over again.
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
              <span>
                You keep the file, and everything you can do with it now stays exactly the
                same.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
              <span>
                Nobody can browse it. Only students who already have the same book can ever
                read the shared copy.
              </span>
            </li>
          </ul>
        </div>

        {count > 1 && (
          <ul className="mt-3 max-h-24 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/40 p-2 text-xs text-muted-foreground">
            {files.map((file) => (
              <li key={file.id} className="truncate">
                {file.fileName}
              </li>
            ))}
          </ul>
        )}

        {/* A failed share is stated in full and changes nothing else: both
            buttons stay enabled, so the student may retry or simply keep. */}
        {error && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-foreground"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span>
              {error}
              <span className="block text-muted-foreground">
                Nothing was lost — your {count === 1 ? "file is" : "files are"} saved either
                way. Try again, or keep {count === 1 ? "it" : "them"} for yourself.
              </span>
            </span>
          </div>
        )}

        {/* Equal weight, equal size, side by side. On a narrow screen they
            stack and "Share" sits nearest the thumb; the emphasis is colour,
            never reach. */}
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* NEVER DISABLED, not even mid-share. A request with no timeout can
              hang, and a dialog with no X whose only remaining button is greyed
              out is precisely the trap this design has to avoid. Pressing it
              during a share closes the dialog; the request may still land, and
              that is fine - sharing is idempotent and the student wanted to
              stop waiting, not to undo anything. */}
          <button
            ref={keepRef}
            type="button"
            onClick={onKeep}
            className="gd-press inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-elevated"
          >
            Keep for me
          </button>
          <button
            ref={shareRef}
            type="button"
            onClick={() => void share()}
            disabled={busy !== null}
            className="btn-pop inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "share" ? <LoadingDots /> : null}
            {busy === "share" ? "Sharing..." : error ? "Try again" : "Share with G&D"}
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          {escapeHint
            ? "Choose one of the two — “Keep for me” leaves everything as it is."
            : `Sharing earns you ${perFile} points a file${
                dailyCap ? `, up to ${dailyCap} a day` : ""
              }.`}
        </p>
      </div>
    </div>
  );
}
