// Content fingerprint for upload de-duplication.
//
// Several students upload the same textbook. Before this, each upload stored its
// own full copy of the extracted chunks - 51% of document_chunks was redundant
// copies, which is what pushed the database past the free-tier ceiling. Now a
// new upload is fingerprinted first: if the same content is already stored, the
// documents row links to it (canonical_document_id) and no chunks are written.
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
// MUST STAY BYTE-COMPATIBLE WITH dedup.chunkset_digest() IN
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
import type { DocumentChunkInput } from "@/lib/document-chunks";

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
