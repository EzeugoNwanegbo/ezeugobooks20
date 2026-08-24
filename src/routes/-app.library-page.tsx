import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
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
import { chunkSetContentHash, primeDedupSchema } from "@/lib/content-hash";
import { backfillMissingEmbeddings } from "@/lib/embeddings";
import { markSeenOnce, useSeenOnce } from "@/lib/seen-once";
import { getCached, setCached } from "@/lib/data-cache";
import { GUEST_DOCUMENT_LIMIT, isGuestUser } from "@/lib/guest-session";
import { stageDocForChat } from "@/lib/chat-handoff";
import { importChunk } from "@/lib/lazy-import";
import {
  allowanceFrom,
  planUploadBatch,
  recordUploads,
  uploadAllowanceLabel,
  uploadsUsedToday,
} from "@/lib/allowances";
import {
  emptyGamificationStats,
  loadGamificationStats,
  recordGamificationEvent,
} from "@/lib/gamification";
import { ShareWithGdDialog, type SharePromptFile } from "@/components/share-with-gd-dialog";
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
  // Written by every ingestion path (this page, extract-pdf, ocr-enqueue /
  // ocr-worker). NULL only on rows that predate the column - see isDocReady.
  extract_status: string | null;
  extract_error: string | null;
};

// The upload lifecycle, in the vocabulary every other reader already speaks
// (supabase/functions/{extract-pdf,ocr-enqueue,ocr-worker}, last-minute,
// connect-dots, gandd-mobile):
//
//   'processing' - the row exists and is listed, but is NOT groundable yet.
//                  Written WITH the documents row, before a single chunk.
//   'ready'      - every chunk is committed. Written only after that fact.
//   'error'      - the extraction or the chunk write failed; extract_error
//                  carries something the student can act on.
//   'rejected'   - the file itself is unusable (server paths only).
//   'pending'    - queued for server-side work (server-OCR path only).
//
// NULL is "unknown, assume ready": last-minute treats NULL-with-text as ready
// and the mobile chat picker treats NULL as ready, because rows written before
// the column existed are fine. That tolerance is exactly why this page must
// never leave a half-written book on NULL.
function isDocReady(doc: { extract_status: string | null }): boolean {
  return !doc.extract_status || doc.extract_status === "ready";
}

// Chunk rows as document_chunks wants them.
type ChunkRow = {
  document_id: string;
  user_id: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
  token_estimate: number;
  embedding: null;
};

// Insert chunks in parallel batches instead of one-at-a-time. The browser caps
// ~6 concurrent requests per host, so a big textbook's chunks drain in a few
// waves rather than dozens of serial round trips.
const CHUNK_BATCH = 200;
const CHUNK_BATCH_RETRIES = 3;

/**
 * Write one batch of chunks, halving and recursing on a statement timeout.
 *
 * UPSERT on (document_id, chunk_index), not INSERT: the same reasoning that
 * supabase/functions/extract-pdf now follows. Writing an index twice must repair
 * the row rather than abort the batch, so a re-run of a partially-written
 * document is pure repair. document_chunks carries UNIQUE (document_id,
 * chunk_index) (migration 20260430002000) for the upsert to land on.
 *
 * A statement timeout is about the size of THIS statement, not bad luck - the
 * same batch would fail again however many times it is retried - so splitting is
 * what actually fixes it. Copied from scripts/ingest-library.mjs.
 *
 * Returns null on success, or the error message.
 */
async function upsertChunkBatch(rows: ChunkRow[], attempt = 0): Promise<string | null> {
  if (rows.length === 0) return null;
  const { error } = await supabase
    .from("document_chunks")
    .upsert(rows, { onConflict: "document_id,chunk_index" });
  if (!error) return null;

  const timedOut = /statement timeout|canceling statement/i.test(error.message ?? "");
  if (timedOut && rows.length > 1 && attempt < CHUNK_BATCH_RETRIES) {
    const mid = Math.ceil(rows.length / 2);
    const left = await upsertChunkBatch(rows.slice(0, mid), attempt + 1);
    const right = await upsertChunkBatch(rows.slice(mid), attempt + 1);
    return left ?? right;
  }
  return error.message || "Could not save this document's searchable text.";
}

/**
 * Write every chunk of one document. Reports how many landed and the first
 * failure, so the caller can mark the document honestly instead of guessing.
 */
async function writeAllChunks(
  rows: ChunkRow[],
): Promise<{ written: number; error: string | null }> {
  const batches: ChunkRow[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK_BATCH) batches.push(rows.slice(i, i + CHUNK_BATCH));

  const results = await Promise.all(batches.map((batch) => upsertChunkBatch(batch)));

  let written = 0;
  let error: string | null = null;
  results.forEach((result, index) => {
    if (result === null) written += batches[index].length;
    else if (error === null) error = result;
  });
  return { written, error };
}

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

// ── The first-run explainer ───────────────────────────────────────────────
// Two pieces of teaching copy live on this page: the header paragraph that
// says what a library IS ("Upload large files so G&D can search them..."), and
// the dropzone's supporting line listing the formats and the drag-and-drop
// hint. Both earn their keep exactly once. Somebody landing here for the first
// time genuinely does not know what this screen is for; somebody on their
// second visit does, and by then the paragraph is just furniture standing
// between them and their own documents. So we remember, per user, that the
// page has been opened, and from the next visit onwards the screen opens
// straight into their material behind a compact "Library" label and a dropzone
// that says nothing but "Upload file".
//
// The signal is "has opened this page before", not "has uploaded something".
// It is the honest reading of the owner's "after the user uses it": a student
// who arrives, reads the explanation and leaves without uploading has still
// been told, and re-teaching them on every visit until they finally upload is
// exactly the nagging we are removing. It is also the only signal that cannot
// get stuck - an upload can fail, a document can be deleted, but a visit is a
// visit.
//
// Keyed per user id, so a shared laptop does not hand one student's "seen" to
// the next one. Storage-blocked browsers (private mode, hardened settings)
// fall through to "already seen", the same bargain src/lib/feature-tour.ts
// strikes: silently skipping one first run is a far smaller failure than an
// explainer that reintroduces itself on every single navigation.
const LIBRARY_INTRO_SEEN_KEY = "gd_library_intro_seen_v1";

function markLibraryIntroSeen(ownerId: string): void {
  try {
    window.localStorage.setItem(`${LIBRARY_INTRO_SEEN_KEY}:${ownerId}`, "1");
    markSeenOnce("library", ownerId);
  } catch {
    // Nothing to do - worst case the explainer introduces itself once more.
  }
}

export function LibraryPage() {
  // No `profile` here on purpose: this page used to read profile.discipline to
  // decide which shared-library books a student was allowed to see. That
  // demarcation is gone, so the library needs nothing from the profile at all.
  const { user } = useAuth();
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
  // The share-with-G&D prompt. ONE per upload batch, never one per file: a
  // ten-file folder drop is one gesture and deserves one question, and the
  // answer applies to everything in it. Non-null means the dialog is up.
  const [sharePrompt, setSharePrompt] = useState<SharePromptFile[] | null>(null);
  // "Start Chatting" is deferred, not cancelled, when the prompt is raised: the
  // student asked to go to the chat, so we take them there the moment they have
  // answered, rather than dropping the intent or talking over it.
  const [chatAfterPrompt, setChatAfterPrompt] = useState<string | null>(null);
  // Is the prompt still on screen? A ref, not the state, because an in-flight
  // share resolves inside a closure that captured the state as it was when the
  // request started.
  const sharePromptOpen = useRef(false);
  // Purely-visual: which folder chip is selected in the new pill-filter bar
  // ("all" | "__none" | a folder id). Replaces the old per-folder accordion
  // as the way documents are scoped on screen.
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  // The daily upload allowance, shown as an earned expansion and enforced in
  // onUploadFiles. Counted in files, not in drops: a folder of ten spends ten.
  // See src/lib/allowances.ts.
  const [gamification, setGamification] = useState(emptyGamificationStats);
  const [uploadsToday, setUploadsToday] = useState(0);

  // Frozen for the length of this visit. We mark the intro seen the moment the
  // page mounts, but the student reading it right now keeps it until they
  // leave - copy that evaporates underneath a reader is worse than copy that
  // overstays.
  // "unknown" until the account's list has been read, and nothing renders in
  // that state - see useSeenOnce. Showing by default would flash the intro at a
  // returning student on a new device for as long as the query takes.
  const showIntro = useSeenOnce("library", user?.id) === "unseen";

  useEffect(() => {
    if (!user || !showIntro) return;
    markLibraryIntroSeen(user.id);
  }, [user, showIntro]);

  // Which shelf is on screen: the student's own uploads, or the built-in books
  // everybody shares. They used to be stacked on one page, so the shared shelf
  // sat wedged between the folder chips and the student's own documents and
  // read like part of their library. They are two different collections owned
  // by two different people; they get two tabs.
  const [shelf, setShelf] = useState<"mine" | "shared">("mine");

  // The document whose sheet is open. Everything you can do to one document -
  // ask about it, share it, move it, delete it - lives in there rather than on
  // the face of every card in the grid.
  const [openDoc, setOpenDoc] = useState<DocRow | null>(null);

  // Does this document actually hold searchable chunks? Keyed by document id;
  // a missing entry means "not probed yet", and the card claims nothing either
  // way until we know.
  //
  // This exists because extraction can fail silently. A book whose extraction
  // died leaves extract_status NULL - which every reader in the codebase
  // charitably treats as "fine, this row predates the column" - so the library
  // showed it as Indexed and the student studied from an empty book and
  // wondered why G&D knew nothing about it. The probe asks the one question
  // that matters, through the same RLS path retrieval itself uses: can I see a
  // single chunk of this document? If the answer is no here, chat cannot
  // ground an answer on it either, and saying so is the honest thing.
  const [hasText, setHasText] = useState<Record<string, boolean>>({});
  const probedDocs = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;
    const pending = docs
      .filter((d) => isDocReady(d) && !probedDocs.current.has(d.id))
      .map((d) => d.id);
    if (pending.length === 0) return;
    for (const id of pending) probedDocs.current.add(id);

    let cancelled = false;
    void (async () => {
      // Six at a time. The browser caps concurrent requests per host at about
      // that anyway, and a student with sixty books should not fire sixty
      // requests down the same pipe the document list is still using. This is
      // background colour on an already-rendered page; it is never awaited by
      // anything the student is waiting for.
      const queue = [...pending];
      const worker = async () => {
        while (queue.length > 0 && !cancelled) {
          const id = queue.shift();
          if (!id) return;
          const { data, error } = await supabase
            .from("document_chunks")
            .select("document_id")
            .eq("document_id", id)
            .limit(1);
          if (cancelled) return;
          if (error) {
            // Let a later render try again rather than recording a verdict we
            // did not actually reach. Silence beats a false accusation.
            probedDocs.current.delete(id);
            continue;
          }
          const found = (data?.length ?? 0) > 0;
          setHasText((cur) => (cur[id] === found ? cur : { ...cur, [id]: found }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    })();
    return () => {
      cancelled = true;
    };
  }, [user, docs]);

  useEffect(() => {
    if (!user) return;
    setUploadsToday(uploadsUsedToday(user.id));
    const refreshStats = () => setGamification(loadGamificationStats(user.id));
    refreshStats();
    window.addEventListener("gd:gamification", refreshStats);
    return () => window.removeEventListener("gd:gamification", refreshStats);
  }, [user]);

  const allowance = allowanceFrom(gamification.points, uploadsToday, gamification.activeDays);

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
          "id, file_name, file_type, file_size, page_count, folder_id, suggested_subject, created_at, extract_status, extract_error",
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
    const fileType = isPdf ? "pdf" : isImage ? "image" : isDocx ? "docx" : isPptx ? "pptx" : "text";

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

    // The daily allowance, in files. Guests are governed by GUEST_DOCUMENT_LIMIT
    // above and are deliberately exempt here, so the two never double-apply or
    // hand out two different numbers for the same batch.
    if (!isGuestUser(user)) {
      // Read the counter fresh rather than trusting `uploadsToday`: a tab left
      // open across the UTC rollover holds a stale count in state.
      const usedNow = uploadsUsedToday(user.id);
      const current = allowanceFrom(gamification.points, usedNow, gamification.activeDays);
      setUploadsToday(usedNow);
      const plan = planUploadBatch(current, files.length);
      if (plan.message) {
        const waiting = files.slice(plan.accepted).map((f) => f.name);
        const shown = waiting.slice(0, 3).join(", ");
        toast.info(plan.message, {
          description:
            waiting.length > 3
              ? `Waiting for tomorrow: ${shown} and ${waiting.length - 3} more`
              : `Waiting for tomorrow: ${shown}`,
        });
      }
      if (plan.accepted <= 0) return;
      if (plan.accepted < files.length) files = files.slice(0, plan.accepted);
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
    // Spend the allowance on what actually made it through. A file that failed
    // to extract cost the student nothing, so it must not cost them an upload.
    if (user) setUploadsToday(recordUploads(user.id, processed.length));
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
      // Only a document whose chunks are ALL committed counts as saved, and only
      // such a document may be handed to the chat below. Anything else lands in
      // brokenFiles and is reported by name.
      let firstReadyDocId: string | null = null;
      const readyNames: string[] = [];
      const brokenFiles: { fileName: string; reason: string }[] = [];
      let dedupedCount = 0;
      // Asked once, here, and then used for the whole batch rather than
      // re-probed per file: every gated decision below has to make the SAME
      // assumption, and a probe that answered differently half way through a
      // batch would stamp some rows with a fingerprint and not others.
      const dedupReady = await primeDedupSchema();
      // Files this student could contribute to the pool. A file only qualifies
      // if it finished as 'ready' with every chunk committed AND it was not
      // already in the pool - a matched upload cost the pool nothing, so there
      // is nothing to ask about. A broken extraction must never be offered:
      // pooled, one bad book becomes everyone's bad book.
      const shareCandidates: SharePromptFile[] = [];
      for (const item of pendingBatch) {
        const tDoc = performance.now();

        // De-duplication. Everybody in a year group uploads the same handful of
        // textbooks, and storing each student a private copy of the same chunks
        // is what filled the database. Fingerprint the extracted text and ask
        // whether the G&D pool already holds it; if so this document links to
        // the pool and writes no chunks at all. Saving also becomes near-instant
        // for the student, since the chunk inserts were the bulk of the wait.
        //
        // Linking here COSTS THE STUDENT NOTHING AND GIVES NOTHING AWAY: the
        // pool already had this content, so no sharing decision arises and the
        // prompt below is deliberately not raised for these files.
        //
        // Fails soft in every direction: no hash, no match, or an errored lookup
        // all fall through to the normal full-copy path. The cost of getting it
        // wrong is storage, never a missing or mismatched book - the database
        // re-checks the hash before it will accept the link.
        const tHash = performance.now();
        const contentHash = await chunkSetContentHash(item.chunks);
        let pooledId: string | null = null;
        if (dedupReady && contentHash) {
          const { data: existingId, error: lookupErr } = await supabase.rpc(
            "find_pooled_document",
            { p_content_hash: contentHash },
          );
          if (lookupErr) console.warn("dedup lookup skipped", lookupErr);
          else pooledId = (existingId as string | null) ?? null;
          mark(`dedup-lookup(${pooledId ? "hit" : "miss"})`, tHash);
        }

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
            // THE FINGERPRINT IS STAMPED WHEN IT BECOMES TRUE, NOT BEFORE.
            //
            // contentHash describes the chunk set we are ABOUT to write. Writing
            // it here - as this page used to - means an upload interrupted half
            // way (a failed batch, or a closed tab) leaves a row claiming the
            // whole book while holding a fraction of it. A stale hash on a
            // broken document is not merely untidy: it is what a later
            // pool_share_document() would fingerprint, so a fraction of a book
            // could be offered to the pool under the whole book's name. So a
            // fresh copy is hashed only after its last chunk commits, in the
            // same UPDATE that marks it ready - which costs no extra round trip.
            //
            // A LINK is the exception and must carry the hash immediately: the
            // composite foreign key (pooled_document_id, content_hash) ->
            // pool_documents (id, content_hash) refuses any link whose hash does
            // not already equal the pool row's, and the CHECK constraint beside
            // it refuses a link with no hash at all. It is also true from the
            // moment the row exists, because the link owns no chunks to get
            // wrong. Both columns must be written in the SAME statement - the
            // key is checked as a pair.
            // Gated: naming a column PostgREST cannot find rejects the entire
            // insert, so these are omitted until the dedup migration is applied.
            ...(dedupReady
              ? { content_hash: pooledId ? contentHash : null, pooled_document_id: pooledId }
              : {}),
            // Written WITH the row, not after it, and never optimistically.
            //
            // A link needs no chunks of its own - it reads the pool's - so it is
            // complete the moment the row exists, exactly as extract-pdf's dedup
            // branch decides. Everything else is 'processing' until its last
            // chunk is committed further down.
            //
            // This page used to leave the column NULL from beginning to end,
            // which is why the seven damaged textbooks looked perfectly normal:
            // every reader treats NULL-with-text as ready, so a document holding
            // 100 chunks of a 2,785-page book was listed, searched, and returned
            // nothing, with no hint that anything was wrong.
            extract_status: pooledId ? "ready" : "processing",
            extract_error: null,
          })
          .select("id")
          .single();
        mark(`doc-insert(${item.chunks.length}ch)`, tDoc);
        if (dbErr) {
          console.error("save document", item.fileName, dbErr);
          toast.error(`Couldn't save "${item.fileName}": ${dbErr.message}`);
          continue;
        }

        if (pooledId) {
          // Already in the pool; this document reads through the link. Skipping
          // the insert here is the entire point of the feature.
          dedupedCount += 1;
          readyNames.push(item.fileName);
          if (!firstReadyDocId) firstReadyDocId = doc.id;
          continue;
        }

        if (item.chunks.length === 0) {
          // No chunks means no searchable text at all - an image whose OCR found
          // nothing, or an empty file. Saying so is the honest outcome; leaving
          // it unmarked would list an empty book as a usable one. Same call
          // extract-pdf makes when its chunker returns nothing.
          const message =
            "We couldn't find any readable text in this file, so there's nothing to search. If it's a scan or a photo, try a clearer copy or a text-based PDF.";
          await supabase
            .from("documents")
            .update({ extract_status: "error", extract_error: message })
            .eq("id", doc.id);
          brokenFiles.push({ fileName: item.fileName, reason: "no readable text" });
          continue;
        }

        {
          // Save chunks immediately with no embedding. Embedding each chunk means
          // a round trip to OpenAI per 96-chunk batch - on a big textbook that's
          // the bulk of the "saving" wait. We skip it here so saving is just the
          // DB inserts (near-instant), and let the background backfill below add
          // the vectors a few seconds later. Chunks stay keyword-searchable in
          // the meantime, so search never breaks while embeddings catch up.
          const rows: ChunkRow[] = item.chunks.map((chunk) => ({
            document_id: doc.id,
            user_id: user.id,
            chunk_index: chunk.chunk_index,
            page_start: chunk.page_start,
            page_end: chunk.page_end,
            content: chunk.content,
            token_estimate: chunk.token_estimate,
            embedding: null,
          }));

          const tChunks = performance.now();
          const write = await writeAllChunks(rows);
          mark(`chunk-insert(${write.written}/${rows.length})`, tChunks);

          if (write.error) {
            // A PARTIAL is the dangerous case, and it is the common one: the
            // batches run in parallel, so one failing leaves the successful ones
            // in place. Those rows are valid and stay put - a re-upload upserts
            // over them index-for-index - but the document must not be listed as
            // usable while it holds a fraction of the book.
            console.error("save document chunks", item.fileName, write.error);
            const message =
              write.written > 0
                ? `Only ${write.written} of ${rows.length} sections of this file were saved (${write.error}), so searching it would miss most of the book. Delete it and upload it again.`
                : `None of this file's searchable text could be saved (${write.error}). Delete it and upload it again.`;
            const { error: markErr } = await supabase
              .from("documents")
              // content_hash is deliberately NOT written here - see the insert
              // above. It is still null, so this broken copy can never be
              // matched by anyone else's upload and can never be shared into the
              // pool (pool_share_document also refuses anything not 'ready').
              .update({ extract_status: "error", extract_error: message })
              .eq("id", doc.id);
            // If even the marking fails the row stays 'processing' - still not
            // treated as usable by any reader, which is the property that
            // matters. Never fall through to 'ready'.
            if (markErr) console.error("mark document failed", item.fileName, markErr);
            brokenFiles.push({
              fileName: item.fileName,
              reason: `${write.written} of ${rows.length} sections saved`,
            });
            continue;
          }

          // Every chunk is committed. ONLY NOW is this document usable, so only
          // now does it say so - and only now is its fingerprint true, so this is
          // where it gets stamped and offered to the next student who uploads
          // the same book.
          const { error: readyErr } = await supabase
            .from("documents")
            .update({
              extract_status: "ready",
              extract_error: null,
              ...(dedupReady ? { content_hash: contentHash } : {}),
            })
            .eq("id", doc.id);
          if (readyErr) {
            // The chunks are all there; the flag is not. Honest and retryable:
            // it stays 'processing', which reads as "not ready yet" everywhere,
            // rather than being claimed as finished.
            console.error("mark document ready", item.fileName, readyErr);
            brokenFiles.push({
              fileName: item.fileName,
              reason: "saved, but still finishing - reload in a moment",
            });
            continue;
          }
        }

        readyNames.push(item.fileName);
        if (!firstReadyDocId) firstReadyDocId = doc.id;
        // Everything above committed and the row says 'ready', so this document
        // is genuinely offerable. contentHash is required too: it is null
        // exactly when the content is not safe to de-duplicate on (under 1,000
        // characters, gappy indexes, no Web Crypto), which is the same set
        // pool_share_document() would refuse anyway. Better not to ask than to
        // ask and then explain a refusal.
        if (contentHash) shareCandidates.push({ id: doc.id, fileName: item.fileName });
      }

      const savedCount = readyNames.length;

      if (savedCount > 0) {
        toast.success(
          savedCount === 1 ? `Added "${readyNames[0]}"` : `Added ${savedCount} files`,
          // TEMP: show where the save time went. Remove with the timing code.
          {
            description: `${Math.round(performance.now() - t0)}ms - ${timings.join(", ")}${
              dedupedCount > 0
                ? ` - ${dedupedCount} already in the library, linked instead of re-stored`
                : ""
            }`,
          },
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
      if (brokenFiles.length > 0) {
        // Say which files and what to do about them. The old code toasted
        // "searchable chunks need the database migration" and moved on, which
        // told the student nothing and left the file looking fine.
        const names = brokenFiles.map((f) => `${f.fileName} (${f.reason})`).join("; ");
        toast.error(
          brokenFiles.length === 1
            ? `"${brokenFiles[0].fileName}" didn't finish saving and can't be searched yet.`
            : `${brokenFiles.length} files didn't finish saving and can't be searched yet.`,
          {
            description: `${names}. They're marked as failed in your library - delete them and upload again.`,
            duration: 20_000,
          },
        );
      }
      setPendingBatch(null);
      setChosenFolder("");
      setNewFolderName("");

      // Only hand a COMPLETE document to the chat. Opening a conversation
      // grounded on a book that saved 200 of its 1,500 sections is the exact
      // silent failure this whole change exists to remove.
      const wantsChat = Boolean(thenChat && firstReadyDocId && pendingBatch.length === 1);

      // THE SHARE PROMPT. One per batch, raised only when there is something
      // real to ask about, and never for:
      //   * a guest - an anonymous session is discarded the moment it is signed
      //     out, so crediting one is a promise the app cannot keep, and
      //     anonymous accounts can be minted on demand, which would make the
      //     daily points cap free to bypass. pool_share_document() refuses them
      //     independently, so showing the prompt would only be offering an
      //     action that always errors. Guests upload exactly as they do today;
      //   * anything that did not finish as 'ready';
      //   * anything already resolved to the pool - it cost the pool nothing.
      // Gated on the probe: with the dedup schema absent shareCandidates is
      // never consulted, so no dialog, no RPC and no new column is touched.
      if (dedupReady && !isGuestUser(user) && shareCandidates.length > 0) {
        setChatAfterPrompt(wantsChat ? firstReadyDocId : null);
        sharePromptOpen.current = true;
        setSharePrompt(shareCandidates);
        // Refresh underneath, so answering lands on an up-to-date library
        // rather than a stale one.
        await refresh();
        return;
      }

      if (wantsChat && firstReadyDocId) {
        // Hand the new document to the chat as its search context and jump
        // straight into a fresh conversation - "upload, then start chatting".
        stageDocForChat(user.id, firstReadyDocId);
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

  // ── The share prompt's two exits ────────────────────────────────────────────
  //
  // "Keep for me" writes NOTHING - no row, no flag, no request. That is what
  // makes a dialog with no X honest rather than a trap: the quiet answer cannot
  // fail, cannot be offline, and is always one click away even after a share has
  // just failed. It is also why nothing is persisted about the choice: the
  // question belongs to this upload, and a student who wants to share later can
  // upload again or use the card's own share action.
  const closeSharePrompt = () => {
    sharePromptOpen.current = false;
    setSharePrompt(null);
    const chatDocId = chatAfterPrompt;
    setChatAfterPrompt(null);
    if (chatDocId && user) {
      stageDocForChat(user.id, chatDocId);
      navigate({ to: "/app/chat", search: {} });
    }
  };

  /**
   * Contribute every file the prompt covers. Returns an error message if any of
   * them failed, or null when they all landed.
   *
   * Per file, not all-or-nothing: pool_share_document() is one transaction per
   * document, so a batch where the third file is refused still leaves the first
   * two properly shared. The failures stay in the dialog for a retry; the
   * successes do not come back a second time and are not paid twice.
   */
  const shareBatchWithGandd = async (): Promise<string | null> => {
    if (!user || !sharePrompt || sharePrompt.length === 0) return null;

    const failures: SharePromptFile[] = [];
    const problems: string[] = [];
    let shared = 0;

    for (const file of sharePrompt) {
      const { error } = await supabase.rpc("pool_share_document", {
        p_document_id: file.id,
      });
      if (error) {
        console.warn("pool share failed", file.fileName, error);
        failures.push(file);
        problems.push(`"${file.fileName}": ${error.message}`);
      } else {
        shared += 1;
      }
    }

    if (shared > 0) {
      // One event carrying the count, so the daily cap applies to the whole
      // gesture exactly as it would to ten separate ones.
      recordGamificationEvent(user.id, "document_shared", { count: shared });
      toast.success(
        shared === 1
          ? "Thank you — it's in our safe hands now. Deleting your copy won't affect it."
          : `Thank you — ${shared} files are in our safe hands now.`,
      );
      void refresh();
    }

    if (failures.length > 0) {
      // The student may have pressed "Keep for me" while this was in flight -
      // that button is deliberately never disabled. If they did, the dialog is
      // gone and it must NOT come back: reopening a dialog with no X, after the
      // student explicitly closed it, would be the trap in its purest form.
      if (!sharePromptOpen.current) return null;
      // Narrow the dialog to what is left to try, so a retry is a retry and not
      // a re-run. Already-shared documents would be no-ops anyway
      // (pool_share_document is idempotent), but the count on screen has to be
      // true.
      setSharePrompt(failures);
      return problems.join(" ");
    }

    closeSharePrompt();
    return null;
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

  // Built-in textbooks the student can search without uploading. These used to
  // be scoped to the reader's own discipline - a medic never saw a law book and
  // vice versa - but the medicine/law demarcation is gone product-wide and the
  // shared library is free for all, so every approved book is offered to every
  // student. The `discipline` column still exists on the row and older rows
  // still carry a value; we simply stop reading it to decide who sees what,
  // which is why this effect no longer depends on the profile at all.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("library_documents")
        .select("id, title")
        .eq("status", "approved");
      if (cancelled || !data) return;
      setLibraryBooks(data.map((b) => ({ id: b.id, title: b.title })));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Deliberately null rather than the sharer's own discipline. Nothing
        // filters the shared library by discipline any more, and stamping a
        // book "medicine" would only mislead the next person to read the row.
        // The column stays in the insert because the schema is unchanged.
        discipline: null,
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

  // ── Drag and drop, promoted to the whole page ──
  // The old design paid for drag-and-drop with a permanent dashed box the size
  // of a poster, sitting above the student's own material on every visit. The
  // capability is worth keeping; the furniture is not. The entire page is the
  // drop target now, and it says so only while something is actually being
  // dragged over it - an affordance that costs nothing until it is relevant.
  //
  // dragDepth, not a boolean: dragenter/dragleave fire for every child element
  // the pointer crosses, so a naive flag flickers off the instant the cursor
  // passes over a document card. Counting enters against leaves is the
  // standard cure.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const dragHasFiles = (e: ReactDragEvent<HTMLDivElement>) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const onPageDragEnter = (e: ReactDragEvent<HTMLDivElement>) => {
    if (uploading || !dragHasFiles(e)) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onPageDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onPageDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    // Without preventDefault the browser navigates to the dropped file, which
    // looks exactly like the app crashing.
    if (dragHasFiles(e)) e.preventDefault();
  };
  const onPageDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (uploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onUploadFiles(files);
  };

  // The one condition that decides the shape of the top of the page: a student
  // with nothing yet needs a target to aim at, and a student with a shelf full
  // of books needs their books, not a target. Folders and search are held back
  // for the same reason - there is nothing to organise or search yet.
  const isEmptyLibrary = docs.length === 0;
  const sharedCount = libraryBooks.length;
  const sharedBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return libraryBooks;
    return libraryBooks.filter((b) => b.title.toLowerCase().includes(q));
  }, [libraryBooks, query]);

  // Sharing hides behind the shared shelf's tab, so a student who is looking
  // at that shelf is the one being told about it. Never force the tab bar on a
  // student with no shared books to browse.
  const showShelfTabs = sharedCount > 0 && !isEmptyLibrary;
  const activeShelf = showShelfTabs ? shelf : "mine";

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
          // First visit is taught; every visit after opens straight into the
          // student's own material. See LIBRARY_INTRO_SEEN_KEY above for why
          // the signal is "has opened this page", not "has uploaded".
          title={showIntro ? "Your study material" : "Library"}
          subtitle={
            showIntro
              ? "Upload large files so G&D can search them and point answers back to the source."
              : undefined
          }
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
                  style={
                    uploadBar?.percent != null ? { width: `${uploadBar.percent}%` } : undefined
                  }
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
                    : showIntro
                      ? "Drag files here, or click to browse"
                      : "Upload file"}
                </div>
                {showIntro && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    PDF, Word, PowerPoint, text, or image - pick several at once, drag & drop or tap
                    to browse
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* The daily allowance, phrased as what the student's rank has ADDED
            rather than what is being withheld. onUploadFiles enforces it. */}
        {!isGuestUser(user) && (
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-xs text-muted-foreground tabular-nums">
            <Sparkles className="h-3.5 w-3.5 text-pop" />
            <span>{uploadAllowanceLabel(allowance)}</span>
          </p>
        )}

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
                <div
                  key={docId}
                  className="rounded-2xl border border-border bg-surface p-3 text-sm"
                >
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
                    folderName={
                      d.folder_id ? (folderNameById.get(d.folder_id) ?? "Folder") : "Uncategorised"
                    }
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
                    {saving ? <LoadingDots /> : <MessageSquare className="h-3.5 w-3.5" />}
                    {saving ? "Saving..." : "Start Chatting"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void confirmAssign(false)}
                  disabled={saving}
                  className="btn-pop inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-xl font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? <LoadingDots /> : <Upload className="h-3.5 w-3.5" />}
                  {saving ? "Saving..." : `Add ${pendingBatch.length} files to Library`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The share prompt. Rendered last so it sits above the folder modal, and
          only ever raised after that modal has closed - the two are never up at
          the same time. */}
      {sharePrompt && sharePrompt.length > 0 && (
        <ShareWithGdDialog
          files={sharePrompt}
          onKeep={closeSharePrompt}
          onShare={shareBatchWithGandd}
        />
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

  // The card used to say "Indexed" for everything that wasn't mid server-OCR,
  // so a document the database knew was broken still looked finished here. Read
  // the column instead. NULL stays "Indexed" - rows predating the column are
  // fine, and every other reader makes the same allowance.
  const status = doc.extract_status;
  const failed = status === "error" || status === "rejected";
  const busy = isProcessing || status === "processing" || status === "pending";
  const usable = !failed && !busy && isDocReady(doc);
  const statusLabel = failed
    ? status === "rejected"
      ? "Unsupported"
      : "Failed"
    : busy
      ? "Processing"
      : "Indexed";
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
        {/* What actually went wrong, in the student's words, on the file it
            happened to. Without this a failed book is just a red pill. */}
        {failed && doc.extract_error && (
          <p className="mt-1.5 text-xs leading-snug text-destructive">{doc.extract_error}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            failed
              ? "bg-destructive/12 text-destructive"
              : busy
                ? "bg-pop/12 text-pop"
                : "bg-leaf/12 text-leaf"
          }`}
        >
          {statusLabel}
        </span>

        {/* Sharing used to be buried in the "..." menu, where nobody found it.
            It sits on the face of the card now: one tap, states its reward, and
            turns into a status pill once submitted. */}
        {/* Only a complete book may be offered to everyone. Sharing a partial
            extraction would propagate the failure to every student. */}
        {usable &&
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
