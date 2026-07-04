import ReactMarkdown from "react-markdown";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  Download,
  FileText,
  GraduationCap,
  Presentation,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { zipSync, strToU8 } from "fflate";
import { LoadingDots } from "@/components/loading-dots";
import { useAuth } from "@/lib/auth-context";
import { stageLastMinuteForCoach } from "@/lib/last-minute-handoff";
import { supabase } from "@/integrations/supabase/client";

type Doc = {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  page_count: number | null;
  extract_status: string | null;
  created_at: string;
};

type FileKind = "pdf" | "pptx" | "docx" | "text" | "image";

const MAX_DOCS = 10;
const MAX_PAGES = 100;
const PROGRESS_STEPS = [
  "Reading your study files",
  "Splitting content into study chunks",
  "Finding related topics",
  "Connecting concepts",
  "Removing repeated explanations",
  "Balancing overlapping information",
  "Building your Master Note",
  "Preparing downloads",
];

function fileKind(doc: Doc): FileKind | null {
  const type = (doc.file_type ?? "").toLowerCase();
  const name = doc.file_name.toLowerCase();
  if (type === "pdf" || type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (type === "pptx" || type.includes("presentation") || name.endsWith(".pptx")) return "pptx";
  if (type === "docx" || type.includes("wordprocessing") || name.endsWith(".docx")) return "docx";
  if (type === "text" || type.startsWith("text/") || name.endsWith(".txt")) return "text";
  if (type === "image" || type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(name)) {
    return "image";
  }
  return null;
}

function kindLabel(kind: FileKind | null) {
  if (kind === "pdf") return "PDF";
  if (kind === "pptx") return "PowerPoint";
  if (kind === "docx") return "Word";
  if (kind === "text") return "Text";
  if (kind === "image") return "Image";
  return "Unsupported";
}

function countLabel(doc: Doc) {
  const kind = fileKind(doc);
  if (!doc.page_count) return kind === "pptx" ? "Slides unknown" : "Length unknown";
  if (kind === "pptx") return `${doc.page_count} slides`;
  if (kind === "pdf") return `${doc.page_count} pages`;
  return `${doc.page_count} sections`;
}

function disabledReason(doc: Doc): string | null {
  const kind = fileKind(doc);
  if (!kind) return "Use PDF, PowerPoint, Word, text, or image notes.";
  if ((kind === "pdf" || kind === "pptx") && (doc.page_count ?? 0) > MAX_PAGES) {
    return `${kind === "pptx" ? "PowerPoint" : "PDF"} is over ${MAX_PAGES} ${
      kind === "pptx" ? "slides" : "pages"
    }. Shorten it first.`;
  }
  if (doc.extract_status && doc.extract_status !== "ready") {
    return "Still processing. Try again when it is ready.";
  }
  return null;
}

function cleanAiText(text: string) {
  return text
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(\d)\s*\*\s*(\d)/g, "$1 x $2")
    .replace(/([A-Za-z])\s*\*\s*([A-Za-z])/g, "$1 x $2")
    .replace(/\*/g, "");
}

function filenameSafe(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "last-minute-note";
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToDocx(markdown: string) {
  const paragraphs = markdown.split(/\n+/).map((line) => {
    const text = line.replace(/^#{1,6}\s+/, "").replace(/^-\s+/, "- ");
    return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body>
</w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  return new Blob(
    [
      zipSync({
        "[Content_Types].xml": strToU8(contentTypes),
        "_rels/.rels": strToU8(rels),
        "word/document.xml": strToU8(documentXml),
      }),
    ],
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  );
}

function generationErrorMessage(message: string) {
  if (/failed to fetch|networkerror|load failed|edge function/i.test(message)) {
    return "Last Minute could not reach the synthesis service. Refresh and try again; if it was just deployed, give the function a moment to come online.";
  }
  return message || "Could not generate Master Note.";
}

export function LastMinutePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("Last Minute Master Note");

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    supabase
      .from("documents")
      .select("id, file_name, file_type, file_size, page_count, extract_status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast.error("Couldn't load your Library documents");
        else setDocs((data as Doc[]) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => {
      setProgressIndex((value) => Math.min(value + 1, PROGRESS_STEPS.length - 1));
    }, 2200);
    return () => window.clearInterval(timer);
  }, [generating]);

  const selectedDocs = useMemo(() => docs.filter((doc) => selected.includes(doc.id)), [docs, selected]);
  const readyDocs = useMemo(() => docs.filter((doc) => !disabledReason(doc)), [docs]);
  const safeName = filenameSafe(title);

  const toggleDoc = (doc: Doc) => {
    const reason = disabledReason(doc);
    if (reason) {
      toast.error(reason);
      return;
    }
    setSelected((current) => {
      if (current.includes(doc.id)) return current.filter((id) => id !== doc.id);
      if (current.length >= MAX_DOCS) {
        toast.error(`Select up to ${MAX_DOCS} study files.`);
        return current;
      }
      return [...current, doc.id];
    });
  };

  const generate = async () => {
    if (!user || selected.length === 0) return;
    setGenerating(true);
    setProgressIndex(0);
    setNote("");
    try {
      const { data, error } = await supabase.functions.invoke("last-minute", {
        body: { docIds: selected },
      });
      if (error) throw new Error(error.message);
      const body = data as { title?: string; note?: string; error?: string } | null;
      if (!body || body.error) throw new Error(body?.error ?? "Could not generate Master Note.");
      setTitle(body.title || "Last Minute Master Note");
      setNote(cleanAiText(body.note || ""));
      setProgressIndex(PROGRESS_STEPS.length - 1);
      toast.success("Master Note ready");
    } catch (error) {
      toast.error(generationErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rounded-lg border border-border/70 bg-surface/70 px-4 py-5 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Sparkles className="h-4 w-4" />
                Last Minute
              </div>
              <h1 className="mt-2 font-display text-2xl font-light tracking-normal sm:text-3xl md:text-4xl">
                Build one clean study guide from your lecture files.
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Choose files from the same course and G&amp;D will connect related concepts,
                remove repeated explanations, balance overlaps, and organize everything by topic.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/app/library" })}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.04]"
            >
              <BookOpen className="h-4 w-4" />
              Open Library
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accepted</div>
              <div className="mt-0.5 text-sm font-medium">PDF, PowerPoint, Word, text</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Limit</div>
              <div className="mt-0.5 text-sm font-medium">Up to {MAX_DOCS} files</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Best results</div>
              <div className="mt-0.5 text-sm font-medium">Same course or subject</div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.4fr)]">
          <aside className="flex flex-col gap-4">
            <div className="luxury-panel rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Study set</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Use related materials only. Mixing unrelated courses makes the synthesis weaker.
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {selected.length}/{MAX_DOCS}
                </span>
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-border bg-background/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Selected files
                </div>
                {selectedDocs.length ? (
                  <div className="mt-2 space-y-1.5">
                    {selectedDocs.map((doc) => (
                      <div key={doc.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="truncate">{doc.file_name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Pick files from the Library list to start building your synthesis.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={generate}
                disabled={generating || selected.length === 0}
                className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-45"
              >
                {generating ? <LoadingDots /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Generating Master Note" : "Generate Master Note"}
              </button>
            </div>

            <div className="luxury-panel rounded-lg p-4">
              <h2 className="font-semibold">Progress</h2>
              <div className="mt-4 space-y-3">
                {PROGRESS_STEPS.map((step, index) => {
                  const active = index <= progressIndex && (generating || note);
                  const complete = index < progressIndex || Boolean(note);
                  return (
                    <div key={step} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                          complete
                            ? "border-primary bg-primary text-primary-foreground"
                            : active
                              ? "border-primary text-primary"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {complete ? <Check className="h-3 w-3" /> : index + 1}
                      </span>
                      <span className={`text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}>
                        {step}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          <div className="luxury-panel rounded-lg p-4">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-semibold">Choose study files</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {readyDocs.length} ready file{readyDocs.length === 1 ? "" : "s"} available. PDFs and
                  PowerPoints should be {MAX_PAGES} pages or slides or fewer.
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                Click a file to select or remove it.
              </span>
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <LoadingDots />
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Upload study files to your Library first.</p>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/app/library" })}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Open Library
                </button>
              </div>
            ) : (
              <div className="grid gap-2 xl:grid-cols-2">
                {docs.map((doc) => {
                  const selectedDoc = selected.includes(doc.id);
                  const reason = disabledReason(doc);
                  const kind = fileKind(doc);
                  const isDeck = kind === "pptx";
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleDoc(doc)}
                      className={`flex min-h-[5.75rem] items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selectedDoc
                          ? "border-primary/50 bg-primary/10"
                          : reason
                            ? "border-border bg-surface-lowest opacity-60"
                            : "border-border bg-surface-lowest hover:border-primary/30 hover:bg-surface-elevated"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          selectedDoc ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {selectedDoc ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          {isDeck ? (
                            <Presentation className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-medium leading-snug">
                              {doc.file_name}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                              <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                                {kindLabel(kind)}
                              </span>
                              <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
                                {countLabel(doc)}
                              </span>
                              {reason ? (
                                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
                                  {reason}
                                </span>
                              ) : (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600">
                                  Ready
                                </span>
                              )}
                            </span>
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {note ? (
          <section className="luxury-panel rounded-lg p-4 sm:p-5">
            <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Built from {selectedDocs.length} selected file{selectedDocs.length === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => downloadBlob(new Blob([note], { type: "text/markdown" }), `${safeName}.md`)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-foreground/[0.04]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Markdown
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(markdownToDocx(note), `${safeName}.docx`)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-foreground/[0.04]"
                >
                  <Download className="h-3.5 w-3.5" />
                  DOCX
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-foreground/[0.04]"
                >
                  <Download className="h-3.5 w-3.5" />
                  PDF
                </button>
              </div>
            </div>

            <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="ai-response-document medai-prose max-w-none rounded-lg border border-border bg-background/40 p-4 text-sm">
                <ReactMarkdown>{note}</ReactMarkdown>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-4">
                <GraduationCap className="h-5 w-5 text-primary" />
                <h3 className="mt-3 font-semibold">Continue Learning with My Coach</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Take this master note into My Coach to build a roadmap, generate practice, and
                  review weak areas from the synthesized material.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (user) {
                      stageLastMinuteForCoach(user.id, {
                        title,
                        note,
                        docIds: selected,
                        createdAt: Date.now(),
                      });
                    }
                    navigate({ to: "/app/studybody" });
                  }}
                  className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  Open in My Coach
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
