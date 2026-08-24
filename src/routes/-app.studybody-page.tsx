import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BrainCircuit, ChevronRight, FileText, Play, Route, Zap } from "lucide-react";
import { StageProgress, type ProgressStage } from "@/components/stage-progress";
import { ChallengeFriendButton } from "@/components/challenge-friend-button";
import { friendList, socialEnabled, MAX_CHALLENGE_QUESTIONS } from "@/lib/social";
import { TimerPicker } from "@/components/timer-picker";
import { chosenTimerSeconds, timerChoiceBlocker, useTimerChoice } from "@/lib/use-timer-choice";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { takeLastMinuteForCoach } from "@/lib/last-minute-handoff";
import { generateStudyPlan, type StudyRoadmapTopic } from "@/lib/studybody-client";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import {
  createStraightInSession,
  db,
  folderName,
  loadPreferredStraightInType,
  loadStudyDocuments,
  loadStudyDocumentsSpanning,
  MAX_GENERATED_QUESTIONS,
  STRAIGHT_IN_TYPES,
  type DocRow,
  type PlanRow,
  type StraightInStage,
  type StraightInType,
} from "@/lib/studybody-data";

const SCOPE_OPTIONS = ["whole", "topic"] as const;

// The two ways in. A roadmap is the structured route — plan the material, then
// work through it in order. Straight in skips the planning entirely and asks
// questions from across the whole file right now, for the student who opened
// the app with an exam tomorrow and does not want a curriculum first.
const ENTRY_OPTIONS = ["roadmap", "straight"] as const;
type EntryMode = (typeof ENTRY_OPTIONS)[number];

// The presets, plus a Custom box for anything in between or at the edges.
// MAX_GENERATED_QUESTIONS is imported rather than repeated: the practice screen,
// this screen and the Edge Function all have to agree on the ceiling, and three
// copies of 40 is three chances to disagree.
const STRAIGHT_IN_COUNTS = [10, 20, 30, MAX_GENERATED_QUESTIONS];

function clampStraightCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), MAX_GENERATED_QUESTIONS);
}

// The style of question, chosen on the same step as the count so going straight
// in stays one decision point. "flashcard" is not here on purpose — see the note
// on createStraightInSession's `questionType`.
const STRAIGHT_IN_TYPE_LABEL: Record<StraightInType, string> = {
  mcq: "MCQ",
  essay: "Written",
  mixed: "Mixed",
};

/** Lower-case-safe wording for sentences: "20 MCQ questions", "a written set". */
const STRAIGHT_IN_TYPE_NOUN: Record<StraightInType, string> = {
  mcq: "MCQ",
  essay: "written",
  mixed: "mixed",
};

// The two long waits, named for the work that is actually happening. Each label
// belongs to one awaited call, and the step only moves when that call returns.
const ROADMAP_STAGES: readonly ProgressStage[] = [
  { key: "reading", label: "Reading your material" },
  {
    key: "planning",
    label: "Planning your topics",
    note: "The long part. We read the whole file before ordering it into topics.",
  },
  { key: "saving", label: "Saving your roadmap" },
];

const STRAIGHT_IN_STAGES: readonly ProgressStage[] = [
  { key: "reading", label: "Reading across your files" },
  {
    key: "writing",
    label: "Writing your questions",
    note: "The long part. Larger sets take a little longer to build from your files.",
  },
  { key: "saving", label: "Saving your set" },
];

const STRAIGHT_IN_STAGE_INDEX: Record<StraightInStage, number> = {
  reading: 0,
  writing: 1,
  saving: 2,
};

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// How many file chips to show before the list folds. A student with three
// files should never see a "show all" control; a student with forty should
// never get a wall of chips they have to scroll past to reach the button.
const DOC_PREVIEW_COUNT = 8;

// How many roadmaps the Continue row shows before folding.
const PLAN_PREVIEW_COUNT = 4;

/**
 * One step of the build flow.
 *
 * The old page stacked five uppercase micro-labels ("How do you want to
 * study?", "What are you learning?", "How many, and what kind?", "Difficulty",
 * "Sources") down a single tall card, so every option looked equally urgent and
 * the Build button sat below all of them. Numbering the three real decisions
 * and indenting their controls under each one gives the card a shape you can
 * scan, without adding a sentence of explanation anywhere.
 */
function Step({
  n,
  label,
  hint,
  children,
}: {
  n: number;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pop/12 text-[11px] font-semibold tabular-nums text-pop">
          {n}
        </span>
        <span className="text-sm font-semibold tracking-[-0.01em]">{label}</span>
        {hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="sm:pl-7">{children}</div>
    </div>
  );
}

export function StudyBodyPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [planTitle, setPlanTitle] = useState("");
  const [courseOutline, setCourseOutline] = useState("");
  const [scope, setScope] = useState<"whole" | "topic">("whole");
  const [topicFocus, setTopicFocus] = useState("");
  // A free-text steer for the generator: "ask me about the mechanisms, not the
  // definitions", "stick to chapter 4", "exam-style only".
  //
  // Distinct from topicFocus above, and never shown at the same time as it.
  // topicFocus RESTRICTS a roadmap to one topic and is required when that scope
  // is picked; this only WEIGHTS what gets asked and is always optional. Showing
  // both at once would put two free-text boxes in one step and leave the student
  // to work out which one narrows the material.
  const [aiNote, setAiNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [entry, setEntry] = useState<EntryMode>("roadmap");
  const [straightCount, setStraightCount] = useState(20);
  // Whether the count is being typed rather than picked. Presentational only -
  // straightCount is the single source of truth either way, so the Start button
  // and the timer read the same number whichever control set it.
  const [straightCustom, setStraightCustom] = useState(false);
  // "mixed" is what this flow has always built, so it stays the fallback. It is
  // replaced below by the student's own last-used style when we know one.
  const [straightType, setStraightType] = useState<StraightInType>("mixed");
  const [straightDifficulty, setStraightDifficulty] = useState<"easy" | "medium" | "hard">(
    "medium",
  );
  // Which real step the build is on, and the failure that stopped it.
  const [stageIndex, setStageIndex] = useState(0);
  const [stageError, setStageError] = useState<string | null>(null);
  // A set that has just been built and is being OFFERED rather than opened, so
  // there is somewhere to put "challenge a friend" beside "start practising".
  // Only ever set when the set is challengeable - see canOfferChallenge below -
  // so for everyone else this flow still goes straight into the questions.
  const [builtSet, setBuiltSet] = useState<{
    planId: string;
    sessionId: string;
    title: string;
  } | null>(null);
  const [hasFriends, setHasFriends] = useState(false);
  // Purely presentational folds. Neither changes what gets built.
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [showOutline, setShowOutline] = useState(false);

  const timer = useTimerChoice(straightCount);
  // The clock rides on the sets that keep an elapsed time — the same rule the
  // practice screen uses. A written-answer set has no such clock, so offering a
  // timer there would show a countdown that could never pay out.
  const straightSupportsTimer = straightType !== "essay";

  // Does this student have anyone to challenge? ChallengeFriendButton answers
  // the same question for itself and renders nothing when the answer is no, so
  // this is not a gate on the button - it is a gate on the CARD the button sits
  // in. Without it, a student with no friends would be handed an extra "your set
  // is ready" click on the way to questions they asked for, in exchange for a
  // button that renders nothing. friendList() makes no network call at all while
  // the social flag is off, so this effect is inert rather than merely harmless.
  useEffect(() => {
    if (!socialEnabled(user)) {
      setHasFriends(false);
      return;
    }
    let active = true;
    void friendList()
      .then((rows) => {
        if (active) setHasFriends(rows.length > 0);
      })
      .catch(() => {
        // A friends list that will not load is not a reason to change Practice Questions.
        if (active) setHasFriends(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  // Every condition the server enforces on a challenge set, checked before the
  // offer is made rather than after it is refused (challenge_create raises on
  // each of these):
  //   * MCQ only - an essay has no key the server can compare against, so both
  //     scores could not be settled the same way;
  //   * at most 12 questions - MAX_CHALLENGE_QUESTIONS, mirrored from the server;
  //   * the caller's own, in progress and untouched, which a set that was built
  //     one line ago and not yet opened always is.
  const canOfferChallenge =
    straightType === "mcq" && straightCount <= MAX_CHALLENGE_QUESTIONS && hasFriends;

  // Default the style to whatever the student last finished a set in, rather
  // than to a number we picked. Silent when there is nothing to go on.
  useEffect(() => {
    if (!user) return;
    let active = true;
    loadPreferredStraightInType(user.id).then((preferred) => {
      if (active && preferred) setStraightType(preferred);
    });
    return () => {
      active = false;
    };
  }, [user]);

  const refreshDocsAndPlans = async () => {
    if (!user) return;
    const [{ data: docRows, error: docErr }, { data: planRows, error: planErr }] =
      await Promise.all([
        db
          .from("documents")
          .select("id, file_name, extracted_text, folder_id, folders(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        db
          .from("study_plans")
          .select(
            "id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at",
          )
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("updated_at", { ascending: false }),
      ]);

    if (docErr) toast.error(docErr.message);
    if (planErr) {
      if (planErr.code === "PGRST205" || planErr.message.includes("study_plans")) {
        setSchemaMissing(true);
      } else {
        toast.error(planErr.message);
      }
    } else {
      setSchemaMissing(false);
    }

    setDocs((docRows as DocRow[]) ?? []);
    setPlans((planRows as PlanRow[]) ?? []);
  };

  useEffect(() => {
    refreshDocsAndPlans();
    if (user) {
      const handoff = takeLastMinuteForCoach(user.id);
      if (handoff) {
        setPlanTitle(handoff.title || "Last Minute Master Note");
        setCourseOutline(`Last Minute Master Note\n\n${handoff.note}`);
        setSelectedDocIds(handoff.docIds ?? []);
        setScope("whole");
        toast.success("Last Minute note loaded into Practice Questions");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((current) =>
      current.includes(id) ? current.filter((docId) => docId !== id) : [...current, id],
    );
  };

  // Straight in: no roadmap, no plan-generation call, questions from across the
  // whole of the selected files. Everything it creates is an ordinary plan +
  // topic + session, so the practice screen it lands on is unchanged.
  const startStraightIn = async () => {
    if (!user || !profile) return;
    if (schemaMissing) {
      toast.error(
        "Practice Questions tables are missing in Supabase. Apply the StudyBody migration first.",
      );
      return;
    }
    if (!selectedDocIds.length) {
      toast.error("Pick at least one file to be questioned on.");
      return;
    }
    // The timer stays optional, but "on with nothing usable set" is not a choice
    // we should silently resolve into an untimed set.
    const timerProblem = straightSupportsTimer ? timerChoiceBlocker(timer) : null;
    if (timerProblem) {
      toast.error(timerProblem);
      return;
    }

    setStageIndex(0);
    setStageError(null);
    setBuiltSet(null);
    setLoading(true);
    try {
      const chosen = docs.filter((doc) => selectedDocIds.includes(doc.id));
      const title =
        planTitle.trim() ||
        (chosen.length === 1
          ? chosen[0].file_name
          : `${chosen.length} files - ${STRAIGHT_IN_TYPE_NOUN[straightType]} set`);
      const { planId, sessionId } = await createStraightInSession({
        userId: user.id,
        profile,
        title,
        documentIds: selectedDocIds,
        docsMeta: docs,
        count: straightCount,
        questionType: straightType,
        difficulty: straightDifficulty,
        // Narrows retrieval to the matching chunks AND reaches the generator as
        // an instruction - see the student_focus note in createStraightInSession.
        topicFocus: aiNote.trim() || undefined,
        timerSeconds: straightSupportsTimer ? chosenTimerSeconds(timer) : 0,
        onStage: (stage) => setStageIndex(STRAIGHT_IN_STAGE_INDEX[stage]),
      });
      setSelectedDocIds([]);
      setPlanTitle("");
      setAiNote("");
      if (canOfferChallenge) {
        // Hold here instead of opening the questions. This is the only moment
        // the set is guaranteed to satisfy everything challenge_create() checks:
        // it exists, it is the student's own, it is in progress, every question
        // is an MCQ, and nobody has answered anything - no study_answers rows
        // and no draftAnswers in feedback, because the practice screen has not
        // been opened yet. One click later, in Learning mode, the first answer
        // is graded and the set stops being a contest.
        setBuiltSet({ planId, sessionId, title });
        return;
      }
      navigate({ to: "/app/practice", search: { plan: planId, session: sessionId } });
    } catch (err) {
      // Both: the toast for the student who has scrolled away, and the stopped
      // progress line in place so the wait visibly ends instead of spinning on.
      const message = err instanceof Error ? err.message : "Could not build your set";
      setStageError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async () => {
    if (!user || !profile) return;
    if (schemaMissing) {
      toast.error(
        "Practice Questions tables are missing in Supabase. Apply the StudyBody migration first.",
      );
      return;
    }
    if (!selectedDocIds.length && !courseOutline.trim()) {
      toast.error("Pick files or paste a course outline first.");
      return;
    }
    const focus = topicFocus.trim();
    const topicScoped = scope === "topic" && Boolean(focus);
    if (scope === "topic" && !focus) {
      toast.error("Type the topic you want to focus on, or switch to the whole PDF.");
      return;
    }

    setStageIndex(0);
    setStageError(null);
    setBuiltSet(null);
    setLoading(true);
    try {
      // Step 1 of the progress line: retrieval. For a single-topic roadmap we
      // pull only the chunks that match the topic (same pinpoint extraction the
      // chat uses), so the plan and every later question stays grounded on just
      // that part of the file - with page refs.
      const studyDocs = topicScoped
        ? await loadStudyDocuments(selectedDocIds, focus)
        : await loadStudyDocumentsSpanning(selectedDocIds, docs);
      // Two different jobs, so two different instructions. A topic-scoped
      // roadmap EXCLUDES everything else; a note only tilts the emphasis and
      // must not quietly throw material away.
      const note = aiNote.trim();
      const scopedOutline = topicScoped
        ? `Focus the roadmap ONLY on this topic from the uploaded material: "${focus}". Ignore unrelated chapters.${
            courseOutline.trim() ? `\n\n${courseOutline}` : ""
          }`
        : note
          ? `The student asked for this specifically: "${note}". Weight the roadmap towards it, but still cover the material.${
              courseOutline.trim() ? `\n\n${courseOutline}` : ""
            }`
          : courseOutline;
      // Step 2: the model call, and the reason this screen felt like dead air.
      setStageIndex(1);
      const generated = await generateStudyPlan({
        profile,
        planTitle: planTitle.trim() || focus || "New roadmap",
        courseOutline: scopedOutline,
        documents: studyDocs,
      });

      // Step 3: writing the plan and its topics down.
      setStageIndex(2);
      const { data: planData, error: planErr } = await db
        .from("study_plans")
        .insert({
          user_id: user.id,
          title: generated.title,
          course_outline: generated.course_outline,
          source_type: generated.source_type,
          source_document_ids: selectedDocIds,
          preference_snapshot: {
            exam_format: profile.exam_format,
            preferred_mode: profile.preferred_mode,
            weak_areas: profile.weak_areas ?? [],
          },
        })
        .select(
          "id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at",
        )
        .single();
      if (planErr) throw planErr;
      const plan = planData as PlanRow;

      const topicRows = generated.topics.map((topic: StudyRoadmapTopic, index: number) => ({
        user_id: user.id,
        plan_id: plan.id,
        title: topic.title,
        summary: topic.summary ?? "",
        objectives: topic.objectives ?? [],
        source_refs: topic.source_refs ?? [],
        position: index,
        status: index === 0 ? "learning" : "not_started",
      }));

      if (topicRows.length) {
        const { error: topicErr } = await db.from("study_topics").insert(topicRows);
        if (topicErr) throw topicErr;
      }

      setPlans((current) => [plan, ...current]);
      setPlanTitle("");
      setCourseOutline("");
      setSelectedDocIds([]);
      setTopicFocus("");
      setAiNote("");
      setScope("whole");
      toast.success("Roadmap created");
      navigate({ to: "/app/practice", search: { plan: plan.id } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create roadmap";
      setStageError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const visibleDocs = showAllDocs ? docs : docs.slice(0, DOC_PREVIEW_COUNT);
  const visiblePlans = showAllPlans ? plans : plans.slice(0, PLAN_PREVIEW_COUNT);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-x-hidden">
        <PageHeader eyebrow="PQ" title="Practice Questions" />

        {schemaMissing && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <div className="font-semibold text-destructive">
              Practice Questions database tables are missing
            </div>
            <p className="mt-1 text-muted-foreground">
              Apply the migration{" "}
              <span className="font-mono">
                supabase/migrations/20260508000100_add_studybody.sql
              </span>{" "}
              in Supabase, then refresh this page. Roadmap generation is paused so AI credits are
              not wasted before the tables exist.
            </p>
          </div>
        )}

        {/* Continue, first and above the builder.
            A student who already has a roadmap almost always came back to carry
            on with it, not to build another one - but the roadmap list used to
            be a sidebar column beside the build form, which put the thing they
            wanted second on a phone. */}
        {plans.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold tracking-[-0.01em]">Continue</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {visiblePlans.map((plan) => (
                <Link
                  key={plan.id}
                  to="/app/practice"
                  search={{ plan: plan.id }}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors hover:border-pop/40 hover:bg-pop/5"
                >
                  <Play className="h-4 w-4 shrink-0 text-pop" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">{plan.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {plan.source_type}
                      {plan.created_at ? ` \u00b7 ${formatDate(plan.created_at)}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
            {plans.length > PLAN_PREVIEW_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllPlans((value) => !value)}
                className="text-xs font-medium text-pop"
              >
                {showAllPlans ? "Show fewer" : `Show all ${plans.length}`}
              </button>
            )}
          </section>
        )}

        {/* The builder: material, then how, then the settings for that choice.
            Material comes first because both routes need it and nothing below
            can be decided without it - it used to sit at the very bottom, under
            every option, inside its own scrolling box. */}
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="space-y-6">
            <Step
              n={1}
              label="Material"
              hint={selectedDocIds.length ? `${selectedDocIds.length} selected` : undefined}
            >
              {docs.length === 0 ? (
                <Link
                  to="/app/library"
                  className="block rounded-xl border border-dashed border-border p-3 text-sm text-pop"
                >
                  Upload files in Library
                </Link>
              ) : (
                <>
                  {/* Chips that wrap, not a list that scrolls. A scrolling box
                      inside a scrolling page is the worst thing to operate on a
                      phone, and this one held the choice everything else needs. */}
                  <div className="flex flex-wrap gap-1.5">
                    {visibleDocs.map((doc) => {
                      const selected = selectedDocIds.includes(doc.id);
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => toggleDoc(doc.id)}
                          title={folderName(doc) || "Uncategorised"}
                          className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                            selected
                              ? "border-pop/50 bg-pop/10 text-pop"
                              : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="max-w-[14rem] truncate">{doc.file_name}</span>
                        </button>
                      );
                    })}
                  </div>
                  {docs.length > DOC_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowAllDocs((value) => !value)}
                      className="mt-2 text-xs font-medium text-pop"
                    >
                      {showAllDocs ? "Show fewer" : `Show all ${docs.length}`}
                    </button>
                  )}
                </>
              )}
            </Step>

            <Step n={2} label="How">
              <div className="grid grid-cols-2 gap-2">
                {ENTRY_OPTIONS.map((option) => {
                  const selected = entry === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setEntry(option);
                        setStageError(null);
                        setBuiltSet(null);
                      }}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                        selected
                          ? "border-pop/50 bg-pop/10"
                          : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                      }`}
                    >
                      {option === "roadmap" ? (
                        <Route
                          className={`h-4 w-4 ${selected ? "text-pop" : "text-muted-foreground"}`}
                        />
                      ) : (
                        <Zap
                          className={`h-4 w-4 ${selected ? "text-pop" : "text-muted-foreground"}`}
                        />
                      )}
                      <span className="text-sm font-semibold">
                        {option === "roadmap" ? "Roadmap" : "Straight in"}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {option === "roadmap"
                          ? "Ordered topics, one at a time"
                          : "Questions right now, no plan"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Step>

            <Step n={3} label={entry === "roadmap" ? "Your roadmap" : "Your questions"}>
              {entry === "roadmap" ? (
                <div className="space-y-3">
                  <input
                    value={planTitle}
                    onChange={(event) => setPlanTitle(event.target.value)}
                    placeholder="Course or topic name"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                  />

                  <Segmented
                    options={SCOPE_OPTIONS}
                    value={scope}
                    onChange={setScope}
                    getLabel={(option) => (option === "whole" ? "Whole file" : "One topic")}
                    className="h-10"
                  />
                  {scope === "topic" ? (
                    <input
                      value={topicFocus}
                      onChange={(event) => setTopicFocus(event.target.value)}
                      placeholder="Which topic? e.g. the nephron"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                    />
                  ) : (
                    <input
                      value={aiNote}
                      onChange={(event) => setAiNote(event.target.value)}
                      placeholder="Anything G&D should focus on? (optional)"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                    />
                  )}

                  {/* The outline box is a large empty textarea that most
                      students leave empty, so it no longer occupies the form by
                      default - it is one line until it is wanted. */}
                  {showOutline ? (
                    <textarea
                      value={courseOutline}
                      onChange={(event) => setCourseOutline(event.target.value)}
                      placeholder="Paste your course outline"
                      autoFocus
                      className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowOutline(true)}
                      className="text-xs font-medium text-pop"
                    >
                      {courseOutline.trim() ? "Edit course outline" : "Add a course outline"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Four presets on one row, and Custom on a line of its own
                      underneath rather than as a fifth cell: at 360px a
                      five-column row leaves about sixty pixels per button,
                      which fits "40" and not "Custom". */}
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                    {STRAIGHT_IN_COUNTS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setStraightCustom(false);
                          setStraightCount(option);
                        }}
                        className={`rounded-xl border px-2 py-2 text-sm font-medium tabular-nums transition-colors ${
                          !straightCustom && straightCount === option
                            ? "border-pop/50 bg-pop/10 text-pop"
                            : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>

                  {straightCustom ? (
                    <input
                      type="number"
                      min={1}
                      max={MAX_GENERATED_QUESTIONS}
                      value={straightCount}
                      autoFocus
                      onChange={(event) =>
                        setStraightCount(
                          clampStraightCount(Number.parseInt(event.target.value, 10)),
                        )
                      }
                      placeholder={`How many? (1-${MAX_GENERATED_QUESTIONS})`}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStraightCustom(true)}
                      className="text-xs font-medium text-pop"
                    >
                      Custom amount
                    </button>
                  )}

                  {/* Style and difficulty side by side: two short rows read as
                      one settings block rather than two more stacked sections. */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Segmented
                      options={STRAIGHT_IN_TYPES}
                      value={straightType}
                      onChange={setStraightType}
                      getLabel={(option) => STRAIGHT_IN_TYPE_LABEL[option]}
                      className="h-10"
                    />
                    <Segmented
                      options={["easy", "medium", "hard"] as const}
                      value={straightDifficulty}
                      onChange={setStraightDifficulty}
                      getLabel={(value) =>
                        value === "easy" ? "Easy" : value === "medium" ? "Medium" : "Hard"
                      }
                      className="h-10"
                    />
                  </div>

                  {straightSupportsTimer && <TimerPicker choice={timer} />}

                  <input
                    value={aiNote}
                    onChange={(event) => setAiNote(event.target.value)}
                    placeholder="Anything G&D should focus on? (optional)"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                  />
                </div>
              )}
            </Step>
          </div>

          <button
            onClick={entry === "roadmap" ? createPlan : startStraightIn}
            disabled={loading}
            className="btn-pop mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed"
          >
            {/* No dots while the staged line is up: it is the one progress
                indicator, and a spinner beside it would be a second, vaguer one
                saying the same thing. The button just goes quiet. */}
            {entry === "roadmap" ? (
              <BrainCircuit className="h-4 w-4" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            {loading
              ? entry === "roadmap"
                ? "Building roadmap"
                : "Building your set"
              : entry === "roadmap"
                ? "Build roadmap"
                : `Start ${straightCount} ${STRAIGHT_IN_TYPE_NOUN[straightType]} questions`}
          </button>
          {(loading || stageError) && (
            <StageProgress
              className="mt-2"
              stages={entry === "roadmap" ? ROADMAP_STAGES : STRAIGHT_IN_STAGES}
              currentIndex={stageIndex}
              error={loading ? null : stageError}
            />
          )}

          {/* The freshly-built set, offered rather than opened. Only reached
              when canOfferChallenge was true, so "Challenge a friend" always has
              something to render beside "Start practising" here. */}
          {builtSet && (
            <div className="mt-3 rounded-xl border border-pop/40 bg-pop/[0.07] p-3.5">
              <div className="text-sm font-semibold">Your set is ready</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    navigate({
                      to: "/app/practice",
                      search: { plan: builtSet.planId, session: builtSet.sessionId },
                    })
                  }
                  className="btn-pop inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
                >
                  <Play className="h-4 w-4" />
                  Start practising
                </button>
                <ChallengeFriendButton sessionId={builtSet.sessionId} title={builtSet.title} />
              </div>
              {/* The one line that survives: a student who answers first and
                  then tries to send loses the ability to, and nothing else on
                  screen would tell them why. */}
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Send it before you answer anything - once you have seen an answer it is no longer a
                fair contest.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
