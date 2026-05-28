import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { extractPdfText } from "@/lib/pdf";
import { chunkDocumentText, documentPreview, type DocumentChunkInput } from "@/lib/document-chunks";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  Trash2,
  Loader2,
  BookOpen,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Sparkles,
  X,
} from "lucide-react";

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


function getUploadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Upload failed";
  return error.message || "Upload failed";
}

export function LibraryPage() {
  const { user } = useAuth();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [pendingAssign, setPendingAssign] = useState<{
    fileName: string;
    storagePath: string;
    extracted: string;
    chunks: DocumentChunkInput[];
    pageCount: number;
    fileType: string;
    fileSize: number;
  } | null>(null);
  const [chosenFolder, setChosenFolder] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    if (!user) return;
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
    setFolders((f as FolderRow[]) ?? []);
    setDocs((d as DocRow[]) ?? []);
    // open all folders by default first time
    setOpenFolders((cur) => {
      const next = { ...cur };
      for (const fo of (f as FolderRow[]) ?? []) {
        if (!(fo.id in next)) next[fo.id] = true;
      }
      if (!("__none" in next)) next.__none = true;
      return next;
    });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const grouped = useMemo(() => {
    const map: Record<string, DocRow[]> = { __none: [] };
    for (const f of folders) map[f.id] = [];
    for (const d of docs) {
      const k = d.folder_id ?? "__none";
      if (!map[k]) map[k] = [];
      map[k].push(d);
    }
    return map;
  }, [folders, docs]);

  const onUpload = async (file: File) => {
    if (!user) return;
    if (file.size > 300 * 1024 * 1024) {
      toast.error("File too large (max 300 MB)");
      return;
    }
    setUploading(true);
    try {
      setProgress("Extracting text (large PDFs may take a minute)...");
      let extracted = "";
      let pageCount = 0;
      const lowerName = file.name.toLowerCase();
      const isImage =
        file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(lowerName);
      const isText = file.type.startsWith("text/") || lowerName.endsWith(".txt");

      // iOS often reports PDFs as application/octet-stream or with no MIME at
      // all (iCloud Drive). Check MIME, extension, then scan first 1KB for the
      // "%PDF-" header — Acrobat-compatible tolerance for leading garbage.
      let isPdf =
        file.type === "application/pdf" ||
        file.type.includes("pdf") ||
        lowerName.endsWith(".pdf");
      if (!isPdf && !isImage && !isText && file.size >= 5) {
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

      if (isPdf) {
        const r = await extractPdfText(file);
        extracted = r.text;
        pageCount = r.pageCount;
      } else if (isImage) {
        setProgress("Loading OCR engine...");
        // Lazy-import tesseract so PDF/text uploads don't pay the cost
        // (and aren't blocked when the OCR bundle fails to load on flaky
        // mobile networks).
        const { extractImageText } = await import("@/lib/image-ocr");
        setProgress("Reading image text in your browser...");
        const r = await extractImageText(file, (status, percent) => {
          setProgress(percent === undefined ? status : `${status} (${percent}%)`);
        });
        extracted = r.text;
        pageCount = r.pageCount;
      } else if (isText) {
        extracted = await file.text();
      } else if (file.size > 0) {
        // Last-resort fallback for unknown binaries (e.g. iCloud Drive PDFs
        // with no extension, no MIME, and leading bytes before %PDF). Let
        // pdfjs decide — it throws a clean error if it isn't really a PDF.
        try {
          const r = await extractPdfText(file);
          extracted = r.text;
          pageCount = r.pageCount;
          isPdf = true;
        } catch (probeErr) {
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
            `Couldn't read this file as a PDF, text, or image (type: ${file.type || "unknown"}, ${(file.size / 1024 / 1024).toFixed(1)} MB). Try saving the file to your Downloads or Files folder first, then upload from there.`,
          );
          setUploading(false);
          setProgress("");
          return;
        }
      } else {
        toast.error("That file looks empty. Try a different one.");
        setUploading(false);
        setProgress("");
        return;
      }

      setProgress("Preparing searchable chunks...");
      const chunks = chunkDocumentText(extracted);

      // Text-only mode: we don't upload the original PDF to storage (saves
      // bandwidth and bypasses the 50 MB Supabase storage default limit for
      // huge course materials). storage_path is a virtual marker.
      const path = `text-only/${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      // Open assignment modal — defer DB insert until user confirms
      setPendingAssign({
        fileName: file.name,
        storagePath: path,
        extracted: documentPreview(extracted),
        chunks,
        pageCount: pageCount || 0,
        fileType: isPdf
          ? "pdf"
          : file.type.startsWith("image/")
            ? "image"
            : "text",
        fileSize: file.size,
      });
      setChosenFolder("__none");
      setNewFolderName("");
    } catch (err) {
      console.error("upload document", err);
      toast.error(getUploadErrorMessage(err));
    } finally {
      setUploading(false);
      setProgress("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmAssign = async () => {
    if (!user || !pendingAssign) return;
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

      const { data: doc, error: dbErr } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          file_name: pendingAssign.fileName,
          storage_path: pendingAssign.storagePath,
          file_type: pendingAssign.fileType,
          file_size: pendingAssign.fileSize,
          page_count: pendingAssign.pageCount || null,
          extracted_text: pendingAssign.extracted,
          folder_id: folderId,
          suggested_subject: null,
        })
        .select("id")
        .single();
      if (dbErr) throw dbErr;

      let chunkSaveFailed = false;
      if (pendingAssign.chunks.length > 0) {
        const rows = pendingAssign.chunks.map((chunk) => ({
          document_id: doc.id,
          user_id: user.id,
          chunk_index: chunk.chunk_index,
          page_start: chunk.page_start,
          page_end: chunk.page_end,
          content: chunk.content,
          token_estimate: chunk.token_estimate,
        }));

        for (let i = 0; i < rows.length; i += 100) {
          const { error: chunkErr } = await supabase
            .from("document_chunks")
            .insert(rows.slice(i, i + 100));
          if (chunkErr) {
            console.error("save document chunks", chunkErr);
            chunkSaveFailed = true;
            break;
          }
        }
      }

      toast.success(`Added "${pendingAssign.fileName}"`);
      if (chunkSaveFailed) {
        toast.warning("Saved file, but searchable chunks need the database migration.");
      }
      setPendingAssign(null);
      setChosenFolder("");
      setNewFolderName("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const cancelAssign = async () => {
    if (pendingAssign && !pendingAssign.storagePath.startsWith("text-only/")) {
      // clean up the orphaned storage object (only if we actually uploaded one)
      await supabase.storage.from("documents").remove([pendingAssign.storagePath]);
    }
    setPendingAssign(null);
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

  const onDelete = async (doc: DocRow) => {
    if (!user) return;
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    const { data: row } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", doc.id)
      .single();
    if (row?.storage_path && !row.storage_path.startsWith("text-only/")) {
      await supabase.storage.from("documents").remove([row.storage_path]);
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-8 md:px-8">
        {isOnboarding && docs.length === 0 && (
          <div className="mb-8 rounded-lg bg-primary/10 border border-primary/20 p-6 text-center animate-in fade-in slide-in-from-top-4 duration-500">
            <Sparkles className="h-8 w-8 text-primary mx-auto mb-3" />
            <h2 className="text-xl font-display font-light mb-2">Welcome to G&D!</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your library is where you store the PDFs and notes you want to study. Upload your
              first file below to see how G&D uses them to answer your questions.
            </p>
          </div>
        )}
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-4xl font-light leading-none sm:text-5xl">
              Your library
            </h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground sm:mt-1">
              Upload large files so G&D can search them and point answers back to the source.
            </p>
          </div>
          <button
            onClick={createFolder}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary sm:w-auto"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
        </div>

        {/* Upload card */}
        <label
          htmlFor="file-up"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("border-primary", "bg-primary/10");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("border-primary", "bg-primary/10");
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("border-primary", "bg-primary/10");
            const f = e.dataTransfer.files?.[0];
            if (f) onUpload(f);
          }}
          className={`block cursor-pointer rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-5 text-center transition-all hover:border-primary hover:bg-primary/10 sm:p-8 ${
            uploading ? "pointer-events-none opacity-70" : ""
          } ${isOnboarding && docs.length === 0 ? "ring-2 ring-primary ring-offset-4 ring-offset-background animate-pulse shadow-glow" : ""}`}
        >
          <input
            id="file-up"
            ref={fileRef}
            type="file"
            accept="application/pdf,application/octet-stream,text/plain,image/png,image/jpeg,image/webp,.pdf,.txt,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-3 text-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-muted-foreground">{progress || "Working..."}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-primary/40 bg-primary/15 sm:h-14 sm:w-14">
                <Upload className="h-6 w-6 text-primary sm:h-7 sm:w-7" />
              </div>
              <div>
                <div className="text-base font-bold text-primary sm:text-lg">
                  {isOnboarding && docs.length === 0
                    ? "Tap here to upload your first file"
                    : "Upload a file"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  PDF, text file, or image — drag & drop or tap to browse
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
                <Upload className="h-4 w-4" />
                Upload file
              </div>
            </div>
          )}
        </label>

        {/* Folder list */}
        <div className="mt-6 space-y-4 sm:mt-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            {docs.length} {docs.length === 1 ? "document" : "documents"} · {folders.length}{" "}
            {folders.length === 1 ? "folder" : "folders"}
          </div>

          {docs.length === 0 && folders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground sm:py-12">
              No documents yet. Upload your first file to start asking precise questions.
            </div>
          ) : (
            <div className="space-y-3">
              {folders.map((f) => (
                <FolderBlock
                  key={f.id}
                  folder={f}
                  docs={grouped[f.id] || []}
                  open={!!openFolders[f.id]}
                  onToggle={() => toggleFolder(f.id)}
                  onRename={() => renameFolder(f)}
                  onDelete={() => deleteFolder(f)}
                  onDeleteDoc={onDelete}
                  onMoveDoc={moveDoc}
                  allFolders={folders}
                />
              ))}
              {(grouped.__none || []).length > 0 && (
                <FolderBlock
                  folder={{
                    id: "__none",
                    name: "Uncategorised",
                    color: null,
                  }}
                  docs={grouped.__none || []}
                  open={!!openFolders.__none}
                  onToggle={() => toggleFolder("__none")}
                  onDeleteDoc={onDelete}
                  onMoveDoc={moveDoc}
                  allFolders={folders}
                  isUncategorised
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Folder assignment modal */}
      {pendingAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="luxury-panel max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg p-5 shadow-elegant sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                  <Folder className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <div className="font-display text-xl font-light">Save to folder</div>
                  <div className="max-w-[calc(100vw-8rem)] truncate text-xs text-muted-foreground sm:max-w-[260px]">
                    {pendingAssign.fileName}
                  </div>
                </div>
              </div>
              <button
                onClick={cancelAssign}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="block text-xs font-semibold mb-1.5">Folder</label>
            <select
              value={chosenFolder}
              onChange={(e) => setChosenFolder(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                className="mt-2 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={cancelAssign}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAssign}
                className="px-4 py-2 text-sm rounded-lg bg-gradient-primary text-primary-foreground font-medium shadow-glow"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderBlock({
  folder,
  docs,
  open,
  onToggle,
  onRename,
  onDelete,
  onDeleteDoc,
  onMoveDoc,
  allFolders,
  isUncategorised,
}: {
  folder: FolderRow;
  docs: DocRow[];
  open: boolean;
  onToggle: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onDeleteDoc: (doc: DocRow) => void;
  onMoveDoc: (docId: string, folderId: string | null) => void;
  allFolders: FolderRow[];
  isUncategorised?: boolean;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  return (
    <div className="luxury-panel overflow-visible rounded-lg">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Folder
            className={`h-4 w-4 ${isUncategorised ? "text-muted-foreground" : "text-primary"}`}
          />
          <span className="font-semibold text-sm truncate">{folder.name}</span>
          <span className="text-xs text-muted-foreground">({docs.length})</span>
        </button>
        {!isUncategorised && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onRename}
              className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-elevated hover:text-foreground sm:inline-flex"
            >
              Rename
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10"
              title="Delete folder"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {open && (
        <ul className="border-t border-border divide-y divide-border">
          {docs.length === 0 ? (
            <li className="px-4 py-4 text-xs text-muted-foreground italic">Empty</li>
          ) : (
            docs.map((d) => (
              <li
                key={d.id}
                className="relative flex items-center gap-2.5 px-3 py-3 transition-colors hover:bg-surface-elevated/50 sm:gap-3 sm:px-4"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.file_name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
                    {d.page_count ? `${d.page_count} pages - ` : ""}
                    {d.file_size ? `${(d.file_size / 1024 / 1024).toFixed(2)} MB` : ""}
                    {" - "}
                    {new Date(d.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuFor(menuFor === d.id ? null : d.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-surface-elevated"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {menuFor === d.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                      <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border border-border bg-surface shadow-elegant overflow-hidden">
                        <div className="px-3 py-2 text-[10px] uppercase font-semibold tracking-wider text-muted-foreground border-b border-border">
                          Move to
                        </div>
                        <button
                          onClick={() => {
                            onMoveDoc(d.id, null);
                            setMenuFor(null);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-surface-elevated flex items-center gap-2"
                        >
                          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                          Uncategorised
                        </button>
                        {allFolders
                          .filter((f) => f.id !== d.folder_id)
                          .map((f) => (
                            <button
                              key={f.id}
                              onClick={() => {
                                onMoveDoc(d.id, f.id);
                                setMenuFor(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-elevated flex items-center gap-2"
                            >
                              <Folder className="h-3.5 w-3.5 text-primary" />
                              {f.name}
                            </button>
                          ))}
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            onDeleteDoc(d);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 border-t border-border flex items-center gap-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
