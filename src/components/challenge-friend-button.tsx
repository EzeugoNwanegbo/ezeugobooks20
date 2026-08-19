// ── THE MY COACH ENTRY POINT ────────────────────────────────────────────────
//
// This is the whole hook the "challenge a friend" entry inside PQ needs.
// Wiring it up is one import and one line, in src/routes/-app.studybody-page.tsx
// (deliberately not edited here — another change is in flight in that file):
//
//     import { ChallengeFriendButton } from "@/components/challenge-friend-button";
//
//     // ...wherever a freshly-built set is offered ("Start practising"), beside it:
//     <ChallengeFriendButton sessionId={sessionId} title={topicTitle} />
//
// That is the entire integration. Everything else — the flag, the guest check,
// loading the friends list, the picker, generating nothing (the set already
// exists), the RPC, the toasts — is handled here.
//
// WHAT sessionId MUST BE, because the server enforces all four and will refuse
// otherwise:
//   * a study_sessions row belonging to the signed-in student;
//   * status 'in_progress' — not yet played;
//   * every question_type = 'mcq' (build the set with
//     createStraightInSession({ questionType: "mcq" }));
//   * untouched: no study_answers rows and no `draftAnswers` in feedback.
// A set whose answers the challenger has already seen is not a contest, which is
// why those are refusals rather than warnings.
//
// It renders NOTHING when the social schema is not applied, when the user is a
// guest, or when they have no friends yet — so it is safe to place
// unconditionally, and PQ needs no flag check of its own.
import { useEffect, useState } from "react";
import { Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChallengeFriendDialog } from "@/components/challenge-friend-dialog";
import { useAuth } from "@/lib/auth-context";
import { friendList, socialEnabled, type Friend } from "@/lib/social";

export type ChallengeFriendButtonProps = {
  /** An unplayed, MCQ-only session belonging to the signed-in student. */
  sessionId: string;
  /** What the set is about. Shown in the dialog only; the server takes the
      challenge title from the session's topic either way. */
  title?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "secondary" | "outline" | "ghost";
};

export function ChallengeFriendButton({
  sessionId,
  title,
  className,
  size = "sm",
  variant = "secondary",
}: ChallengeFriendButtonProps) {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [open, setOpen] = useState(false);

  const enabled = socialEnabled(user);

  useEffect(() => {
    // friendList() returns [] without a network call while the flag is off, so
    // this effect is inert rather than merely harmless.
    if (!enabled) return;
    let active = true;
    void friendList()
      .then((rows) => {
        if (active) setFriends(rows);
      })
      .catch(() => {
        // A friends list that will not load is not a reason to break PQ.
        if (active) setFriends([]);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  if (!enabled || friends.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Swords className="mr-1.5 h-3.5 w-3.5" />
        Challenge a friend
      </Button>
      <ChallengeFriendDialog
        open={open}
        onOpenChange={setOpen}
        friends={friends}
        sessionId={sessionId}
        defaultTitle={title}
      />
    </>
  );
}
