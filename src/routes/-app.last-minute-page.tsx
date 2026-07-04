import ReactMarkdown from "react-markdown";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Check, Download, FileText, GraduationCap, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
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

const MAX_DOCS = 10;
const MAX_PAGES = 100;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const LAST_MINUTE_URL = `${SUPABASE_URL}/functions/v1/last-minute`;
const PROGRESS_STEPS = [
  "Reading documents",
  "Splitting content into study chunks",
  "Finding related topics",
  "Connecting concepts",
  "Removing repeated explanations",
  "Resolving overlaps",
  "Building your Master Note",
  "Preparing downloads",
];

function isPdf(doc: Doc) {
  return doc.file_type === "pdf" || doc.file_name.toLowerCase().endsWith(".pdf");
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
    }, 2400);
    return () => window.clearInterval(timer);
  }, [generating]);

  const toggleDoc = (doc: Doc) => {
    if (!isPdf(doc)) {
      toast.error("Last Minute currently accepts PDFs only.");
      return;
    }
    if ((doc.page_count ?? 0) > MAX_PAGES) {
      toast.error(`"${doc.file_name}" is over ${MAX_PAGES} pages. Shorten it before using Last Minute.`);
      return;
    }
    if (doc.extract_status && doc.extract_status !== "ready") {
      toast.error(`"${doc.file_name}" is still processing. Try again when it is Ready.`);
      return;
    }
    setSelected((current) => {
      if (current.includes(doc.id)) return current.filter((id) => id !== doc.id);
      if (current.length >= MAX_DOCS) {
        toast.error(`Select up to ${MAX_DOCS} PDFs.`);
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(LAST_MINUTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ docIds: selected }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.error) throw new Error(body.error ?? "Could not generate Master Note.");
      setTitle(body.title || "Last Minute Master Note");
      setNote(cleanAiText(body.note || ""));
      setProgressIndex(PROGRESS_STEPS.length - 1);
      toast.success("Master Note ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate Master Note.");
    } finally {
      setGenerating(false);
    }
  };

  const selectedDocs = docs.filter((doc) => selected.includes(doc.id));
  const safeName = filenameSafe(title);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            Last Minute
          </div>
          <div>
            <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl md:text-4xl">
              Turn multiple lecture notes into one complete study guide.
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Upload PDFs from the same course, then let G&amp;D connect related concepts, remove
              repetition, balance overlapping information, and build one unified note for revision.
            </p>
          </div>
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-sm text-foreground">
            For best results, choose PDFs from the same course or subject, such as Human Anatomy,
            Physiology, Pathology, or Pharmacology. Avoid mixing unrelated courses.
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="luxury-panel rounded-lg p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Choose PDFs</h2>
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_DOCS} PDFs, {MAX_PAGES} pages or fewer each.
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {selected.length}/{MAX_DOCS}
              </span>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <LoadingDots />
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Upload PDFs to your Library first.</p>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/app/library" })}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Open Library
                </button>
              </div>
            ) : (
              <div className="grid gap-2">
                {docs.map((doc) => {
                  const selectedDoc = selected.includes(doc.id);
                  const tooLong = (doc.page_count ?? 0) > MAX_PAGES;
                  const disabled = !isPdf(doc) || tooLong || (doc.extract_status && doc.extract_status !== "ready");
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleDoc(doc)}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selectedDoc
                          ? "border-primary/50 bg-primary/10"
                          : disabled
                            ? "border-border bg-surface-lowest opacity-55"
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
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{doc.file_name}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {doc.page_count ? `${doc.page_count} pages` : "Page count unknown"}
                              {!isPdf(doc) ? " - PDF only" : ""}
                              {tooLong ? ` - over ${MAX_PAGES} pages` : ""}
                              {doc.extract_status && doc.extract_status !== "ready"
                                ? ` - ${doc.extract_status}`
                                : ""}
                            </span>
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={generate}
              disabled={generating || selected.length === 0}
              className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-45"
            >
              {generating ? <LoadingDots /> : <Sparkles className="h-4 w-4" />}
              {generating ? "Generating Master Note" : `Generate Master Note (${selected.length})`}
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="luxury-panel rounded-lg p-4">
              <h2 className="font-semibold">Processing</h2>
              <div className="mt-4 space-y-2">
                {PROGRESS_STEPS.map((step, index) => (
                  <div
                    key={step}
                    className={`flex items-center gap-2 text-sm ${
                      index <= progressIndex && (generating || note)
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        index < progressIndex || note
                          ? "bg-primary"
                          : index === progressIndex && generating
                            ? "animate-pulse bg-primary"
                            : "bg-border"
                      }`}
                    />
                    {step}
                  </div>
                ))}
              </div>
            </div>

            {note ? (
              <div className="luxury-panel rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{title}</h2>
                    <p className="text-xs text-muted-foreground">
                      Built from {selectedDocs.length} selected PDF{selectedDocs.length === 1 ? "" : "s"}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadBlob(new Blob([note], { type: "text/markdown" }), `${safeName}.md`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-foreground/[0.04]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadBlob(markdownToDocx(note), `${safeName}.docx`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-foreground/[0.04]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      DOCX
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-foreground/[0.04]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </button>
                  </div>
                </div>
                <div className="ai-response-document medai-prose mt-4 max-w-none rounded-lg border border-border bg-background/40 p-4 text-sm">
                  <ReactMarkdown>{note}</ReactMarkdown>
                </div>
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-4">
                  <div className="flex items-start gap-3">
                    <GraduationCap className="mt-0.5 h-5 w-5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">Continue Learning with My Coach</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Take this study guide into My Coach to ask questions, generate practice,
                        review difficult concepts, and test your understanding.
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
                        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                      >
                        Open in My Coach
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
