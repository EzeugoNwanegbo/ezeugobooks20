import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, FileText, History, Map as MapIcon, Sparkles } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { generateStudyPlan, type StudyRoadmapTopic } from "@/lib/studybody-client";
import {
  db,
  folderName,
  loadStudyDocuments,
  loadStudyDocumentsSpanning,
  type DocRow,
  type PlanRow,
} from "@/lib/studybody-data";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((current) =>
      current.includes(id) ? current.filter((docId) => docId !== id) : [...current, id],
    );
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
      // question stays grounded on just that part of the file — with page refs.
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
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 overflow-x-hidden">
        <header>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <MapIcon className="h-4 w-4" />
            My Coach
          </div>
          <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl md:text-4xl">
            Build a roadmap, then practice it.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Turn your uploaded files into a study roadmap, then open it to practice with MCQs,
            essays, mixed sets, or flash cards.
          </p>
        </header>

        {schemaMissing && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
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

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* New roadmap */}
          <div className="luxury-panel rounded-lg p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">New roadmap</h2>
            </div>
            <input
              value={planTitle}
              onChange={(event) => setPlanTitle(event.target.value)}
              placeholder="Course or topic name"
              className="mb-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <textarea
              value={courseOutline}
              onChange={(event) => setCourseOutline(event.target.value)}
              placeholder="Paste course outline, or leave blank and build from selected files"
              className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <div className="mt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What are you learning?
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setScope("whole")}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                    scope === "whole"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  The whole file
                </button>
                <button
                  type="button"
                  onClick={() => setScope("topic")}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                    scope === "topic"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  A specific topic
                </button>
              </div>
              {scope === "topic" && (
                <>
                  <input
                    value={topicFocus}
                    onChange={(event) => setTopicFocus(event.target.value)}
                    placeholder="Which topic in the file? e.g. “The nephron”"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    We’ll pull only the pages about this topic, and every question and answer will
                    stay grounded on them — with the page it came from.
                  </p>
                </>
              )}
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Sources</span>
                <span>{selectedDocIds.length} selected</span>
              </div>
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {docs.length === 0 ? (
                  <Link
                    to="/app/library"
                    className="block rounded-lg border border-border p-3 text-sm text-primary"
                  >
                    Upload files in Library
                  </Link>
                ) : (
                  docs.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => toggleDoc(doc.id)}
                      className={`flex min-w-0 w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selectedDocIds.includes(doc.id)
                          ? "border-primary/40 bg-primary/10"
                          : "border-border bg-surface/30 hover:border-primary/30"
                      }`}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-medium">{doc.file_name}</span>
                        <span className="block break-words text-xs text-muted-foreground">
                          {folderName(doc) || "Uncategorised"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <button
              onClick={createPlan}
              disabled={loading}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
            >
              {loading ? <LoadingDots /> : <Sparkles className="h-4 w-4" />}
              Build roadmap
            </button>
          </div>

          {/* History */}
          <div className="luxury-panel rounded-lg p-4">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Your roadmaps</h2>
            </div>
            <div className="space-y-2">
              {plans.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No roadmaps yet. Build one to start practicing.
                </div>
              ) : (
                plans.map((plan) => (
                  <Link
                    key={plan.id}
                    to="/app/practice"
                    search={{ plan: plan.id }}
                    className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface/30 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
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
