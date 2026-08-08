import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BrainCircuit, ChevronRight, FileText, History, Route, Timer, Zap } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { takeLastMinuteForCoach } from "@/lib/last-minute-handoff";
import { generateStudyPlan, type StudyRoadmapTopic } from "@/lib/studybody-client";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { timerPresetSeconds } from "@/lib/timed-challenge";
import {
  createStraightInSession,
  db,
  folderName,
  loadStudyDocuments,
  loadStudyDocumentsSpanning,
  type DocRow,
  type PlanRow,
} from "@/lib/studybody-data";

const SCOPE_OPTIONS = ["whole", "topic"] as const;

// The two ways in. A roadmap is the structured route — plan the material, then
// work through it in order. Straight in skips the planning entirely and asks
// questions from across the whole file right now, for the student who opened
// the app with an exam tomorrow and does not want a curriculum first.
const ENTRY_OPTIONS = ["roadmap", "straight"] as const;
type EntryMode = (typeof ENTRY_OPTIONS)[number];

const STRAIGHT_IN_COUNTS = [10, 20, 30, 50];

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
  const [loading, setLoading] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [entry, setEntry] = useState<EntryMode>("roadmap");
  const [straightCount, setStraightCount] = useState(20);
  const [straightDifficulty, setStraightDifficulty] = useState<"easy" | "medium" | "hard">(
    "medium",
  );
  const [straightTimerOn, setStraightTimerOn] = useState(false);
  const [straightTimerSeconds, setStraightTimerSeconds] = useState(0);

  const straightTimerOptions = useMemo(() => timerPresetSeconds(straightCount), [straightCount]);
  useEffect(() => {
    setStraightTimerSeconds((current) =>
      straightTimerOptions.includes(current)
        ? current
        : (straightTimerOptions[1] ?? straightTimerOptions[0] ?? 0),
    );
  }, [straightTimerOptions]);

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
        toast.success("Last Minute note loaded into My Coach");
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
      toast.error("My Coach tables are missing in Supabase. Apply the StudyBody migration first.");
      return;
    }
    if (!selectedDocIds.length) {
      toast.error("Pick at least one file to be questioned on.");
      return;
    }

    setLoading(true);
    try {
      const chosen = docs.filter((doc) => selectedDocIds.includes(doc.id));
      const title =
        planTitle.trim() ||
        (chosen.length === 1 ? chosen[0].file_name : `${chosen.length} files - mixed set`);
      const { planId, sessionId } = await createStraightInSession({
        userId: user.id,
        profile,
        title,
        documentIds: selectedDocIds,
        docsMeta: docs,
        count: straightCount,
        difficulty: straightDifficulty,
        timerSeconds: straightTimerOn ? straightTimerSeconds : 0,
      });
      setSelectedDocIds([]);
      setPlanTitle("");
      navigate({ to: "/app/practice", search: { plan: planId, session: sessionId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build your set");
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async () => {
    if (!user || !profile) return;
    if (schemaMissing) {
      toast.error("My Coach tables are missing in Supabase. Apply the StudyBody migration first.");
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

    setLoading(true);
    try {
      // For a single-topic roadmap we pull only the chunks that match the topic
      // (same pinpoint extraction the chat uses), so the plan and every later
      // question stays grounded on just that part of the file - with page refs.
      const studyDocs = topicScoped
        ? await loadStudyDocuments(selectedDocIds, focus)
        : await loadStudyDocumentsSpanning(selectedDocIds, docs);
      const scopedOutline = topicScoped
        ? `Focus the roadmap ONLY on this topic from the uploaded material: "${focus}". Ignore unrelated chapters.${
            courseOutline.trim() ? `\n\n${courseOutline}` : ""
          }`
        : courseOutline;
      const generated = await generateStudyPlan({
        profile,
        planTitle: planTitle.trim() || focus || "My Coach roadmap",
        courseOutline: scopedOutline,
        documents: studyDocs,
      });

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
      setScope("whole");
      toast.success("Roadmap created");
      navigate({ to: "/app/practice", search: { plan: plan.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create roadmap");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 overflow-x-hidden">
        <PageHeader
          eyebrow="My Coach"
          title="Follow a roadmap, or go straight in."
          subtitle="Build a study roadmap from your files and work through it in order — or skip the plan and get a broad set of questions from across the whole file right now."
        />

        {schemaMissing && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <div className="font-semibold text-destructive">
              My Coach database tables are missing
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

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* New roadmap / straight in */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pop/12 text-pop">
                {entry === "roadmap" ? <Route className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
              </div>
              <h2 className="text-sm font-semibold tracking-[-0.01em]">
                {entry === "roadmap" ? "New roadmap" : "Straight in"}
              </h2>
            </div>

            {/* The entry choice. Roadmap is first and stays the default, so the
                existing flow is exactly where returning students left it. */}
            <div className="mb-4 space-y-2">
              <Segmented
                options={ENTRY_OPTIONS}
                value={entry}
                onChange={setEntry}
                getLabel={(option) =>
                  option === "roadmap" ? "Follow a roadmap" : "Go straight in"
                }
                getIcon={(option) =>
                  option === "roadmap" ? (
                    <Route className="h-3.5 w-3.5" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )
                }
                className="h-10"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {entry === "roadmap"
                  ? "We plan the material into ordered topics, then you practice them one at a time and build mastery."
                  : "No plan, no order. We pull from the start, middle and end of everything you pick and question you across the lot."}
              </p>
            </div>

            {entry === "roadmap" ? (
              <>
                <div className="space-y-3">
                  <input
                    value={planTitle}
                    onChange={(event) => setPlanTitle(event.target.value)}
                    placeholder="Course or topic name"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                  />
                  <textarea
                    value={courseOutline}
                    onChange={(event) => setCourseOutline(event.target.value)}
                    placeholder="Paste course outline, or leave blank and build from selected files"
                    className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                  />
                </div>

                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    What are you learning?
                  </div>
                  <Segmented
                    options={SCOPE_OPTIONS}
                    value={scope}
                    onChange={setScope}
                    getLabel={(option) =>
                      option === "whole" ? "The whole file" : "A specific topic"
                    }
                  />
                  {scope === "topic" && (
                    <div className="space-y-2 pt-1">
                      <input
                        value={topicFocus}
                        onChange={(event) => setTopicFocus(event.target.value)}
                        placeholder="Which topic in the file? e.g. “The nephron”"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        We’ll pull only the pages about this topic, and every question and answer
                        will stay grounded on them - with the page it came from.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    How many questions?
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                    {STRAIGHT_IN_COUNTS.map((option) => (
                      <button
                        key={option}
                        onClick={() => setStraightCount(option)}
                        className={`rounded-xl border px-2 py-2 text-sm font-medium tabular-nums transition-colors ${
                          straightCount === option
                            ? "border-pop/50 bg-pop/10 text-pop"
                            : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Mostly multiple choice with a few written answers, spread across everything you
                    picked.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Difficulty
                  </div>
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

                <div className="rounded-xl border border-border p-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={straightTimerOn}
                      onChange={(event) => setStraightTimerOn(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--pop)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Timer className="h-3.5 w-3.5 text-pop" />
                        Race the clock
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                        Optional. Finish inside the time for a bonus; running out costs the bonus
                        and nothing else.
                      </span>
                    </span>
                  </label>
                  {straightTimerOn && (
                    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                      {straightTimerOptions.map((option) => (
                        <button
                          key={option}
                          onClick={() => setStraightTimerSeconds(option)}
                          className={`rounded-xl border px-2 py-2 text-sm font-medium tabular-nums transition-colors ${
                            straightTimerSeconds === option
                              ? "border-pop/50 bg-pop/10 text-pop"
                              : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                          }`}
                        >
                          {Math.round(option / 60)} min
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Sources</span>
                <span>{selectedDocIds.length} selected</span>
              </div>
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {docs.length === 0 ? (
                  <Link
                    to="/app/library"
                    className="block rounded-xl border border-dashed border-border p-3 text-sm text-pop"
                  >
                    Upload files in Library
                  </Link>
                ) : (
                  docs.map((doc) => {
                    const selected = selectedDocIds.includes(doc.id);
                    return (
                      <button
                        key={doc.id}
                        onClick={() => toggleDoc(doc.id)}
                        className={`flex min-w-0 w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "border-pop/40 bg-pop/10"
                            : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                        }`}
                      >
                        <FileText
                          className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-pop" : "text-muted-foreground"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium">{doc.file_name}</span>
                          <span className="block break-words text-xs text-muted-foreground">
                            {folderName(doc) || "Uncategorised"}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <button
              onClick={entry === "roadmap" ? createPlan : startStraightIn}
              disabled={loading}
              className="btn-pop mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed"
            >
              {loading ? (
                <LoadingDots />
              ) : entry === "roadmap" ? (
                <BrainCircuit className="h-4 w-4" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {entry === "roadmap" ? "Build roadmap" : `Start ${straightCount} questions`}
            </button>
            {loading && entry === "straight" && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Reading across the whole file. Larger sets take a little longer.
              </p>
            )}
          </div>

          {/* History */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf/12 text-leaf">
                <History className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold tracking-[-0.01em]">Your roadmaps</h2>
            </div>
            <div className="space-y-2">
              {plans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No roadmaps yet. Build one to start practicing.
                </div>
              ) : (
                plans.map((plan) => (
                  <Link
                    key={plan.id}
                    to="/app/practice"
                    search={{ plan: plan.id }}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:border-pop/40 hover:bg-pop/5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium">{plan.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {plan.source_type}
                        {plan.created_at ? ` · ${formatDate(plan.created_at)}` : ""}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
