// G&D — Last Minute ("Master Note") data layer.
//
// Unlike Links (which uploads fresh PDFs), Last Minute works over the study
// files already in the user's Library: pick up to LM_MAX_DOCS ready documents,
// send their ids to the `last-minute` edge function, and get back a single
// condensed "Master Note" (Markdown) that merges and de-duplicates them.

import { supabase, SUPABASE_URL_VALUE } from "./supabase";

const LAST_MINUTE_URL = `${SUPABASE_URL_VALUE}/functions/v1/last-minute`;
const TIMEOUT_MS = 130_000;

export const LM_MAX_DOCS = 10;
export const LM_MAX_PAGES = 100;

export type LibraryDoc = {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  page_count: number | null;
  extract_status: string | null;
  created_at: string;
};

export type FileKind = "pdf" | "pptx" | "docx" | "text" | "image";

export function fileKind(doc: LibraryDoc): FileKind | null {
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

export function kindLabel(kind: FileKind | null): string {
  if (kind === "pdf") return "PDF";
  if (kind === "pptx") return "PowerPoint";
  if (kind === "docx") return "Word";
  if (kind === "text") return "Text";
  if (kind === "image") return "Image";
  return "Unsupported";
}

export function countLabel(doc: LibraryDoc): string {
  const kind = fileKind(doc);
  if (!doc.page_count) return kind === "pptx" ? "Slides unknown" : "Length unknown";
  if (kind === "pptx") return `${doc.page_count} slides`;
  if (kind === "pdf") return `${doc.page_count} pages`;
  return `${doc.page_count} sections`;
}

// Returns a human reason the doc can't be used, or null if it's selectable.
export function disabledReason(doc: LibraryDoc): string | null {
  const kind = fileKind(doc);
  if (!kind) return "Use PDF, PowerPoint, Word, text, or image notes.";
  if ((kind === "pdf" || kind === "pptx") && (doc.page_count ?? 0) > LM_MAX_PAGES) {
    return `${kind === "pptx" ? "PowerPoint" : "PDF"} is over ${LM_MAX_PAGES} ${
      kind === "pptx" ? "slides" : "pages"
    }. Shorten it first.`;
  }
  if (doc.extract_status && doc.extract_status !== "ready") {
    return "Still processing. Try again when it is ready.";
  }
  return null;
}

// Strip Markdown emphasis the model sometimes over-uses so the Master Note reads
// as clean prose. Mirrors the web app's cleanAiText.
export function cleanAiText(text: string): string {
  return text
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(\d)\s*\*\s*(\d)/g, "$1 x $2")
    .replace(/([A-Za-z])\s*\*\s*([A-Za-z])/g, "$1 x $2")
    .replace(/\*/g, "");
}

// Load the user's Library documents (most recent first). RLS already scopes to
// the signed-in user; the explicit user_id filter mirrors the web app.
export async function listLibraryDocs(): Promise<LibraryDoc[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) throw new Error("Sign in again to load your Library.");

  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_type, file_size, page_count, extract_status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message ?? "Couldn't load your Library documents.");
  return (data as LibraryDoc[]) ?? [];
}

// Generate the condensed Master Note from the selected document ids.
export async function generateMasterNote(
  docIds: string[],
): Promise<{ title: string; note: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Sign in again before using Last Minute.");

    const response = await fetch(LAST_MINUTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({ docIds: docIds.slice(0, LM_MAX_DOCS) }),
    });

    if (!response.ok) {
      let message = "Last Minute could not generate your Master Note.";
      try {
        const json = await response.json();
        message = json.error ?? message;
      } catch {
        /* ignore — keep generic message */
      }
      throw new Error(message);
    }

    const body = (await response.json()) as { title?: string; note?: string; error?: string };
    if (body.error) throw new Error(body.error);
    return {
      title: body.title || "Last Minute Master Note",
      note: cleanAiText(body.note || ""),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Progress copy shown while the note generates (mirrors the web steps).
export const LM_PROGRESS_STEPS = [
  "Reading your study files",
  "Splitting content into study chunks",
  "Finding related topics",
  "Connecting concepts",
  "Removing repeated explanations",
  "Balancing overlapping information",
  "Building your Master Note",
] as const;
