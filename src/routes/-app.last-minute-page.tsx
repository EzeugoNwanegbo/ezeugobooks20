import ReactMarkdown from "react-markdown";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  Download,
  FileText,
  GraduationCap,
  Presentation,
  TimerReset,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { zipSync, strToU8 } from "fflate";
import { LoadingDots } from "@/components/loading-dots";
import { useAuth } from "@/lib/auth-context";
import { stageLastMinuteForCoach } from "@/lib/last-minute-handoff";
import { importChunk } from "@/lib/lazy-import";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import {
  costFor,
  reportCookieSpend,
  reportCookiesSettled,
  reportOutOfCookies,
} from "@/lib/cookies";

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

type FunctionErrorWithContext = Error & {
  context?: Response;
};

async function readableFunctionError(error: unknown): Promise<string> {
  if (error instanceof Error) {
    const context = (error as FunctionErrorWithContext).context;
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as { error?: unknown; message?: unknown };
        const serverMessage =
          typeof body.error === "string"
            ? body.error
            : typeof body.message === "string"
              ? body.message
              : "";
        if (serverMessage) return serverMessage;
      } catch {
        try {
          const text = await context.clone().text();
          if (text.trim()) return text.trim();
        } catch {
          // Fall through to the generic client-side message.
        }
      }
    }
    return error.message;
  }

  return "";
}

function generationErrorMessage(message: string) {
  if (/failed to fetch|networkerror|load failed|failed to send/i.test(message)) {
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
  // The file picker collapses the moment a note is ready, so the export row
  // sits right under the header instead of behind the whole grid again. It
  // never auto-collapses before a first successful generate.
  const [pickerOpen, setPickerOpen] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);

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

  const selectedDocs = useMemo(
    () => docs.filter((doc) => selected.includes(doc.id)),
    [docs, selected],
  );
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
    // Optimistic: the real charge happens server-side, inside the Edge
    // Function, before it calls DeepSeek. See src/lib/cookies.ts's
    // reportCookieSpend() header note - this moves the ring now rather than
    // waiting the round trip, and the finally block below reconciles it.
    reportCookieSpend(costFor("last_minute"));
    try {
      const { data, error } = await supabase.functions.invoke("last-minute", {
        body: { docIds: selected },
      });
      if (error) {
        const context = (error as FunctionErrorWithContext).context;
        if (context instanceof Response && context.status === 402) {
          try {
            const failed = (await context.clone().json()) as {
              error?: string;
              remaining?: number;
              allowance?: number;
            };
            if (failed.error === "out_of_cookies") {
              reportOutOfCookies({ remaining: failed.remaining, allowance: failed.allowance });
            }
          } catch {
            /* ignore - the generic error message below still shows */
          }
        }
        throw error;
      }
      const body = data as { title?: string; note?: string; error?: string } | null;
      if (!body || body.error) throw new Error(body?.error ?? "Could not generate Master Note.");
      setTitle(body.title || "Last Minute Master Note");
      setNote(cleanAiText(body.note || ""));
      setProgressIndex(PROGRESS_STEPS.length - 1);
      setPickerOpen(false);
      toast.success("Master Note ready");
    } catch (error) {
      toast.error(generationErrorMessage(await readableFunctionError(error)));
    } finally {
      reportCookiesSettled();
      setGenerating(false);
    }
  };

  // Builds the export PDF through the same pdf-lib pipeline the chat page uses
  // for Detailed+ notes (src/lib/notes-pdf.ts), loaded on demand so it never
  // adds to the main bundle. This used to be window.print(), which handed the
  // student the OS print dialog and made them find "Save as PDF" themselves.
  const exportPdf = async () => {
    if (!note) return;
    setPdfBusy(true);
    try {
      const { buildNotesPdf, downloadPdfBytes } = await importChunk(
        () => import("@/lib/notes-pdf"),
      );
      const { bytes, filename } = await buildNotesPdf(note, { title });
      downloadPdfBytes(bytes, filename);
    } catch (error) {
      console.error("last-minute pdf", error);
      toast.error("Couldn't build the PDF — try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Last minute"
          title="Build one clean study guide from your lecture files."
          subtitle="Pick files from one course. G&D merges them into one clean revision sheet, ready to export."
          actions={
            <button
              type="button"
              onClick={() => navigate({ to: "/app/library" })}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
            >
              <BookOpen className="h-4 w-4" />
              Open Library
            </button>
          }
        />

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-[-0.01em]">Choose study files</h2>
              {pickerOpen && (
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, PowerPoint, Word, text, or image — up to {MAX_DOCS} files, {MAX_PAGES} pages
                  or slides each.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="rounded-full bg-pop/10 px-2.5 py-1 text-xs font-semibold text-pop">
                {selected.length}/{MAX_DOCS}
              </span>
              {!pickerOpen && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="text-xs font-semibold text-pop hover:underline"
                >
                  Change files
                </button>
              )}
            </div>
          </div>

          {!pickerOpen ? (
            <p className="mt-3 truncate text-sm text-muted-foreground">
              {selectedDocs.length} file{selectedDocs.length === 1 ? "" : "s"} selected —{" "}
              {selectedDocs.map((doc) => doc.file_name).join(", ")}
            </p>
          ) : loading ? (
            <div className="flex justify-center py-16">
              <LoadingDots />
            </div>
          ) : docs.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Upload study files to your Library first.
              </p>
              <button
                type="button"
                onClick={() => navigate({ to: "/app/library" })}
                className="btn-pop mt-4 rounded-xl px-4 py-2 text-sm font-medium"
              >
                Open Library
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                      className={`flex min-h-[5.75rem] items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${
                        selectedDoc
                          ? "border-pop/50 bg-pop/10"
                          : reason
                            ? "border-border bg-background/40 opacity-60"
                            : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          selectedDoc ? "border-pop bg-pop text-pop-foreground" : "border-border"
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
                                <span className="rounded-full bg-leaf/12 px-2 py-0.5 text-leaf">
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

              <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedDocs.length > 0
                      ? selectedDocs.map((doc) => doc.file_name).join(", ")
                      : `${readyDocs.length} ready file${readyDocs.length === 1 ? "" : "s"} to choose from.`}
                  </p>
                  {generating && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-foreground/10">
                        <div
                          className="h-full rounded-full bg-pop transition-all duration-300"
                          style={{
                            width: `${((progressIndex + 1) / PROGRESS_STEPS.length) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {PROGRESS_STEPS[progressIndex]}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating || selected.length === 0}
                  className="btn-pop inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-45"
                >
                  {generating ? <LoadingDots /> : <TimerReset className="h-4 w-4" />}
                  {generating ? "Generating" : "Generate Master Note"}
                </button>
              </div>
            </>
          )}
        </section>

        {note ? (
          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
            <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Built from {selectedDocs.length} selected file
                  {selectedDocs.length === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadBlob(new Blob([note], { type: "text/markdown" }), `${safeName}.md`)
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/[0.04]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Markdown
                </button>
                <button
                  type="button"
                  onClick={() => downloadBlob(markdownToDocx(note), `${safeName}.docx`)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/[0.04]"
                >
                  <Download className="h-3.5 w-3.5" />
                  DOCX
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  disabled={pdfBusy}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/[0.04] disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {pdfBusy ? "Building…" : "PDF"}
                </button>
              </div>
            </div>

            <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="ai-response-document medai-prose max-w-none rounded-xl border border-border bg-background/40 p-4 text-sm">
                <ReactMarkdown>{note}</ReactMarkdown>
              </div>
              <div className="rounded-xl border border-pop/20 bg-pop/10 p-4">
                <GraduationCap className="h-5 w-5 text-pop" />
                <h3 className="mt-3 font-semibold">Practise this note</h3>
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
                  className="btn-pop mt-4 w-full rounded-xl px-4 py-2 text-sm font-semibold"
                >
                  Open in PQ
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
