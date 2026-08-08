// "Challenge a friend" — the dialog, and the only place a challenge is created.
//
// It has two ways in, because the two callers arrive holding different things:
//
//   1. WITH a sessionId (the My Coach entry point). The student has just built a
//      question set and wants to send it. Nothing is generated; the dialog only
//      asks who.
//   2. WITHOUT one (the Friends page). The student picked a friend first, so the
//      dialog asks what to build the set from and generates it.
//
// Both paths end at the same two calls: createStraightInSession(questionType:
// "mcq") then createChallenge(). Keeping them in one component is what stops the
// two entry points drifting into two slightly different challenges.
//
// MCQ ONLY, and not as a simplification. An MCQ carries a stored key the server
// can grade against on its own, so both players' scores are settled by something
// neither of them controls. An essay's correctness exists only as a judgement
// the AI made and the *client* wrote into study_answers — scoring a contest on
// that is scoring it on a claim.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Swords } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { createStraightInSession, type DocRow } from "@/lib/studybody-data";
import {
  DEFAULT_CHALLENGE_QUESTIONS,
  MAX_CHALLENGE_QUESTIONS,
  createChallenge,
  socialEnabled,
  type Friend,
} from "@/lib/social";

type DocPick = { id: string; file_name: string };

export type ChallengeFriendDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accepted friends to choose from. Empty is a valid, handled state. */
  friends: Friend[];
  /** Skips the "who" step when the caller already knows the target. */
  presetFriend?: Friend | null;
  /**
   * An existing, unplayed, MCQ-only session to send as-is. Provide this from My
   * Coach right after a set is built; leave it out and the dialog builds one.
   */
  sessionId?: string;
  /** What the set is about. Only used for the label on a generated set. */
  defaultTitle?: string;
  onCreated?: (challengeId: string) => void;
};

const COUNT_OPTIONS = [5, 8, MAX_CHALLENGE_QUESTIONS];

export function ChallengeFriendDialog({
  open,
  onOpenChange,
  friends,
  presetFriend = null,
  sessionId,
  defaultTitle,
  onCreated,
}: ChallengeFriendDialogProps) {
  const { user, profile } = useAuth();
  const [targetId, setTargetId] = useState<string>("");
  const [docs, setDocs] = useState<DocPick[]>([]);
  const [docFilter, setDocFilter] = useState("");
  const [pickedDocs, setPickedDocs] = useState<string[]>([]);
  const [count, setCount] = useState(DEFAULT_CHALLENGE_QUESTIONS);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");

  const buildsSet = !sessionId;
  const enabled = socialEnabled(user);

  useEffect(() => {
    if (!open) return;
    setTargetId(presetFriend?.user_id ?? friends[0]?.user_id ?? "");
    setStage("");
  }, [open, presetFriend, friends]);

  // Only loads when the dialog is open AND it actually has a set to build, so
  // the My Coach entry point never pays for a query it will not use.
  useEffect(() => {
    if (!open || !buildsSet || !user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("documents")
        .select("id, file_name, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(60);
      if (!active) return;
      setDocs(
        ((data as DocPick[] | null) ?? []).map((d) => ({ id: d.id, file_name: d.file_name })),
      );
    })();
    return () => {
      active = false;
    };
  }, [open, buildsSet, user]);

  const target = useMemo(
    () => friends.find((f) => f.user_id === targetId) ?? null,
    [friends, targetId],
  );

  const visibleDocs = useMemo(() => {
    const needle = docFilter.trim().toLowerCase();
    if (!needle) return docs;
    return docs.filter((d) => d.file_name.toLowerCase().includes(needle));
  }, [docs, docFilter]);

  const toggleDoc = (id: string) => {
    setPickedDocs((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const canSend =
    enabled &&
    !busy &&
    Boolean(target?.username) &&
    (buildsSet ? pickedDocs.length > 0 && Boolean(profile) : true);

  const send = async () => {
    if (!target?.username || !user) return;
    setBusy(true);
    try {
      let setId = sessionId;
      if (!setId) {
        if (!profile) throw new Error("Your profile is still loading — try again in a moment.");
        setStage("Reading your material…");
        const picked = docs.filter((d) => pickedDocs.includes(d.id));
        const title = (defaultTitle || picked[0]?.file_name || "Challenge").slice(0, 60);
        const created = await createStraightInSession({
          userId: user.id,
          profile,
          title,
          documentIds: pickedDocs,
          // loadStudyDocumentsSpanning only reads file_name and folder off these;
          // the text comes from the stored chunks, so there is no reason to pull
          // every document's extracted_text down to the browser to build a quiz.
          docsMeta: picked.map<DocRow>((d) => ({
            id: d.id,
            file_name: d.file_name,
            extracted_text: null,
            folder_id: null,
            folders: null,
          })),
          count,
          // The whole reason challenges can be scored by the server. See the
          // header comment.
          questionType: "mcq",
          difficulty: "medium",
          onStage: (s) =>
            setStage(
              s === "reading"
                ? "Reading your material…"
                : s === "writing"
                  ? "Writing the questions…"
                  : "Saving the set…",
            ),
        });
        setId = created.sessionId;
      }
      setStage("Sending the challenge…");
      const challengeId = await createChallenge(target.username, setId);
      toast.success(`Challenge sent to @${target.username}.`);
      onCreated?.(challengeId);
      onOpenChange(false);
      setPickedDocs([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send that challenge.");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-pop" />
            Challenge a friend
          </DialogTitle>
          <DialogDescription>
            You both answer the same multiple-choice set, whenever suits you. Highest score wins; if
            you tie, the faster finish takes it.
          </DialogDescription>
        </DialogHeader>

        {friends.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Add a friend first — search for their handle on the Friends page.
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Who
              </div>
              <div className="flex flex-wrap gap-2">
                {friends.map((friend) => {
                  const picked = friend.user_id === targetId;
                  return (
                    <button
                      key={friend.user_id}
                      type="button"
                      disabled={!friend.username}
                      onClick={() => setTargetId(friend.user_id)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                        picked
                          ? "border-pop bg-pop/12 text-pop"
                          : "border-border text-muted-foreground hover:bg-foreground/[0.04]"
                      }`}
                    >
                      {friend.username ? `@${friend.username}` : friend.display_name}
                    </button>
                  );
                })}
              </div>
            </div>

            {buildsSet && (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      From which material
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {pickedDocs.length} selected
                    </span>
                  </div>
                  <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={docFilter}
                      onChange={(e) => setDocFilter(e.target.value)}
                      placeholder="Filter your files"
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
                    {visibleDocs.length === 0 ? (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {docs.length === 0
                          ? "Upload something to your library first."
                          : "Nothing matches that."}
                      </p>
                    ) : (
                      visibleDocs.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => toggleDoc(doc.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            pickedDocs.includes(doc.id)
                              ? "bg-pop/12 text-pop"
                              : "hover:bg-foreground/[0.04]"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-3.5 w-3.5 shrink-0 rounded border ${
                              pickedDocs.includes(doc.id)
                                ? "border-pop bg-pop"
                                : "border-muted-foreground/50"
                            }`}
                          />
                          <span className="min-w-0 truncate">{doc.file_name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    How many questions
                  </div>
                  <div className="flex gap-2">
                    {COUNT_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setCount(option)}
                        className={`flex-1 rounded-xl border px-3 py-2 text-sm tabular-nums transition-colors ${
                          count === option
                            ? "border-pop bg-pop/12 text-pop"
                            : "border-border text-muted-foreground hover:bg-foreground/[0.04]"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={!canSend}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {stage || "Working…"}
              </>
            ) : (
              "Send challenge"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
