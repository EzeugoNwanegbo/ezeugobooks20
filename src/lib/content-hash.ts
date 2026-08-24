// Content fingerprint for upload de-duplication.
//
// ── DETECTED, NOT HAND-FLIPPED ──────────────────────────────────────────────
// Everything below depends on schema applied by hand:
// documents.content_hash, documents.pooled_document_id, the pool_documents /
// pool_document_chunks tables, the find_pooled_document() and
// pool_share_document() functions and the document_chunks_effective view, all
// created by supabase/migrations/20260808120000_dedup_document_chunks_schema.sql
// and the staged files after it.
//
// The hazard that shaped this file has not changed: naming a column PostgREST
// cannot find makes it reject the WHOLE insert, which took uploads down in
// production once already. So nothing here may name that schema until it is
// known to exist.
//
// WHAT CHANGED IS HOW THAT IS KNOWN. This used to be `const
// DEDUP_SCHEMA_APPLIED = false`, flipped by hand in the same change that
// applied the migration. That is the failure mode described in
// detect-migrations-not-flags: the owner ran the SQL, nothing happened, and the
// share-with-G&D prompt - which is built, tested and wired up - stayed invisible
// because a constant in a source file still said the schema was not there.
// Reported as "there is no button to add my file to the general library".
//
// So the app ASKS instead. One cheap probe per session (see probe() below)
// answers whether documents.content_hash exists; a missing column latches
// `absent` and every caller behaves exactly as it did with the old flag off.
// Applying the migration therefore lights the feature up on the next page load,
// with no code change and no redeploy.
//
// TWO OTHER COPIES OF THE OLD FLAG still exist and are deliberately untouched:
//   supabase/functions/extract-pdf/index.ts   (edge function, deployed by hand)
//   supabase/functions/ocr-worker/index.ts    (edge function, deployed by hand)
//   gandd-mobile/lib/studybody-data.ts        (Capacitor app, ships separately)
// Those are server-side extraction and a separately shipped app; a false there
// costs storage, never correctness, and none of them can import this module.
//
// Several students upload the same textbook. Before this, each upload stored its
// own full copy of the extracted chunks - 51% of document_chunks was redundant
// copies, which is what pushed the database past the free-tier ceiling. Now a
// new upload is fingerprinted first: if the same content is already stored in
// the G&D pool, the documents row links to it (pooled_document_id) and no chunks
// are written.
//
// THE SHARED COPY BELONGS TO G&D, NOT TO ANOTHER STUDENT. pool_documents rows
// are owner-less - no user_id, no cascade from auth.users - so one student
// deleting their file, or their whole account, cannot empty the book for anyone
// else. That is the promise the share prompt makes ("this document is in our
// safe hands now - a delete won't affect us") and it is a property of the
// schema, not of the wording.
//
// WHAT IS HASHED, AND WHY IT IS THE EXTRACTED TEXT RATHER THAN THE FILE
// ---------------------------------------------------------------------
// We never store the uploaded file - only the text pulled out of it. So "is this
// the same file?" is both unanswerable and the wrong question; the one that
// matters is "does this produce the same text?". If it does, serving this
// student the existing chunks cannot change a single answer, citation or page
// number they would have seen from their own copy. It is also more forgiving in
// the right direction: a re-saved or re-compressed PDF has different bytes and
// identical text, and would still de-duplicate.
//
// MUST STAY BYTE-COMPATIBLE WITH public.document_chunkset_digest() AND
// public.pool_chunkset_digest() IN
// supabase/migrations/20260808120000_dedup_document_chunks_schema.sql.
// If the two ever disagree, no upload will ever match an existing book again -
// it fails silently and safely (worse storage, never wrong content), but it
// fails. The format is:
//
//   'chunkset-sha256-v1:' + sha256hex( lines.join('\n') )
//   line_i = `${chunk_index}|${page_start ?? ''}|${page_end ?? ''}|${sha256hex(content)}`
//   over all chunks ordered by chunk_index.
//
// chunk_index and the page numbers are inside the hash on purpose: two documents
// with the same prose but different chunk boundaries or page labels would
// produce different citations, so they must not be treated as the same content.
import { supabase } from "@/integrations/supabase/client";
import type { DocumentChunkInput } from "@/lib/document-chunks";

// ── Is the dedup schema there? ──────────────────────────────────────────────
//
// "unknown" until asked, and every caller treats it as absent until told
// otherwise - the safe direction, and the same behaviour the old constant gave.
let schemaState: "unknown" | "ready" | "absent" = "unknown";
/** One in-flight probe, shared by every caller that arrives while it runs. */
let inFlight: Promise<boolean> | null = null;

/**
 * PostgREST's answer to "select a column that is not there". 42703 is Postgres'
 * own undefined_column; PGRST204/PGRST200 are the schema-cache equivalents.
 * Anything else - a network failure, an auth error, a timeout - must NOT be read
 * as "the migration is missing", or one bad moment would switch de-duplication
 * off for the rest of the session.
 */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST200") return true;
  return (
    /content_hash/.test(error.message ?? "") &&
    /does not exist|column|schema cache/i.test(error.message ?? "")
  );
}

/**
 * Whether the dedup schema is known to exist. Synchronous, so the render path
 * and the insert builders can read it inline; false until a probe has said
 * otherwise, which is the direction that cannot break an upload.
 */
export function dedupSchemaReady(): boolean {
  return schemaState === "ready";
}

/**
 * Ask once, cache the answer for the session.
 *
 * The probe is a one-row select of documents.content_hash. It is cheap (RLS
 * already limits it to the caller's own rows, and LIMIT 1 caps it at one), it
 * needs no new function or grant, and it tests the exact thing every gated
 * caller depends on: whether PostgREST will accept that column name. An empty
 * result is a PASS - a student with no documents yet still proves the column
 * resolves.
 *
 * It does not separately verify find_pooled_document(), pool_share_document()
 * or document_chunks_effective. They come from the same migration file as the
 * column, so a database with one and not the others is a half-applied migration
 * rather than a state to design for - and both RPC callers already fail soft
 * (a share error is shown in the dialog with a retry; a lookup error falls
 * through to storing a full copy).
 *
 * Never throws. Never rejects.
 */
export function primeDedupSchema(): Promise<boolean> {
  if (schemaState !== "unknown") return Promise.resolve(schemaState === "ready");
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { error } = await supabase.from("documents").select("content_hash").limit(1);
      if (error) {
        if (isMissingColumn(error as { code?: string; message?: string })) schemaState = "absent";
        // Any other error leaves it "unknown" so the next caller retries.
        return false;
      }
      schemaState = "ready";
      return true;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export const CONTENT_HASH_PREFIX = "chunkset-sha256-v1:";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fingerprint a freshly chunked document. Returns null when the content is not
 * safe to de-duplicate on, mirroring the eligibility rules the SQL side applies:
 * an empty or near-empty extraction is exactly where a content hash stops
 * discriminating (two different scanned books can both extract to a single line
 * of scanner boilerplate), so those never match anything and always keep their
 * own copy.
 *
 * Returns null rather than throwing if Web Crypto is unavailable - a missing
 * fingerprint costs storage, never correctness.
 */
export async function chunkSetContentHash(chunks: DocumentChunkInput[]): Promise<string | null> {
  if (chunks.length === 0) return null;

  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  if (totalChars < 1000) return null;

  // Defensive: the SQL digest orders by chunk_index and requires 0..n-1 with no
  // gaps. chunkDocumentText() already produces that, but a mismatch here would
  // silently produce a hash the database can never reproduce.
  const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const contiguous = ordered.every((chunk, i) => chunk.chunk_index === i);
  if (!contiguous) return null;

  try {
    const lines = await Promise.all(
      ordered.map(async (chunk) => {
        const contentHash = await sha256Hex(chunk.content);
        const start = chunk.page_start ?? "";
        const end = chunk.page_end ?? "";
        return `${chunk.chunk_index}|${start}|${end}|${contentHash}`;
      }),
    );
    return `${CONTENT_HASH_PREFIX}${await sha256Hex(lines.join("\n"))}`;
  } catch (err) {
    console.warn("content hash unavailable", err);
    return null;
  }
}
