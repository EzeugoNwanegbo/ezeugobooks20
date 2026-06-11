// Client helpers for semantic search (mobile). Everything here fails soft: if
// embedding is unavailable the callers fall back to keyword-only search, so a
// flaky network or provider hiccup degrades quality but never blocks the answer.
import { supabase } from "./supabase";

// A pgvector literal string, e.g. "[0.1,0.2,...]". We keep embeddings in this
// form end to end so they pass through PostgREST without serialisation quirks.
export type VectorLiteral = string;

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
