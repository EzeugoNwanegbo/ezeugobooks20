-- Semantic search for the chat + StudyBody library.
--
-- Adds an OpenAI text-embedding-3-small vector to every document chunk and a
-- hybrid search function that blends meaning-based similarity with the existing
-- keyword score. The old keyword-only search_document_chunks() is left intact so
-- nothing breaks during the rollout (and it remains the fallback when a query
-- embedding is unavailable).

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Approximate-nearest-neighbour index for cosine distance. HNSW gives good
-- recall without needing a pre-populated table (unlike ivfflat).
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
  ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- query_embedding is passed as text (a pgvector literal like "[0.1,0.2,...]")
-- so it survives the PostgREST RPC boundary cleanly; it is cast to vector once.
-- When it is NULL/empty the function degrades to pure keyword ranking, matching
-- the behaviour of the original search_document_chunks().
CREATE OR REPLACE FUNCTION public.search_document_chunks_hybrid(
  query_terms TEXT[],
  query_embedding TEXT DEFAULT NULL,
  match_document_ids UUID[] DEFAULT NULL,
  match_count INT DEFAULT 24
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  file_name TEXT,
  folder TEXT,
  chunk_index INT,
  page_start INT,
  page_end INT,
  content TEXT,
  rank INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH params AS (
    SELECT
      LEAST(GREATEST(match_count, 1), 60) AS lim,
      CASE
        WHEN query_embedding IS NULL OR length(trim(query_embedding)) = 0
          THEN NULL
        ELSE query_embedding::vector
      END AS emb
  ),
  normalized_terms AS (
    SELECT DISTINCT lower(trim(term)) AS term
    FROM unnest(COALESCE(query_terms, ARRAY[]::text[])) AS term
    WHERE length(trim(term)) > 2
  ),
  scoped_chunks AS (
    SELECT
      dc.id,
      dc.document_id,
      d.file_name,
      f.name AS folder,
      dc.chunk_index,
      dc.page_start,
      dc.page_end,
      dc.content,
      dc.embedding
    FROM public.document_chunks dc
    JOIN public.documents d ON d.id = dc.document_id
    LEFT JOIN public.folders f ON f.id = d.folder_id
    WHERE dc.user_id = auth.uid()
      AND (
        match_document_ids IS NULL
        OR array_length(match_document_ids, 1) IS NULL
        OR dc.document_id = ANY(match_document_ids)
      )
  ),
  scored AS (
    SELECT
      sc.id,
      sc.document_id,
      sc.file_name,
      sc.folder,
      sc.chunk_index,
      sc.page_start,
      sc.page_end,
      sc.content,
      -- keyword score: 0..(reasonably small); same weighting as the original RPC
      (
        SELECT COALESCE(SUM(
          CASE WHEN lower(sc.content) LIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
          + CASE
              WHEN lower(sc.file_name || ' ' || COALESCE(sc.folder, '')) LIKE '%' || nt.term || '%'
              THEN 2
              ELSE 0
            END
        ), 0)
        FROM normalized_terms nt
      ) AS kw,
      -- semantic similarity: 0..1 (1 = closest in meaning); NULL when no vector
      CASE
        WHEN (SELECT emb FROM params) IS NOT NULL AND sc.embedding IS NOT NULL
          THEN 1 - (sc.embedding <=> (SELECT emb FROM params))
        ELSE NULL
      END AS sim
    FROM scoped_chunks sc
  ),
  blended AS (
    SELECT
      scored.*,
      -- 70% meaning, 30% exact-keyword (keyword capped + normalised to ~0..1)
      (COALESCE(scored.sim, 0) * 0.7 + LEAST(scored.kw, 9) / 9.0 * 0.3) AS score
    FROM scored
  )
  SELECT
    blended.id,
    blended.document_id,
    blended.file_name,
    blended.folder,
    blended.chunk_index,
    blended.page_start,
    blended.page_end,
    blended.content,
    GREATEST(ROUND(blended.score * 100)::INT, 1) AS rank
  FROM blended
  WHERE blended.kw > 0
    OR blended.sim IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM normalized_terms)
  ORDER BY blended.score DESC, blended.chunk_index ASC
  LIMIT (SELECT lim FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.search_document_chunks_hybrid(TEXT[], TEXT, UUID[], INT) TO authenticated;
