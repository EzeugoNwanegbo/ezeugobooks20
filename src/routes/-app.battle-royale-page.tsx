// Battle Royale: the host-side setup screen for an async friend match.
//
// Replaces the old inline "New challenge" flow on the Friends page (pick one
// of your own unfinished MCQ sets and send it — see -app.friends-page.tsx's
// header comment). Here the host configures a FRESH match — which file, whole
// file or one topic, how many questions, how long to finish, whole-file vs
// roadmap format — and this screen builds it and sends it in one action. Same
// document-picking and scope idiom as My Coach's roadmap builder
// (-app.studybody-page.tsx), its own local UI otherwise.
//
// EXAM MODE ONLY, MCQ ONLY, ALWAYS. Two reasons converge on the same answer:
// the brief (a match that reveals each answer as it is picked is not a
// contest), and the schema (challenge_create() rejects the whole set if even
// one question is not MCQ — see supabase/migrations/
// 20260809120000_social_usernames_friends_async_challenges.sql). Generating
// anything else would either be pointless (challenge_create forces the
// session's feedback.mode to 'exam' the moment it is sent, regardless of what
// it was built with) or would make the RPC refuse the set after the AI spend
// already happened.
//
// REUSES createStraightInSession (src/lib/studybody-data.ts) rather than
// building a second session builder — the mobile app had to write its own only
// because it has no port of that "straight in" flow to import; the website
// already has one. The only addition made to it for this screen is an
// optional topicFocus parameter for the "specific topic" scope.
//
// ROADMAP FORMAT IS VISIBLE BUT NOT BUILDABLE. A multi-stage "win per roadmap
// topic" match needs tables this schema does not have yet (no per-stage
// challenge row before 20260813120000_battle_royale.sql, no way to gate stage
// N+1 on stage N's result before the client work on top of it exists either).
// The option is shown, disabled, and its Send path is never reachable — see
// the format section below. No query, RPC call or column name for it appears
// anywhere in this file.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  FileText,
  Lock,
  Send,
  Swords,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StageProgress, type ProgressStage } from "@/components/stage-progress";
import { useAuth } from "@/lib/auth-context";
import {
  BATTLE_SCHEMA_APPLIED,
  MAX_CHALLENGE_QUESTIONS,
  createChallenge,
  friendList,
  socialEnabled,
  type Friend,
} from "@/lib/social";
import { createStraightInSession, db, folderName, type DocRow } from "@/lib/studybody-data";

type Scope = "whole" | "topic";
type Format = "single" | "roadmap";

// Offered per the brief. 10 fits inside the server's currently-live challenge
// cap (BATTLE_MAX_QUESTIONS below); 20 and 30 do not, so they are shown — the
// design is real — but disabled rather than wired to a call challenge_create()
// would refuse after the AI spend already happened.
const COUNT_PRESETS = [10, 20, 30] as const;

// Which of two numbers is live depends on BATTLE_SCHEMA_APPLIED:
//   flag off — challenges.question_count CHECK (BETWEEN 1 AND 12) plus
//              challenge_create()'s own "up to 12 questions" guard
//              (MAX_CHALLENGE_QUESTIONS, mirrored in src/lib/social.ts);
//   flag on  — both widened to 60 by 20260813120000_battle_royale.sql, which
//              is also where the studybody edge function clamps generation,
//              so 60 is the largest set that can actually be built.
const BATTLE_MAX_QUESTIONS_POOLED = 60;
const BATTLE_MAX_QUESTIONS = BATTLE_SCHEMA_APPLIED
  ? BATTLE_MAX_QUESTIONS_POOLED
  : MAX_CHALLENGE_QUESTIONS; // 12
// A 1- or 2-question "battle" is barely a contest, so 3 is the floor.
// Deliberately not tied to My Coach's own smallest preset (10): that number
// plus this cap while the flag is off would leave a 10-12 range and make the
// Custom field almost pointless.
const BATTLE_MIN_QUESTIONS = 3;

// There is no schema field that carries a time limit onto the OPPONENT's copy
// of the match while BATTLE_SCHEMA_APPLIED is false: challenge_begin() builds
// their session's feedback from scratch and carries nothing else over. So a
// per-match timer cannot be enforced today — not even one-sidedly for the
// host, since a limit only one player's client knew about would mean the two
// are not playing the same contest. What DOES reach both players is
// challenges.title, snapshotted once at challenge_create time — so the chosen
// limit rides in the title instead (see buildBattleTitle), a pace both are
// told rather than one anything stops them going over.
const BATTLE_MIN_MINUTES = 1;
const BATTLE_MAX_MINUTES = 180; // 3 hours — generous, but bounds a fat-fingered 5000

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function buildBattleTitle(doc: DocRow, scope: Scope, focus: string, minutes: number): string {
  const base = scope === "topic" && focus ? `${doc.file_name} — ${focus}` : doc.file_name;
  // challenge_create() truncates whatever it reads from here to 80 chars, so a
  // long file name + focus is never a hard failure — just a title that loses
  // its tail, an acceptable trade for not rejecting a real file name.
  return `${base} · ${minutes} min`;
}

const BUILD_STAGES: readonly ProgressStage[] = [
  { key: "reading", label: "Reading the file" },
  {
    key: "writing",
    label: "Writing the questions",
    note: "The long part. Larger sets take a little longer to build.",
  },
  { key: "saving", label: "Saving the match" },
];
const STAGE_INDEX: Record<string, number> = { reading: 0, writing: 1, saving: 2 };

export function BattleRoyalePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/battle-royale" }) as {
    friendId?: string;
    friendUsername?: string;
    friendName?: string;
  };

  // Arrived from Friends' "Battle" button with a target already chosen.
  const cameWithOpponent = Boolean(search.friendUsername);
  const enabled = socialEnabled(user);

  // ── Opponent ──────────────────────────────────────────────────────────────
  const [opponent, setOpponent] = useState<{
    userId: string;
    username: string;
    name: string;
  } | null>(
    search.friendUsername
      ? {
          userId: search.friendId ?? "",
          username: search.friendUsername,
          name: search.friendName ?? search.friendUsername,
        }
      : null,
  );
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || opponent) return;
    setFriendsLoading(true);
    void friendList()
      .then(setFriends)
      .catch(() => setFriends([]))
      .finally(() => setFriendsLoading(false));
  }, [enabled, opponent]);

  // A friend who never claimed a handle cannot be the target of createChallenge
  // (it sends by username, not id) — the same guard the old challenge dialog
  // applied before opening.
  const challengeableFriends = useMemo(() => friends.filter((f) => f.username), [friends]);

  // ── Setup state ───────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("whole");
  const [topicFocus, setTopicFocus] = useState("");
  const [format, setFormat] = useState<Format>("single");

  const [countPreset, setCountPreset] = useState<number | "custom">(10);
  const [customCount, setCustomCount] = useState(String(BATTLE_MAX_QUESTIONS));
  const [minutes, setMinutes] = useState("15");

  const [sending, setSending] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [stageError, setStageError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setDocsLoading(true);
    (async () => {
      const { data, error } = await db
        .from("documents")
        .select("id, file_name, extracted_text, folder_id, folders(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      setDocs((data as DocRow[]) ?? []);
    })().finally(() => {
      if (active) setDocsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user]);

  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;

  // The resolved question count this match will actually be built with — a
  // preset already inside the server cap, or whatever survives clamping the
  // custom field. A blank, zero, negative or absurd ("5000") custom entry all
  // resolve inside range rather than reaching session creation.
  const resolvedCount = useMemo(() => {
    if (countPreset !== "custom") return countPreset;
    const parsed = parseInt(customCount, 10);
    return clampInt(parsed, BATTLE_MIN_QUESTIONS, BATTLE_MAX_QUESTIONS);
  }, [countPreset, customCount]);

  const resolvedMinutes = useMemo(() => {
    const parsed = parseInt(minutes, 10);
    return clampInt(parsed, BATTLE_MIN_MINUTES, BATTLE_MAX_MINUTES);
  }, [minutes]);

  const explainRoadmapLocked = () => {
    toast.message("Roadmap battles are coming soon", {
      description:
        "A multi-stage battle with a win for each roadmap topic needs a database change that hasn't shipped yet. For now every Battle Royale match is a single, whole-file round.",
    });
  };

  const canSend =
    enabled &&
    Boolean(opponent) &&
    Boolean(selectedDoc) &&
    (scope === "whole" || topicFocus.trim().length > 0) &&
    format === "single" &&
    !sending;

  const send = async () => {
    if (!user || !profile || !opponent || !selectedDoc) return;
    if (scope === "topic" && !topicFocus.trim()) {
      toast.error("Type the topic this battle should focus on, or switch to the whole file.");
      return;
    }
    setSending(true);
    setStageIndex(0);
    setStageError(null);
    try {
      const focus = topicFocus.trim();
      const title = buildBattleTitle(selectedDoc, scope, focus, resolvedMinutes);
      const { sessionId } = await createStraightInSession({
        userId: user.id,
        profile,
        title,
        documentIds: [selectedDoc.id],
        docsMeta: [selectedDoc],
        count: resolvedCount,
        // The whole reason a battle can be scored by the server at all — see
        // the header comment.
        questionType: "mcq",
        difficulty: "medium",
        topicFocus: scope === "topic" ? focus : undefined,
        // No timerSeconds: an enforced countdown here would only ever run for
        // the host (challenge_begin() does not copy it to the opponent's
        // session), which would make the two sittings different contests. The
        // limit is communicated through the title instead — see the constant
        // comment above.
        onStage: (stage) => setStageIndex(STAGE_INDEX[stage] ?? 0),
      });
      // The limit only becomes a real constraint once the migration is applied:
      // before that there is no challenges.time_limit_minutes for it to live
      // in, and challenge_begin() would not carry it onto the opponent's copy
      // even if there were.
      await createChallenge(
        opponent.username,
        sessionId,
        BATTLE_SCHEMA_APPLIED ? resolvedMinutes : undefined,
      );
      toast.success(`Battle sent to @${opponent.username}.`);
      if (cameWithOpponent) navigate({ to: "/app/friends" });
      else setOpponent(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send that battle";
      setStageError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">{children}</div>
    </div>
  );

  if (!enabled) {
    return shell(
      <>
        <PageHeader eyebrow="Battle Royale" title="Study against someone, head to head" />
        <Panel>
          <p className="text-sm text-muted-foreground">
            Async friend matches aren&apos;t switched on for everyone yet. They&apos;ll appear here
            once they are.
          </p>
        </Panel>
      </>,
    );
  }

  return shell(
    <>
      {cameWithOpponent && (
        <Link
          to="/app/friends"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-pop transition-colors hover:text-pop/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Friends
        </Link>
      )}

      {!opponent ? (
        <>
          <PageHeader eyebrow="Battle Royale" title="Who are you battling?" />
          <Panel>
            <SectionTitle icon={<Users className="h-4 w-4" />} title="Pick a friend" />
            {friendsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading your friends…
              </p>
            ) : challengeableFriends.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No friends ready to battle yet. Add one from the{" "}
                <Link to="/app/friends" className="text-pop hover:text-pop/80">
                  Friends
                </Link>{" "}
                page.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {challengeableFriends.map((friend) => (
                  <button
                    key={friend.user_id}
                    type="button"
                    onClick={() =>
                      setOpponent({
                        userId: friend.user_id,
                        username: friend.username as string,
                        name: friend.display_name,
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-left transition-colors hover:border-pop/40 hover:bg-pop/5"
                  >
                    <Users className="h-4 w-4 shrink-0 text-pop" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
                        {friend.display_name}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        @{friend.username}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </>
      ) : (
        <>
          <PageHeader
            eyebrow="Setting up a match"
            title={`Battle @${opponent.username}`}
            subtitle="Exam mode only — nothing is revealed until you both finish. Configure it, then send."
          />

          {/* File */}
          <Panel>
            <SectionTitle icon={<FileText className="h-4 w-4" />} title="Which file" />
            {docsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading your files…</p>
            ) : docs.length === 0 ? (
              <Link
                to="/app/library"
                className="mt-3 block rounded-xl border border-dashed border-border p-4 text-sm text-pop"
              >
                Upload a file in Library first.
              </Link>
            ) : (
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                {docs.map((doc) => {
                  const selected = selectedDocId === doc.id;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? "border-pop/40 bg-pop/10"
                          : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <FileText
                        className={`h-4 w-4 shrink-0 ${selected ? "text-pop" : "text-muted-foreground"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
                          {doc.file_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {folderName(doc) || "Uncategorised"}
                        </span>
                      </span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-pop" />}
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Scope */}
          {selectedDoc && (
            <Panel>
              <SectionTitle icon={<FileText className="h-4 w-4" />} title="Scope" />
              <div className="mt-3 flex gap-2">
                <ScopePill
                  label="The whole file"
                  active={scope === "whole"}
                  onClick={() => setScope("whole")}
                />
                <ScopePill
                  label="A specific topic"
                  active={scope === "topic"}
                  onClick={() => setScope("topic")}
                />
              </div>
              {scope === "topic" && (
                <div className="mt-3 space-y-2">
                  <Input
                    value={topicFocus}
                    onChange={(event) => setTopicFocus(event.target.value)}
                    placeholder="e.g. Cranial nerves, Consideration in contract law…"
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    We&apos;ll pull only the pages about this topic, so every question stays
                    grounded on them.
                  </p>
                </div>
              )}
            </Panel>
          )}

          {/* Question count */}
          <Panel>
            <SectionTitle icon={<Swords className="h-4 w-4" />} title="Questions" />
            <div className="mt-3 flex flex-wrap gap-2">
              {COUNT_PRESETS.map((n) => {
                const overCap = n > BATTLE_MAX_QUESTIONS;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={overCap}
                    onClick={() => setCountPreset(n)}
                    className={`min-w-16 flex-1 rounded-xl border px-3 py-2 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      countPreset === n
                        ? "border-pop/50 bg-pop/10 text-pop"
                        : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCountPreset("custom")}
                className={`min-w-16 flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  countPreset === "custom"
                    ? "border-pop/50 bg-pop/10 text-pop"
                    : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
                }`}
              >
                Custom
              </button>
            </div>
            {countPreset === "custom" && (
              <Input
                value={customCount}
                onChange={(event) => setCustomCount(event.target.value)}
                inputMode="numeric"
                placeholder={`${BATTLE_MIN_QUESTIONS}-${BATTLE_MAX_QUESTIONS}`}
                className="mt-3"
              />
            )}
            {/* Two different truths, and the copy must not tell the wrong one:
                with the migration unapplied the cap really is 12 and the bigger
                presets really are unreachable; once it lands they simply work,
                and an apology for a limit that no longer exists reads as a bug. */}
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {BATTLE_SCHEMA_APPLIED
                ? `Battles run up to ${BATTLE_MAX_QUESTIONS} questions — the largest set the server will build for a fair, gradeable contest. This match will use ${resolvedCount}.`
                : `Battles are capped at ${BATTLE_MAX_QUESTIONS} questions for now — that is the server's own limit for a fair, gradeable contest. 20 and 30 will unlock once that cap is raised. This match will use ${resolvedCount}.`}
            </p>
          </Panel>

          {/* Time to finish */}
          <Panel>
            <SectionTitle icon={<Clock className="h-4 w-4" />} title="Time to finish" />
            <Input
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              inputMode="numeric"
              placeholder="Minutes"
              className="mt-3 max-w-40"
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {BATTLE_MIN_MINUTES}-{BATTLE_MAX_MINUTES} minutes. This match will give{" "}
              {resolvedMinutes} min — shown to your opponent, not force-submitted.
            </p>
          </Panel>

          {/* Format */}
          <Panel>
            <SectionTitle icon={<Swords className="h-4 w-4" />} title="Format" />
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setFormat("single")}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  format === "single"
                    ? "border-pop/40 bg-pop/10"
                    : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-[-0.01em]">
                    Whole-file overview
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    One round. Finish it, see the result.
                  </span>
                </span>
                {format === "single" && <Check className="h-4 w-4 shrink-0 text-pop" />}
              </button>
              <button
                type="button"
                onClick={explainRoadmapLocked}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-left opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-[-0.01em]">Roadmap</span>
                  <span className="block text-xs text-muted-foreground">
                    A win for each roadmap stage.
                  </span>
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Soon
                </span>
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          </Panel>

          <div className="space-y-2">
            <Button onClick={() => void send()} disabled={!canSend} className="w-full">
              <Send className="h-4 w-4" />
              {sending ? "Sending…" : `Send battle to @${opponent.username}`}
            </Button>
            <Button variant="secondary" onClick={() => setOpponent(null)} className="w-full">
              Choose someone else
            </Button>
            {(sending || stageError) && (
              <StageProgress
                stages={BUILD_STAGES}
                currentIndex={stageIndex}
                error={sending ? null : stageError}
              />
            )}
          </div>
        </>
      )}
    </>,
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">{children}</section>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
      <span className="text-pop">{icon}</span>
      {title}
    </h2>
  );
}

function ScopePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-pop/50 bg-pop/10 text-pop"
          : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
      }`}
    >
      {label}
    </button>
  );
}
