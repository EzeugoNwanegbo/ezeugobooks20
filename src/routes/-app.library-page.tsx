import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import {
  chunkDocumentText,
  documentPreview,
  sanitizeExtractedText,
  type DocumentChunkInput,
} from "@/lib/document-chunks";
import { backfillMissingEmbeddings } from "@/lib/embeddings";
import { getCached, setCached } from "@/lib/data-cache";
import { GUEST_DOCUMENT_LIMIT, isGuestUser } from "@/lib/guest-session";
import { stageDocForChat } from "@/lib/chat-handoff";
import { importChunk } from "@/lib/lazy-import";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  Trash2,
  BookUp,
  BookOpen,
  Folder,
  FolderPlus,
  MessageSquare,
  MoreVertical,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";

type FolderRow = {
  id: string;
  name: string;
  color: string | null;
};

type DocRow = {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  page_count: number | null;
  folder_id: string | null;
  suggested_subject: string | null;
  created_at: string;
};

// A file that has been read + chunked in the browser and is waiting for the
// user to choose a folder. Uploading several files queues a batch of these.
type ProcessedFile = {
  fileName: string;
  storagePath: string;
  extracted: string;
  chunks: DocumentChunkInput[];
  pageCount: number;
  fileType: string;
  fileSize: number;
};

// A large scanned PDF being OCR'd by the server-side queue (src/lib/server-ocr.ts).
// Keyed by document id; drives the "processing on our servers" banner under the
// upload card. These never join the folder-assignment batch - the documents row
// is created up-front by the server path and lands in Uncategorised when ready.
type ServerOcrEntry = {
  fileName: string;
  pagesDone: number;
  pagesTotal: number | null;
  status: "processing" | "background" | "error";
  error?: string;
};

function getUploadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Upload failed";
  return error.message || "Upload failed";
}

// Parsing happens entirely in the browser (pdfjs / OCR read the whole file
// into memory). Desktop browsers cope with very large files; phone browsers -
// Android Chrome in particular - kill the renderer process when a tab uses too
// much memory, which shows up as a blank page with no catchable error. Cap the
// size on memory-constrained devices so the user gets a clear message instead.
// A generous safety ceiling only - the Android blank-page issue is NOT a
// file-size/memory problem (it happens with small files too), so this is just
// a guard against absurd uploads, not the fix.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export function LibraryPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<{ id: string; title: string }[]>([]);
  // Which of this user's documents have already been offered to the shared
  // library, keyed by source document id -> submission status. Drives the card
  // affordance so "Share" never invites a second, duplicate submission.
  const [sharedStatus, setSharedStatus] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  // Determinate progress for the upload bar: percent + a "page 12 of 230"
  // style count. Null percent renders the bar as an indeterminate pulse for
  // stages with no measurable progress (engine load, embedding, saving).
  const [uploadBar, setUploadBar] = useState<{ percent: number | null; label: string } | null>(
    null,
  );
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [serverOcr, setServerOcr] = useState<Record<string, ServerOcrEntry>>({});
  const [pendingBatch, setPendingBatch] = useState<ProcessedFile[] | null>(null);
  const [chosenFolder, setChosenFolder] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // Purely-visual: which folder chip is selected in the new pill-filter bar
  // ("all" | "__none" | a folder id). Replaces the old per-folder accordion
  // as the way documents are scoped on screen.
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const applyLibraryData = (nextFolders: FolderRow[], nextDocs: DocRow[]) => {
    setFolders(nextFolders);
    setDocs(nextDocs);
    // open all folders by default first time
    setOpenFolders((cur) => {
      const next = { ...cur };
      for (const fo of nextFolders) {
        if (!(fo.id in next)) next[fo.id] = true;
      }
      if (!("__none" in next)) next.__none = true;
      return next;
    });
  };

  const refresh = async () => {
    if (!user) return;
    // Show the last-known library instantly (no spinner on revisit), then
    // revalidate in the background.
    const cached = getCached<{ folders: FolderRow[]; docs: DocRow[] }>(`library:${user.id}`);
    if (cached) applyLibraryData(cached.folders, cached.docs);

    const [{ data: f }, { data: d }] = await Promise.all([
      supabase.from("folders").select("id, name, color").eq("user_id", user.id).order("name"),
      supabase
        .from("documents")
        .select(
          "id, file_name, file_type, file_size, page_count, folder_id, suggested_subject, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    const nextFolders = (f as FolderRow[]) ?? [];
    const nextDocs = (d as DocRow[]) ?? [];
    applyLibraryData(nextFolders, nextDocs);
    setCached(`library:${user.id}`, { folders: nextFolders, docs: nextDocs });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Quietly backfill embeddings for any chunks uploaded before semantic search
  // existed (or whose embedding failed at upload). Idempotent and self-stopping:
  // once everything is embedded this no-ops. Runs in the background; never blocks
  // the UI and silently gives up on failure (keyword search still works).
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    backfillMissingEmbeddings(user.id, { signal: controller.signal }).catch((err) => {
      console.warn("embedding backfill skipped", err);
    });
    return () => controller.abort();
  }, [user]);

  // If a previous upload left an "in-flight" breadcrumb, the tab died mid
  // processing (Android Chrome can kill the renderer with no catchable error).
  // DIAGNOSTIC: we also record the last stage reached, so this toast tells us
  // exactly where it died (e.g. "pdf:creating-document") on the next test.
  useEffect(() => {
    let stuck: string | null = null;
    let stage: string | null = null;
    try {
      stuck = sessionStorage.getItem("gd_upload_inflight");
      stage = sessionStorage.getItem("gd_upload_stage");
      if (stuck) sessionStorage.removeItem("gd_upload_inflight");
      if (stage) sessionStorage.removeItem("gd_upload_stage");
    } catch {
      // ignore
    }
    if (stuck) {
      toast.error(
        `Upload of "${stuck}" stopped at step: ${stage ?? "unknown"}. The page reloaded mid-upload. Please screenshot this and send it to us.`,
        { duration: 60_000 },
      );
    }
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const folderNameById = new Map(folders.map((f) => [f.id, f.name.toLowerCase()]));
    const matches = (d: DocRow) => {
      if (!q) return true;
      const folderName = d.folder_id ? (folderNameById.get(d.folder_id) ?? "") : "uncategorised";
      return (
        d.file_name.toLowerCase().includes(q) ||
        (d.suggested_subject?.toLowerCase().includes(q) ?? false) ||
        folderName.includes(q)
      );
    };
    const map: Record<string, DocRow[]> = { __none: [] };
    for (const f of folders) map[f.id] = [];
    for (const d of docs) {
      if (!matches(d)) continue;
      const k = d.folder_id ?? "__none";
      if (!map[k]) map[k] = [];
      map[k].push(d);
    }
    return map;
  }, [folders, docs, query]);

  const matchCount = useMemo(
    () => Object.values(grouped).reduce((total, list) => total + list.length, 0),
    [grouped],
  );

  // Display-only lookup (original-case folder name) for the "folder · N
  // pages" line on each document card.
  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  // Flat list of documents to show in the card grid: everything (already
  // search-filtered by `grouped`) when "All" is selected, or just the
  // selected folder's/Uncategorised's documents.
  const visibleDocs = useMemo(() => {
    if (activeFolder === "all") return Object.values(grouped).flat();
    return grouped[activeFolder] ?? [];
  }, [grouped, activeFolder]);

  const activeFolderObj = folders.find((f) => f.id === activeFolder) ?? null;

  // Hands a large scanned PDF (> 50 pages, no text layer) to the server-side
  // OCR queue: upload the real bytes + enqueue page-range jobs, then babysit
  // the queue in the background while the banner under the upload card shows
  // page progress. Only the upload/enqueue part is awaited - OCR-ing a book
  // takes many minutes and must not block the rest of the upload batch.
  const startServerOcr = async (file: File) => {
    if (!user) return;
    setUploadBar({ percent: null, label: `Uploading "${file.name}" for server OCR` });
    // Lazy-import for the same reason as pdf.js above: keep the Library page
    // lightweight until this rare path is actually taken.
    const { enqueueServerOcr, driveServerOcr } = await import("@/lib/server-ocr");
    const { documentId } = await enqueueServerOcr(file, user.id); // throws -> caller's toast
    setServerOcr((cur) => ({
      ...cur,
      [documentId]: { fileName: file.name, pagesDone: 0, pagesTotal: null, status: "processing" },
    }));
    toast.info(
      `"${file.name}" is a scanned PDF, so our servers are OCR-ing it. Keep this tab open to speed it up - progress shows below the upload box.`,
      { duration: 10_000 },
    );
    void refresh(); // the row appears (Uncategorised, processing) right away

    // Fire-and-forget babysitter: pokes the worker + polls progress until the
    // document is ready, fails, or the watch budget runs out (pg_cron keeps
    // draining the queue after that, so "background" is not a failure).
    void driveServerOcr(documentId, (p) =>
      setServerOcr((cur) =>
        cur[documentId] ? { ...cur, [documentId]: { ...cur[documentId], ...p } } : cur,
      ),
    )
      .then((outcome) => {
        if (outcome.status === "ready") {
          setServerOcr((cur) => {
            const next = { ...cur };
            delete next[documentId];
            return next;
          });
          toast.success(`"${file.name}" finished OCR and is ready to use.`);
          void refresh();
          return;
        }
        setServerOcr((cur) =>
          cur[documentId]
            ? {
                ...cur,
                [documentId]: {
                  ...cur[documentId],
                  status: outcome.status,
                  error: outcome.status === "error" ? outcome.error : undefined,
                },
              }
            : cur,
        );
        if (outcome.status === "error") {
          toast.error(`OCR failed for "${file.name}": ${outcome.error}`);
        } else {
          toast.info(
            `"${file.name}" is still OCR-ing on our servers - it continues in the background. Check back later.`,
          );
        }
        void refresh();
      })
      .catch((err) => console.warn("server OCR babysitter stopped", err));
  };

  // Read + chunk a single file in the browser. Returns the processed result, or
  // null if the file was rejected (too large, empty, unreadable) - the caller
  // keeps going so one bad file doesn't sink the whole batch.
  const processFile = async (file: File): Promise<ProcessedFile | null> => {
    if (!user) return null;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`"${file.name}" is too large (max 500 MB)`);
      return null;
    }
    // Breadcrumb + stage marker: if the browser tab dies mid-processing (Android
    // Chrome killing the renderer), there's no catchable error. We record an
    // "in-flight" flag plus the last stage reached, then report it on next mount
    // so we know exactly where it died. Best-effort (sessionStorage may throw).
    const setStage = (stage: string) => {
      try {
        sessionStorage.setItem("gd_upload_stage", stage);
      } catch {
        // ignore
      }
    };
    try {
      sessionStorage.setItem("gd_upload_inflight", file.name);
    } catch {
      // sessionStorage may be unavailable; the breadcrumb is best-effort.
    }
    setStage("started");

    let extracted = "";
    let pageCount = 0;
    setStage("detecting-type");
    const lowerName = file.name.toLowerCase();
    const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(lowerName);
    const isText = file.type.startsWith("text/") || lowerName.endsWith(".txt");
    const isDocx = lowerName.endsWith(".docx");
    const isPptx = lowerName.endsWith(".pptx");

    // Legacy binary Office formats can't be read reliably in the browser.
    if (/\.(doc|ppt)$/i.test(lowerName)) {
      toast.error(
        `"${file.name}" is an old Office format. Open it and "Save As" .docx or .pptx, then upload again.`,
      );
      return null;
    }

    // iOS often reports PDFs as application/octet-stream or with no MIME at
    // all (iCloud Drive). Check MIME, extension, then scan first 1KB for the
    // "%PDF-" header - Acrobat-compatible tolerance for leading garbage.
    let isPdf =
      file.type === "application/pdf" || file.type.includes("pdf") || lowerName.endsWith(".pdf");
    if (!isPdf && !isImage && !isText && !isDocx && !isPptx && file.size >= 5) {
      const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      for (let i = 0; i <= head.length - 5; i++) {
        if (
          head[i] === 0x25 &&
          head[i + 1] === 0x50 &&
          head[i + 2] === 0x44 &&
          head[i + 3] === 0x46 &&
          head[i + 4] === 0x2d
        ) {
          isPdf = true;
          break;
        }
      }
    }

    if (isDocx) {
      setStage("docx:extracting");
      const { extractDocxText } = await import("@/lib/office");
      extracted = await extractDocxText(file);
    } else if (isPptx) {
      setStage("pptx:extracting");
      const { extractPptxText } = await import("@/lib/office");
      const r = await extractPptxText(file);
      extracted = r.text;
      pageCount = r.slideCount;
    } else if (isPdf) {
      // Lazy-import pdf.js so the Library page stays lightweight until a file
      // is actually being processed. Loading the heavy PDF engine up front
      // made the page memory-heavy exactly when the Android file picker is
      // open, which makes Android Chrome more likely to discard/kill the
      // page (the "blank, stuck until reload" symptom).
      setStage("pdf:importing-engine");
      const { extractPdfText } = await importChunk(() => import("@/lib/pdf"));
      setStage("pdf:engine-loaded");
      // Scanned PDFs with no text layer get a second, much slower OCR pass -
      // watch the stage stream so the progress bar says so instead of silently
      // "reading" the same pages again.
      let ocrPass = false;
      try {
        const r = await extractPdfText(
          file,
          Number.POSITIVE_INFINITY,
          (stage) => {
            if (stage.startsWith("pdf:ocr")) ocrPass = true;
            setStage(stage);
          },
          (page, total) =>
            setUploadBar({
              percent: Math.round((page / total) * 100),
              label: ocrPass
                ? `OCR-ing scanned page ${page} of ${total}`
                : `Reading page ${page} of ${total}`,
            }),
        );
        extracted = r.text;
        pageCount = r.pageCount;
      } catch (err) {
        // Scanned AND too big to OCR in the browser (> 50 pages): hand it to
        // the server-side OCR queue instead. Nothing joins the folder batch -
        // the documents row is created by the server path and lands in
        // Uncategorised once ready.
        if (err instanceof Error && err.message === "__SCANNED_PDF_LARGE__") {
          await startServerOcr(file);
          return null;
        }
        throw err;
      }
      setUploadBar(null); // chunk/embed/save stages have no page meter
    } else if (isImage) {
      setStage("image:importing-ocr");
      setProgress("Loading OCR engine...");
      // Lazy-import tesseract so PDF/text uploads don't pay the cost
      // (and aren't blocked when the OCR bundle fails to load on flaky
      // mobile networks).
      const { extractImageText } = await import("@/lib/image-ocr");
      setStage("image:ocr-loaded");
      setProgress("Reading image text in your browser...");
      const r = await extractImageText(file, (status, percent) => {
        setProgress(percent === undefined ? status : `${status} (${percent}%)`);
        setUploadBar({ percent: percent ?? null, label: status });
      });
      setUploadBar(null);
      extracted = r.text;
      pageCount = r.pageCount;
    } else if (isText) {
      setStage("text:reading");
      extracted = await file.text();
    } else if (file.size > 0) {
      // Last-resort fallback for unknown binaries (e.g. iCloud Drive PDFs
      // with no extension, no MIME, and leading bytes before %PDF). Let
      // pdfjs decide - it throws a clean error if it isn't really a PDF.
      try {
        setStage("probe:importing-engine");
        const { extractPdfText } = await importChunk(() => import("@/lib/pdf"));
        const r = await extractPdfText(
          file,
          Number.POSITIVE_INFINITY,
          (s) => setStage(`probe:${s}`),
          (page, total) =>
            setUploadBar({
              percent: Math.round((page / total) * 100),
              label: `Reading page ${page} of ${total}`,
            }),
        );
        extracted = r.text;
        pageCount = r.pageCount;
        isPdf = true;
        setUploadBar(null);
      } catch (probeErr) {
        // The probe proved it IS a PDF - just a scanned one too big for
        // browser OCR. Same server routing as the explicit PDF branch above.
        if (probeErr instanceof Error && probeErr.message === "__SCANNED_PDF_LARGE__") {
          await startServerOcr(file);
          return null;
        }
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const hex = Array.from(head)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        console.warn("Unrecognised upload", {
          name: file.name,
          type: file.type,
          size: file.size,
          head: hex,
          probeErr,
        });
        toast.error(
          `Couldn't read "${file.name}" as a PDF, Word, PowerPoint, text, or image (type: ${file.type || "unknown"}, ${(file.size / 1024 / 1024).toFixed(1)} MB). Try saving it to your Downloads or Files folder first, then upload from there.`,
        );
        return null;
      }
    } else {
      toast.error(`"${file.name}" looks empty. Try a different one.`);
      return null;
    }

    extracted = sanitizeExtractedText(extracted);

    // Office files with no text runs are almost always image-only decks/scans;
    // reject them clearly. (PDFs/images keep their original behaviour: a scanned
    // file with no OCR text can still be saved.)
    if ((isDocx || isPptx) && !extracted.trim()) {
      toast.error(`Couldn't find any text in "${file.name}". It may be image-only or empty.`);
      return null;
    }

    setStage("chunking");
    const chunks = chunkDocumentText(extracted);

    // Text-only mode: we don't upload the original file to storage (saves
    // bandwidth and bypasses the 50 MB Supabase storage default limit for
    // huge course materials). storage_path is a virtual marker.
    const path = `text-only/${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const fileType = isPdf
      ? "pdf"
      : isImage
        ? "image"
        : isDocx
          ? "docx"
          : isPptx
            ? "pptx"
            : "text";

    return {
      fileName: file.name,
      storagePath: path,
      extracted: documentPreview(extracted),
      chunks,
      pageCount: pageCount || 0,
      fileType,
      fileSize: file.size,
    };
  };

  // Process one or more selected files in sequence, then open a single folder
  // assignment modal for the whole batch.
  const onUploadFiles = async (files: File[]) => {
    if (!user || files.length === 0) return;
    // Guests get a small trial library; processing + embeddings cost real money,
    // so the full library needs an account.
    if (isGuestUser(user)) {
      const remaining = GUEST_DOCUMENT_LIMIT - docs.length;
      if (remaining <= 0) {
        toast.error(
          `Guest sessions can hold ${GUEST_DOCUMENT_LIMIT} documents. Create a free account to add more - everything you've made stays with you.`,
        );
        navigate({ to: "/auth", search: { mode: "upgrade" } });
        return;
      }
      if (files.length > remaining) {
        toast.warning(
          `Guest sessions can hold ${GUEST_DOCUMENT_LIMIT} documents - uploading the first ${remaining} of ${files.length}.`,
        );
        files = files.slice(0, remaining);
      }
    }
    setUploading(true);
    const processed: ProcessedFile[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setUploadBar(null);
        setProgress(
          files.length > 1
            ? `Processing ${i + 1} of ${files.length}: ${file.name}`
            : "Extracting text (large files may take a minute)...",
        );
        try {
          const result = await processFile(file);
          if (result) processed.push(result);
        } catch (err) {
          console.error("upload document", file.name, err);
          toast.error(`Couldn't process "${file.name}": ${getUploadErrorMessage(err)}`);
        }
      }
    } finally {
      try {
        sessionStorage.removeItem("gd_upload_inflight");
        sessionStorage.removeItem("gd_upload_stage");
      } catch {
        // ignore
      }
      setUploading(false);
      setProgress("");
      setUploadBar(null);
      if (fileRef.current) fileRef.current.value = "";
    }

    if (processed.length === 0) return; // every file failed; toasts already shown
    setPendingBatch(processed);
    setChosenFolder("__none");
    setNewFolderName("");
  };

  const confirmAssign = async (thenChat = false) => {
    if (!user || !pendingBatch || pendingBatch.length === 0 || saving) return;
    setSaving(true);
    // TEMP diagnostic timing: find which save phase is slow. Remove once fixed.
    const t0 = performance.now();
    const timings: string[] = [];
    const mark = (label: string, since: number) => {
      const ms = Math.round(performance.now() - since);
      timings.push(`${label} ${ms}ms`);
      console.log(`[save-timing] ${label}: ${ms}ms`);
    };
    let folderId: string | null = null;
    try {
      if (chosenFolder === "__new") {
        const name = newFolderName.trim();
        if (!name) {
          toast.error("Give the folder a name");
          return;
        }
        // reuse if exists
        const existing = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          folderId = existing.id;
        } else {
          const { data, error } = await supabase
            .from("folders")
            .insert({ user_id: user.id, name })
            .select("id")
            .single();
          if (error) throw error;
          folderId = data.id;
        }
      } else if (chosenFolder === "__none") {
        folderId = null;
      } else {
        folderId = chosenFolder;
      }

      mark("folder", t0);
      // Insert every file in the batch into the chosen folder. One file's
      // failure is reported but doesn't abort the rest.
      let firstDocId: string | null = null;
      let savedCount = 0;
      let chunkSaveFailed = false;
      for (const item of pendingBatch) {
        const tDoc = performance.now();
        const { data: doc, error: dbErr } = await supabase
          .from("documents")
          .insert({
            user_id: user.id,
            file_name: item.fileName,
            storage_path: item.storagePath,
            file_type: item.fileType,
            file_size: item.fileSize,
            page_count: item.pageCount || null,
            extracted_text: item.extracted,
            folder_id: folderId,
            suggested_subject: null,
          })
          .select("id")
          .single();
        mark(`doc-insert(${item.chunks.length}ch)`, tDoc);
        if (dbErr) {
          console.error("save document", item.fileName, dbErr);
          toast.error(`Couldn't save "${item.fileName}": ${dbErr.message}`);
          continue;
        }
        savedCount += 1;
        if (!firstDocId) firstDocId = doc.id;

        if (item.chunks.length > 0) {
          // Save chunks immediately with no embedding. Embedding each chunk means
          // a round trip to OpenAI per 96-chunk batch - on a big textbook that's
          // the bulk of the "saving" wait. We skip it here so saving is just the
          // DB inserts (near-instant), and let the background backfill below add
          // the vectors a few seconds later. Chunks stay keyword-searchable in
          // the meantime, so search never breaks while embeddings catch up.
          const rows = item.chunks.map((chunk) => ({
            document_id: doc.id,
            user_id: user.id,
            chunk_index: chunk.chunk_index,
            page_start: chunk.page_start,
            page_end: chunk.page_end,
            content: chunk.content,
            token_estimate: chunk.token_estimate,
            embedding: null,
          }));

          // Insert chunks in parallel batches instead of one-at-a-time. The
          // browser caps ~6 concurrent requests per host, so a big textbook's
          // chunks drain in a few waves rather than dozens of serial round
          // trips - that serial loop was the bulk of the long "saving" wait.
          const CHUNK_BATCH = 200;
          const batchStarts: number[] = [];
          for (let i = 0; i < rows.length; i += CHUNK_BATCH) {
            batchStarts.push(i);
          }
          const tChunks = performance.now();
          const results = await Promise.all(
            batchStarts.map((start) =>
              supabase.from("document_chunks").insert(rows.slice(start, start + CHUNK_BATCH)),
            ),
          );
          const failedBatch = results.find((result) => result.error);
          if (failedBatch?.error) {
            console.error("save document chunks", failedBatch.error);
            chunkSaveFailed = true;
          }
          mark(`chunk-insert(${rows.length})`, tChunks);
        }
      }

      if (savedCount > 0) {
        toast.success(
          savedCount === 1 ? `Added "${pendingBatch[0].fileName}"` : `Added ${savedCount} files`,
          // TEMP: show where the save time went. Remove with the timing code.
          { description: `${Math.round(performance.now() - t0)}ms - ${timings.join(", ")}` },
        );
        // Embed the just-saved chunks in the background so semantic search lights
        // up shortly after, without making the user wait for it. Fire-and-forget:
        // it's idempotent, self-stopping, and keeps running even if we navigate
        // away to the chat below.
        backfillMissingEmbeddings(user.id).catch((err) =>
          console.warn("post-save embedding backfill skipped", err),
        );
        // Point at the sharing option while the upload is still the thing the
        // user is looking at. The button lives on each card; this is the nudge
        // that tells them it exists at all.
        setTimeout(() => {
          toast("Want other students to have this?", {
            description:
              savedCount === 1
                ? 'Tap "Share with everyone" on the file to offer it to the shared library — you earn points if it\'s approved.'
                : 'Tap "Share with everyone" on any file to offer it to the shared library — you earn points if it\'s approved.',
          });
        }, 1200);
      }
      if (chunkSaveFailed) {
        toast.warning("Saved, but searchable chunks need the database migration.");
      }
      setPendingBatch(null);
      setChosenFolder("");
      setNewFolderName("");

      if (thenChat && firstDocId && pendingBatch.length === 1) {
        // Hand the new document to the chat as its search context and jump
        // straight into a fresh conversation - "upload, then start chatting".
        stageDocForChat(user.id, firstDocId);
        navigate({ to: "/app/chat", search: {} });
        return;
      }

      const tRefresh = performance.now();
      await refresh();
      mark("refresh", tRefresh);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const cancelAssign = () => {
    // Batches are processed as text-only, so there's no storage object to clean up.
    setPendingBatch(null);
    setChosenFolder("");
    setNewFolderName("");
  };

  const moveDoc = async (docId: string, folderId: string | null) => {
    const { error } = await supabase
      .from("documents")
      .update({ folder_id: folderId })
      .eq("id", docId);
    if (error) toast.error(error.message);
    else {
      toast.success("Moved");
      refresh();
    }
  };

  // Built-in textbooks the student can search without uploading, scoped to
  // their discipline (books with no discipline are shared with everyone).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("library_documents")
        .select("id, title, discipline")
        .eq("status", "approved");
      if (cancelled || !data) return;
      const disc = profile?.discipline ?? null;
      setLibraryBooks(
        data
          .filter((b) => !b.discipline || b.discipline === disc)
          .map((b) => ({ id: b.id, title: b.title })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.discipline]);

  // This user's own submissions. RLS already scopes library_documents to
  // "approved OR submitted_by = me", so filtering by the current user is what
  // separates my pending books from the world's approved ones.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("library_documents")
        .select("source_document_id, status")
        .eq("submitted_by", user.id);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) {
        if (row.source_document_id) next[row.source_document_id] = row.status;
      }
      setSharedStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Offer an uploaded doc to the shared library. It lands as a pending
  // submission the admin reviews; the student earns points if it's approved.
  const shareToLibrary = async (doc: DocRow) => {
    if (!user) return;
    if (sharedStatus[doc.id]) return;
    if (
      !confirm(
        `Share "${doc.file_name}" with other students?\n\nIt will be reviewed before it appears in the shared library. You earn points if it's approved.`,
      )
    )
      return;
    try {
      const { error } = await supabase.from("library_documents").insert({
        title: doc.file_name,
        file_name: doc.file_name,
        file_type: doc.file_type,
        page_count: doc.page_count,
        file_size: doc.file_size,
        discipline: profile?.discipline ?? null,
        subject: doc.suggested_subject,
        source_document_id: doc.id,
        submitted_by: user.id,
        status: "pending",
      });
      if (error) throw error;
      setSharedStatus((prev) => ({ ...prev, [doc.id]: "pending" }));
      toast.success("Sent for review — you'll earn points if it's approved for the library.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not share this document");
    }
  };

  const onDelete = async (doc: DocRow) => {
    if (!user) return;
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    const { data: row } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", doc.id)
      .single();
    if (row?.storage_path && !row.storage_path.startsWith("text-only/")) {
      const path = row.storage_path;
      if (path.startsWith("serverocr/")) {
        // Server-OCR documents store the parts FOLDER here (many <=50 MB part
        // files, see src/lib/server-ocr.ts), not a single object. List and
        // remove them all so storage doesn't drift from the table.
        const { data: objects } = await supabase.storage.from("documents").list(path);
        const paths = (objects ?? []).map((o) => `${path}/${o.name}`);
        if (paths.length) await supabase.storage.from("documents").remove(paths);
      } else {
        await supabase.storage.from("documents").remove([path]);
      }
    }
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Document deleted");
      refresh();
    }
  };

  const createFolder = async () => {
    if (!user) return;
    const name = prompt("Folder name (e.g. Cardiology, Year 2)")?.trim();
    if (!name) return;
    const { error } = await supabase.from("folders").insert({ user_id: user.id, name });
    if (error) toast.error(error.message);
    else {
      toast.success(`Created "${name}"`);
      refresh();
    }
  };

  const renameFolder = async (f: FolderRow) => {
    const name = prompt("Rename folder", f.name)?.trim();
    if (!name || name === f.name) return;
    const { error } = await supabase.from("folders").update({ name }).eq("id", f.id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const deleteFolder = async (f: FolderRow) => {
    const count = (grouped[f.id] || []).length;
    if (
      !confirm(
        count > 0
          ? `Delete folder "${f.name}"? Its ${count} document(s) will move to Uncategorised.`
          : `Delete folder "${f.name}"?`,
      )
    )
      return;
    // documents folder_id will be set to null by FK on delete
    const { error } = await supabase.from("folders").delete().eq("id", f.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Folder deleted");
      refresh();
    }
  };

  const toggleFolder = (id: string) => setOpenFolders((cur) => ({ ...cur, [id]: !cur[id] }));

  const search = useSearch({ strict: false }) as { onboarding?: boolean };
  const isOnboarding = search?.onboarding === true;
  const openFilePicker = () => {
    if (uploading) return;
    fileRef.current?.click();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {isOnboarding && docs.length === 0 && (
          <div className="rounded-2xl border border-pop/20 bg-pop/10 p-6 text-center animate-in fade-in slide-in-from-top-4 duration-500">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-pop" />
            <h2 className="mb-2 font-display text-xl font-light">Welcome to G&D!</h2>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Your library is where you store the PDFs and notes you want to study. Upload your
              first file below to see how G&D uses them to answer your questions.
            </p>
          </div>
        )}

        <PageHeader
          eyebrow="Library"
          title="Your study material"
          subtitle="Upload large files so G&D can search them and point answers back to the source."
          actions={
            <>
              {docs.length > 0 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search documents and folders..."
                    className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/45 sm:w-64"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={createFolder}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-pop/40 hover:text-pop"
              >
                <FolderPlus className="h-4 w-4" />
                New folder
              </button>
              <button
                type="button"
                onClick={openFilePicker}
                disabled={uploading}
                className="btn-pop inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
              >
                <Upload className="h-4 w-4" />
                Upload
              </button>
            </>
          }
        />

        {/* Upload dropzone */}
        <div
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFilePicker();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("border-pop", "bg-pop/[0.14]");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("border-pop", "bg-pop/[0.14]");
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("border-pop", "bg-pop/[0.14]");
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) onUploadFiles(files);
          }}
          className={`block cursor-pointer rounded-2xl border-2 border-dashed border-pop/35 bg-pop/10 p-5 text-center transition-all duration-200 hover:border-pop/60 hover:bg-pop/[0.14] sm:p-8 ${
            uploading ? "pointer-events-none opacity-70" : ""
          } ${isOnboarding && docs.length === 0 ? "ring-2 ring-pop ring-offset-4 ring-offset-background animate-pulse" : ""}`}
        >
          <input
            id="file-up"
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,application/octet-stream,text/plain,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.txt,.png,.jpg,.jpeg,.webp,.docx,.pptx"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onUploadFiles(files);
            }}
          />
          {uploading ? (
            <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2.5 text-sm">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-pop/15"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadBar?.percent ?? undefined}
                aria-label="Upload progress"
              >
                <div
                  className={`h-full rounded-full bg-pop transition-[width] duration-200 ease-out ${
                    uploadBar?.percent == null ? "w-full animate-pulse" : ""
                  }`}
                  style={uploadBar?.percent != null ? { width: `${uploadBar.percent}%` } : undefined}
                />
              </div>
              {uploadBar?.percent != null && (
                <span className="font-semibold tabular-nums text-foreground">
                  {uploadBar.label} · {uploadBar.percent}%
                </span>
              )}
              <span className="text-muted-foreground">
                {uploadBar?.percent == null && uploadBar?.label
                  ? uploadBar.label
                  : progress || "Working..."}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pop/12 text-pop sm:h-14 sm:w-14">
                <Upload className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <div>
                <div className="text-base font-semibold text-pop sm:text-lg">
                  {isOnboarding && docs.length === 0
                    ? "Tap here to upload your first file"
                    : "Drag files here, or click to browse"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  PDF, Word, PowerPoint, text, or image - pick several at once, drag & drop or tap to
                  browse
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Server-side OCR progress: large scanned PDFs process on Supabase in
            small page-range jobs. This banner tracks each one so the user can
            keep uploading (or leave) while the queue drains. */}
        {Object.keys(serverOcr).length > 0 && (
          <div className="space-y-2">
            {Object.entries(serverOcr).map(([docId, job]) => {
              const percent =
                job.pagesTotal && job.pagesTotal > 0
                  ? Math.min(100, Math.round((job.pagesDone / job.pagesTotal) * 100))
                  : null;
              return (
                <div key={docId} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{job.fileName}</span>
                    {job.status !== "processing" && (
                      <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() =>
                          setServerOcr((cur) => {
                            const next = { ...cur };
                            delete next[docId];
                            return next;
                          })
                        }
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {job.status === "error" ? (
                    <p className="mt-1 text-xs text-destructive">{job.error || "OCR failed."}</p>
                  ) : (
                    <>
                      <div
                        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-pop/15"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent ?? undefined}
                        aria-label="Server OCR progress"
                      >
                        <div
                          className={`h-full rounded-full bg-pop transition-[width] duration-500 ease-out ${
                            percent == null ? "w-full animate-pulse" : ""
                          }`}
                          style={percent != null ? { width: `${percent}%` } : undefined}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.status === "background"
                          ? "Still processing on our servers - check back later."
                          : job.pagesTotal
                            ? `OCR-ing on our servers · page ${job.pagesDone} of ${job.pagesTotal}`
                            : "Starting OCR on our servers..."}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Folder filter chips + document grid */}
        {docs.length === 0 && folders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-pop/10 text-pop">
              <BookOpen className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">No documents yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Upload your first PDF or notes above and G&D will index it for search and chat.
            </p>
            <button
              type="button"
              onClick={openFilePicker}
              className="btn-pop mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
            >
              <Upload className="h-4 w-4" />
              Upload your first file
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveFolder("all")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeFolder === "all"
                    ? "border-pop/45 bg-pop/10 text-pop"
                    : "border-border text-muted-foreground hover:border-pop/30 hover:text-foreground"
                }`}
              >
                All
                <span className="tabular-nums opacity-70">{docs.length}</span>
              </button>
              {folders.map((f) => {
                const count = (grouped[f.id] || []).length;
                const active = activeFolder === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActiveFolder(f.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-pop/45 bg-pop/10 text-pop"
                        : "border-border text-muted-foreground hover:border-pop/30 hover:text-foreground"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: f.color || "var(--pop)" }}
                    />
                    {f.name}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
              {(grouped.__none || []).length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveFolder("__none")}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeFolder === "__none"
                      ? "border-pop/45 bg-pop/10 text-pop"
                      : "border-border text-muted-foreground hover:border-pop/30 hover:text-foreground"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full border border-border" />
                  Uncategorised
                  <span className="tabular-nums opacity-70">{(grouped.__none || []).length}</span>
                </button>
              )}
            </div>

            {activeFolderObj && (
              <div className="-mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => renameFolder(activeFolderObj)}
                  className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  Rename folder
                </button>
                <button
                  type="button"
                  onClick={() => deleteFolder(activeFolderObj)}
                  className="transition-colors hover:text-destructive"
                >
                  Delete folder
                </button>
              </div>
            )}

            {libraryBooks.length > 0 && !query.trim() && (
              <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <BookUp className="h-4 w-4 text-pop" />
                  <h3 className="text-sm font-semibold text-foreground">Built-in textbooks</h3>
                  <span className="text-xs text-muted-foreground">
                    already searchable — no upload needed
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {libraryBooks.map((b) => (
                    <span
                      key={b.id}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
                    >
                      {b.title}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {query.trim() && matchCount === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground sm:py-12">
                No documents match "{query}".
              </p>
            ) : visibleDocs.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground sm:py-12">
                Nothing in this folder yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleDocs.map((d) => (
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    folderName={d.folder_id ? (folderNameById.get(d.folder_id) ?? "Folder") : "Uncategorised"}
                    isProcessing={!!serverOcr[d.id]}
                    allFolders={folders}
                    onDelete={onDelete}
                    onMove={moveDoc}
                    onShare={shareToLibrary}
                    shareStatus={sharedStatus[d.id]}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Folder assignment modal */}
      {pendingBatch && pendingBatch.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-lg sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pop/10 text-pop">
                  <Folder className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-display text-xl font-light">Save to folder</div>
                  <div className="max-w-[calc(100vw-8rem)] truncate text-xs text-muted-foreground sm:max-w-[260px]">
                    {pendingBatch.length === 1
                      ? pendingBatch[0].fileName
                      : `${pendingBatch.length} files ready`}
                  </div>
                </div>
              </div>
              <button
                onClick={cancelAssign}
                disabled={saving}
                className="text-muted-foreground hover:text-foreground p-1 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {pendingBatch.length > 1 && (
              <ul className="mb-4 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/40 p-2 text-xs">
                {pendingBatch.map((item, index) => (
                  <li key={index} className="flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-pop" />
                    <span className="min-w-0 flex-1 truncate">{item.fileName}</span>
                  </li>
                ))}
              </ul>
            )}

            <label className="block text-xs font-semibold mb-1.5">Folder</label>
            <select
              value={chosenFolder}
              onChange={(e) => setChosenFolder(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/45"
            >
              <option value="__new">+ New folder...</option>
              <option value="__none">Uncategorised</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            {chosenFolder === "__new" && (
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                autoFocus
                className="mt-2 w-full px-3 py-2 rounded-xl border border-input bg-background text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/45"
              />
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                onClick={cancelAssign}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed sm:mr-auto"
              >
                Cancel
              </button>
              {pendingBatch.length === 1 ? (
                <>
                  <button
                    onClick={() => void confirmAssign(false)}
                    disabled={saving}
                    className="px-4 py-2 text-sm rounded-xl border border-border font-medium hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Save to Library
                  </button>
                  <button
                    onClick={() => void confirmAssign(true)}
                    disabled={saving}
                    className="btn-pop inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-xl font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <LoadingDots />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" />
                    )}
                    {saving ? "Saving..." : "Start Chatting"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void confirmAssign(false)}
                  disabled={saving}
                  className="btn-pop inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-xl font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <LoadingDots />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {saving ? "Saving..." : `Add ${pendingBatch.length} files to Library`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  doc,
  folderName,
  isProcessing,
  allFolders,
  onDelete,
  onMove,
  onShare,
  shareStatus,
}: {
  doc: DocRow;
  folderName: string;
  isProcessing: boolean;
  allFolders: FolderRow[];
  onDelete: (doc: DocRow) => void;
  onMove: (docId: string, folderId: string | null) => void;
  onShare: (doc: DocRow) => void;
  /** Submission status if this doc was already offered to the library. */
  shareStatus?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = [folderName, doc.page_count ? `${doc.page_count} pages` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pop/10 text-pop">
          <FileText className="h-5 w-5" />
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-elevated hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Document actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Move to
                </div>
                <button
                  onClick={() => {
                    onMove(doc.id, null);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-elevated"
                >
                  <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                  Uncategorised
                </button>
                {allFolders
                  .filter((f) => f.id !== doc.folder_id)
                  .map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        onMove(doc.id, f.id);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-elevated"
                    >
                      <Folder className="h-3.5 w-3.5 text-pop" />
                      {f.name}
                    </button>
                  ))}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(doc);
                  }}
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]" title={doc.file_name}>
          {doc.file_name}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{meta}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isProcessing ? "bg-pop/12 text-pop" : "bg-leaf/12 text-leaf"
          }`}
        >
          {isProcessing ? "Processing" : "Indexed"}
        </span>

        {/* Sharing used to be buried in the "..." menu, where nobody found it.
            It sits on the face of the card now: one tap, states its reward, and
            turns into a status pill once submitted. */}
        {!isProcessing &&
          (shareStatus ? (
            <span
              className="inline-flex w-fit items-center gap-1 rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              title={
                shareStatus === "approved"
                  ? "This book is in the shared library"
                  : shareStatus === "rejected"
                    ? "Not accepted for the shared library"
                    : "Waiting for review"
              }
            >
              <BookUp className="h-3 w-3" />
              {shareStatus === "approved"
                ? "In shared library"
                : shareStatus === "rejected"
                  ? "Not accepted"
                  : "Pending review"}
            </span>
          ) : (
            <button
              onClick={() => onShare(doc)}
              className="inline-flex items-center gap-1 rounded-full border border-pop/40 bg-pop/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pop transition-colors hover:bg-pop/20"
              title="Offer this to every student on G&D. You earn points if it's approved."
            >
              <BookUp className="h-3 w-3" />
              Share with everyone
            </button>
          ))}
      </div>
    </div>
  );
}
