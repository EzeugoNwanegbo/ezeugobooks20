// "The shared textbook library is here" — a one-time dialog for students who
// were already using G&D when the built-in books landed.
//
// Deliberately not shown to brand-new users: they get the guided tour instead,
// and stacking a what's-new dialog on top of a first-run tour is just noise.
// The gating lives in the app shell (see -app-shell.tsx).

import { useEffect, useRef } from "react";
import { BookOpen, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { markAnnouncementSeen } from "@/lib/announcement";

export function LibraryAnnouncement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Mark it seen the moment it is shown, not when it is dismissed: if the tab
  // is closed mid-read it should still not reappear on the next visit.
  useEffect(() => {
    if (open) markAnnouncementSeen();
  }, [open]);

  // Escape closes, and focus lands on the dialog so a keyboard user is not
  // stranded behind it.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[195] bg-[rgba(3,7,12,0.68)]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gd-announcement-title"
        className="fixed left-1/2 top-1/2 z-[200] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/70 bg-background p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pop/10 text-pop">
            <BookOpen className="h-5 w-5" />
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2
          id="gd-announcement-title"
          className="mt-3 text-lg font-semibold tracking-[-0.01em] text-foreground"
        >
          Textbooks are built in now
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          A shelf of core medical textbooks now sits inside G&amp;D — anatomy, physiology,
          biochemistry, embryology, histology and genetics. You can ask about them straight away,
          with nothing to upload.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This first shelf is built for{" "}
          <span className="font-medium text-foreground">pre-clinical years</span>. Answers still
          cite the book and the page they came from, and your own uploads keep working exactly as
          before.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            Got it
          </button>
          <button
            onClick={() => {
              onClose();
              void navigate({ to: "/app/library" });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-pop px-3 py-1.5 text-[12px] font-semibold text-pop-foreground transition-opacity hover:opacity-90"
          >
            <BookOpen className="h-3.5 w-3.5" />
            See the books
          </button>
        </div>
      </div>
    </>
  );
}
