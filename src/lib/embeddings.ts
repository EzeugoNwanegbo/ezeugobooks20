// Client helpers for semantic search. Everything here fails soft: if embedding
// is unavailable the callers fall back to keyword-only search, so a flaky
// network or provider hiccup degrades quality but never blocks the answer.
import { supabase } from "@/integrations/supabase/client";

// A pgvector literal string, e.g. "[0.1,0.2,...]". We keep embeddings in this
// form end to end so they pass through PostgREST without serialisation quirks.
export type VectorLiteral = string;

const INDEX_BATCH_SIZE = 96;
const BACKFILL_PAGE_SIZE = 96;

/**
 * Embed one or more texts. Returns pgvector literal strings aligned to the
 * input order, or null if the embedding service is unavailable.
 */
export async function embedTexts(texts: string[]): Promise<VectorLiteral[] | null> {
  if (texts.length === 0) return [];
  try {
    const { data, error } = await supabase.functions.invoke("embed", {
      body: { texts },
    });
    if (error) {
      console.warn("embed function error", error);
      return null;
    }
    const embeddings = (data as { embeddings?: unknown } | null)?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      console.warn("embed function returned unexpected shape");
      return null;
    }
    return embeddings as VectorLiteral[];
  } catch (err) {
    console.warn("embed function unavailable", err);
    return null;
  }
}

/** Embed a single query string. Returns null on failure. */
export async function embedQuery(query: string): Promise<VectorLiteral | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const result = await embedTexts([trimmed]);
  return result?.[0] ?? null;
}

/**
 * Embed the given chunk contents and return rows ready to merge into a
 * document_chunks insert. If embedding fails the chunks are returned without an
 * embedding (they stay keyword-searchable and can be backfilled later).
 */
export async function embedChunkContents(
  contents: string[],
): Promise<(VectorLiteral | null)[]> {
  const vectors: (VectorLiteral | null)[] = new Array(contents.length).fill(null);
  for (let i = 0; i < contents.length; i += INDEX_BATCH_SIZE) {
    const slice = contents.slice(i, i + INDEX_BATCH_SIZE);
    const embedded = await embedTexts(slice);
    if (!embedded) continue; // leave this batch null; backfill will catch it
    embedded.forEach((vector, offset) => {
      vectors[i + offset] = vector;
    });
  }
  return vectors;
}

/**
 * One-time (idempotent) backfill: embed any of this user's chunks that are
 * missing a vector. Runs quietly in the background, one page at a time, and
 * stops on the first failure so it never spins. Safe to call on every load —
 * it no-ops once everything is embedded.
 */
export async function backfillMissingEmbeddings(
  userId: string,
  options: { maxChunks?: number; signal?: AbortSignal } = {},
): Promise<{ embedded: number; done: boolean }> {
  const maxChunks = options.maxChunks ?? 2000;
  let embedded = 0;

  while (embedded < maxChunks) {
    if (options.signal?.aborted) return { embedded, done: false };

    const { data, error } = await supabase
      .from("document_chunks")
      .select("id, content")
      .eq("user_id", userId)
      .is("embedding", null)
      .limit(BACKFILL_PAGE_SIZE);

    if (error) {
      console.warn("backfill: chunk fetch failed", error);
      return { embedded, done: false };
    }
    const rows = (data as { id: string; content: string }[] | null) ?? [];
    if (rows.length === 0) return { embedded, done: true };

    const vectors = await embedTexts(rows.map((row) => row.content));
    if (!vectors) return { embedded, done: false };

    // Update each row with its vector. Done sequentially to keep it gentle.
    for (let i = 0; i < rows.length; i += 1) {
      if (options.signal?.aborted) return { embedded, done: false };
      const { error: updateError } = await supabase
        .from("document_chunks")
        .update({ embedding: vectors[i] })
        .eq("id", rows[i].id);
      if (updateError) {
        console.warn("backfill: chunk update failed", updateError);
        return { embedded, done: false };
      }
      embedded += 1;
    }

    // Fewer rows than a full page means we've drained the backlog.
    if (rows.length < BACKFILL_PAGE_SIZE) return { embedded, done: true };
  }

  return { embedded, done: false };
}
