// G&D — Links ("connect the dots") data layer.
//
// Uploads focused PDFs to the private `documents` bucket, triggers server-side
// extraction (extract-pdf), and asks DeepSeek to synthesise the connections
// across the user's library (connect-dots). The web app parses PDFs in the
// browser; on native everything heavy happens server-side, so this file is just
// pick -> upload -> kick off extraction -> read status -> synthesise.

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { supabase, SUPABASE_URL_VALUE } from "./supabase";

export const LINK_MAX_DOCS = 10;
export const LINK_MAX_FILE_BYTES = 30 * 1024 * 1024; // 30 MB
export const LINK_MAX_PAGES = 100;
// The main Document Library is unrestricted in count. The per-file cap is 50 MB:
// unlike the website (which parses PDFs in-browser and stores text only), the
// native app uploads the raw PDF to Supabase Storage — whose default object
// limit is 50 MB — and then extracts server-side, where huge files would time
// out / OOM anyway. So we reject early with a clear message instead. Bigger
// files belong on the web for now. (The LINK_* caps are tighter still and
// specific to the Links / "connect the dots" feature.)
export const LIBRARY_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

const EXTRACT_URL = `${SUPABASE_URL_VALUE}/functions/v1/extract-pdf`;
const CONNECT_URL = `${SUPABASE_URL_VALUE}/functions/v1/connect-dots`;
const SYNTHESIS_TIMEOUT_MS = 120_000;

// 'pending'    - uploaded, extraction not started (this client sets it below).
// 'processing' - server is mid-book: extract-pdf while it writes chunks, or the
//                OCR queue between ocr-enqueue and the last ocr-worker job.
// 'ready'      - text AND the full chunk set are stored; the only groundable state.
// 'rejected'   - over the page limit.
// 'error'      - failed; extract_error carries a message worth showing.
export type ExtractStatus = "pending" | "processing" | "ready" | "rejected" | "error";

export type LinkDocument = {
  id: string;
  file_name: string;
  file_size: number | null;
  page_count: number | null;
  extract_status: ExtractStatus | null;
  extract_error: string | null;
  created_at: string;
};

export type SynthesisCluster = {
  title: string;
  match?: number;
  description?: string;
  docs?: string[];
};

export type SynthesisResult = {
  coreTheme?: string;
  nodes?: { label: string; docs?: string[] }[];
  interlinkCount?: number;
  clusters?: SynthesisCluster[];
  strongestLink?: { title: string; description?: string };
  themeOrigin?: { title: string; source?: string };
  surprise?: { title: string; description?: string };
};

export type SynthesisResponse = {
  result: SynthesisResult;
  documents: Record<string, string>;
  cached: boolean;
};

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  return token;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Please sign in again.");
  return id;
}

/** All of the user's uploaded documents, newest first. */
export async function listDocuments(): Promise<LinkDocument[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_size, page_count, extract_status, extract_error, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LinkDocument[];
}

/** Opens the system picker for one or more PDFs (caller enforces the count cap). */
export async function pickPdfs(): Promise<DocumentPicker.DocumentPickerAsset[]> {
  const res = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (res.canceled) return [];
  return res.assets ?? [];
}

export type UploadOutcome = {
  ok: boolean;
  documentId?: string;
  status?: ExtractStatus;
  error?: string;
  // Set when the file was rejected purely for exceeding the size cap, so the UI
  // can offer a shortcut to the web app where large PDFs upload fine.
  oversize?: boolean;
};

/**
 * Uploads one picked PDF, records it, and runs server-side extraction. Returns
 * the final extract status so the UI can show Ready / Rejected / Error per file.
 */
export async function uploadAndExtract(
  asset: DocumentPicker.DocumentPickerAsset,
  opts: { maxBytes?: number } = {},
): Promise<UploadOutcome> {
  // Per-call size cap: Links passes the focused 30 MB cap, the Library the larger
  // LIBRARY_MAX_FILE_BYTES. (The server re-checks pages after extraction.)
  const maxBytes = opts.maxBytes ?? LINK_MAX_FILE_BYTES;
  if (asset.mimeType && asset.mimeType !== "application/pdf") {
    return { ok: false, error: `${asset.name} isn't a PDF.` };
  }
  if (typeof asset.size === "number" && asset.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      oversize: true,
      error: `${asset.name} is over ${mb} MB. Large PDFs are best uploaded on the web at gd1.online — or split the file into smaller parts.`,
    };
  }

  const userId = await currentUserId();
  const token = await authToken();

  // Read the file bytes (new expo-file-system File API) and upload to storage.
  let bytes: Uint8Array;
  try {
    bytes = await new File(asset.uri).bytes();
  } catch {
    return { ok: false, error: `Could not read ${asset.name}.` };
  }

  const safeName = asset.name?.replace(/[^\w.\-]+/g, "_") || "document.pdf";
  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { data: inserted, error: insErr } = await supabase
    .from("documents")
    .insert({
      // documents.user_id is NOT NULL and gated by an RLS insert policy
      // (auth.uid() = user_id) — omitting it rejects the row ("Could not save").
      user_id: userId,
      file_name: asset.name ?? safeName,
      storage_path: storagePath,
      file_type: "application/pdf",
      file_size: asset.size ?? bytes.byteLength,
      extract_status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    // Clean up the orphaned upload so storage doesn't drift from the table.
    await supabase.storage.from("documents").remove([storagePath]);
    return { ok: false, error: `Could not save ${asset.name}.` };
  }

  // Server-side extract + chunk + embed (also enforces the page-count guard).
  try {
    const resp = await fetch(EXTRACT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documentId: inserted.id }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || body.error) {
      return {
        ok: body.status === "rejected",
        documentId: inserted.id,
        status: (body.status as ExtractStatus) ?? "error",
        error: body.error,
      };
    }
    return { ok: true, documentId: inserted.id, status: body.status as ExtractStatus };
  } catch (e) {
    return {
      ok: false,
      documentId: inserted.id,
      status: "error",
      error: e instanceof Error ? e.message : "Extraction failed.",
    };
  }
}

/** Removes a document (storage object + row; chunks cascade). */
export async function deleteDocument(id: string): Promise<void> {
  const { data } = await supabase.from("documents").select("storage_path").eq("id", id).single();
  if (data?.storage_path) {
    await supabase.storage.from("documents").remove([data.storage_path]);
  }
  await supabase.from("documents").delete().eq("id", id);
}

/** Runs (or returns the cached) DeepSeek synthesis across the given documents. */
export async function synthesize(docIds: string[], force = false): Promise<SynthesisResponse> {
  const token = await authToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS);
  try {
    const resp = await fetch(CONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({ docIds, force }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || body.error) {
      throw new Error(body.error ?? "Synthesis failed. Please try again.");
    }
    return {
      result: (body.result ?? {}) as SynthesisResult,
      documents: (body.documents ?? {}) as Record<string, string>,
      cached: Boolean(body.cached),
    };
  } finally {
    clearTimeout(timeout);
  }
}
