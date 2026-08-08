// "The shared textbook library is here" — a one-time note for students who
// were already using G&D when the built-in books landed.
//
// Deliberately not shown to brand-new users: they get the guided tour instead,
// and stacking a what's-new notice on top of a first-run tour is just noise.
// The gating lives in the app shell (see -app-shell.tsx).
//
// It used to be a centred dialog with a full-screen scrim, which on a phone
// meant a "by the way" note took over the entire display and had to be dealt
// with before anything else could be. Nothing here is urgent and nothing here
// needs an answer, so it is a corner card now: no scrim, no aria-modal, no
// focus trap, nothing behind it disabled. Announcement, not interruption.

import { useEffect } from "react";
import { BookOpen, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { markAnnouncementSeen } from "@/lib/announcement";

export function LibraryAnnouncement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();

  // Mark it seen the moment it is shown, not when it is dismissed: if the tab
  // is closed mid-read it should still not reappear on the next visit. The
  // shell's gate reads hasSeenAnnouncement() on every run, so once this has
  // fired the card cannot re-open on a later navigation or route change.
  useEffect(() => {
    if (open) markAnnouncementSeen();
  }, [open]);

  // Escape dismisses. Focus is deliberately NOT moved here - stealing it for a
  // non-critical notice interrupts whatever the student was typing, which is
  // the exact behaviour this card exists to stop.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby="gd-announcement-title"
      // Phones: pinned under the mobile top bar, clear of the composer and the
      // send button at the bottom of the screen. Wider screens: a bottom-right
      // toast. z-[120] keeps it under the tour overlay and any real dialog.
      // Fade only, no transform-based entrance: the card is centred on phones
      // with -translate-x-1/2, and a slide/zoom animation drives `transform`
      // too, which would knock it off-centre for the length of the animation.
      className="fixed left-1/2 top-[calc(3.5rem+env(safe-area-inset-top))] z-[120] w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-in rounded-2xl border border-border/70 bg-surface p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] duration-300 fade-in-0 motion-reduce:animate-none sm:bottom-4 sm:left-auto sm:right-4 sm:top-auto sm:translate-x-0"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pop/10 text-pop">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="gd-announcement-title"
            className="text-sm font-semibold tracking-[-0.01em] text-foreground"
          >
            Textbooks are built in now
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            A shelf of core medical textbooks sits inside G&amp;D — anatomy, physiology,
            biochemistry, embryology, histology and genetics. Ask about them straight away, nothing
            to upload. Answers still cite the book and page, and your own uploads work exactly as
            before.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                void navigate({ to: "/app/library" });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pop px-3 py-1.5 text-[12px] font-semibold text-pop-foreground transition-opacity hover:opacity-90"
            >
              <BookOpen className="h-3.5 w-3.5" />
              See the books
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Got it
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
