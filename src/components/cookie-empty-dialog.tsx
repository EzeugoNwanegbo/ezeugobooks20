// The out-of-cookies dialog: raised by a 402 from chat/studybody/last-minute,
// a refused Battle Royale charge, or tapping an empty ring.
//
// UNLIKE share-with-gd-dialog.tsx, this one CLOSES. That dialog deliberately
// has no way out because it asks a question with two real answers and the
// student has to pick one; this one only REPORTS a fact - there is no
// decision to trap someone into making, and doing so here would just be
// hostile. So this is a plain Dialog/DialogContent (src/components/ui/dialog.tsx),
// which already gives Escape, an X, and click-outside-to-dismiss for free -
// the same three ways out every other closable dialog in the app has.
//
// TWO WAYS IN, ONE COMPONENT. Raised on a 402 (chat/studybody/last-minute, or
// a refused Battle Royale charge) - in which case the student really is at
// zero, and the owner's exact copy runs. Also raised by tapping the ring at
// ANY level, per the plan ("tapping it opens the same dialog as the empty
// state, showing what today has gone on") - there `remaining`/`allowance` are
// already known and not necessarily zero, so the header instead states them
// plainly, matching the exact phrasing the ring's own aria-label uses
// ("32 of 50 cookies left today"). The contact line and buttons never change:
// asking for more is always on offer, not only once a student has hit zero.
//
// "No explaining text, just clean": every line below is a fact or a number,
// never a sentence explaining why the budget exists.

import { MessageCircle, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadResetLabel } from "@/lib/allowances";
import { OWNER_CALL_HREF, OWNER_PHONE_LOCAL, ownerWhatsAppHref } from "@/lib/support-contact";

export function CookieEmptyDialog({
  open,
  onOpenChange,
  remaining,
  allowance,
  handle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null when opened by a 402 whose body did not carry a number - treated as "out", the safe default for a refusal. */
  remaining: number | null;
  allowance: number | null;
  /** The student's own handle/name, for the WhatsApp prefill - see ownerWhatsAppHref(). */
  handle: string | null | undefined;
}) {
  const isOut = remaining == null || remaining <= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isOut
              ? "You're out of cookies for today"
              : `${remaining} of ${allowance} cookies left today`}
          </DialogTitle>
          <DialogDescription>
            {isOut
              ? `They refill at ${uploadResetLabel()}. Need more now? Message or call G&D.`
              : "Need more? Message or call G&D."}
          </DialogDescription>
        </DialogHeader>
        {/* The one line of explanation this dialog earns. Without it the number
            above looks like a fixed ration, and a student who sees 30 has no way
            to know it grows - which is the whole point of the ladder.
            The numbers are a deliberate second copy of
            supabase/migrations/20260824150000_cookie_ladder.sql, for the same
            reason the Edge Functions repeat their own prices: this is a
            sentence, not arithmetic, and nothing is computed from it. If the
            migration changes, change this line with it. */}
        <p className="-mt-1 text-xs text-muted-foreground">
          Your daily cookies grow as you use G&amp;D: +5 every 3 days, up to 60.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={ownerWhatsAppHref(handle)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-pop px-4 py-2.5 text-sm font-medium text-pop-foreground transition-opacity hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
          <a
            href={OWNER_CALL_HREF}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-elevated"
          >
            <Phone className="h-4 w-4" />
            Call {OWNER_PHONE_LOCAL}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
