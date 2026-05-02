CREATE TABLE IF NOT EXISTS public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  page_start INT,
  page_end INT,
  content TEXT NOT NULL,
  token_estimate INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users insert own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users update own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users delete own document chunks" ON public.document_chunks;

CREATE POLICY "Users view own document chunks"
  ON public.document_chunks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own document chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own document chunks"
  ON public.document_chunks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own document chunks"
  ON public.document_chunks FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document
  ON public.document_chunks(document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_document_chunks_user
  ON public.document_chunks(user_id, document_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_document_chunks_content_trgm
  ON public.document_chunks USING gin (content gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_document_chunks(
  query_terms TEXT[],
  match_document_ids UUID[] DEFAULT NULL,
  match_count INT DEFAULT 12
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
SET search_path = public
AS $$
  WITH normalized_terms AS (
    SELECT DISTINCT lower(trim(term)) AS term
    FROM unnest(COALESCE(query_terms, ARRAY[]::text[])) AS term
    WHERE length(trim(term)) > 2
  ),
  scored AS (
    SELECT
      dc.id,
      dc.document_id,
      d.file_name,
      f.name AS folder,
      dc.chunk_index,
      dc.page_start,
      dc.page_end,
      dc.content,
      COALESCE(
        SUM(
          CASE WHEN lower(dc.content) LIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
          + CASE
              WHEN lower(d.file_name || ' ' || COALESCE(f.name, '')) LIKE '%' || nt.term || '%'
              THEN 2
              ELSE 0
            END
        ),
        0
      )::INT AS rank
    FROM public.document_chunks dc
    JOIN public.documents d ON d.id = dc.document_id
    LEFT JOIN public.folders f ON f.id = d.folder_id
    LEFT JOIN normalized_terms nt ON TRUE
    WHERE dc.user_id = auth.uid()
      AND (
        match_document_ids IS NULL
        OR array_length(match_document_ids, 1) IS NULL
        OR dc.document_id = ANY(match_document_ids)
      )
    GROUP BY dc.id, dc.document_id, d.file_name, f.name, dc.chunk_index, dc.page_start, dc.page_end, dc.content
  )
  SELECT
    scored.id,
    scored.document_id,
    scored.file_name,
    scored.folder,
    scored.chunk_index,
    scored.page_start,
    scored.page_end,
    scored.content,
    scored.rank
  FROM scored
  WHERE scored.rank > 0 OR NOT EXISTS (SELECT 1 FROM normalized_terms)
  ORDER BY scored.rank DESC, scored.chunk_index ASC
  LIMIT LEAST(GREATEST(match_count, 1), 40);
$$;

GRANT EXECUTE ON FUNCTION public.search_document_chunks(TEXT[], UUID[], INT) TO authenticated;

INSERT INTO public.document_chunks (
  document_id,
  user_id,
  chunk_index,
  content,
  token_estimate
)
SELECT
  d.id,
  d.user_id,
  gs.n,
  substring(d.extracted_text FROM (gs.n * 6000) + 1 FOR 6000),
  CEIL(length(substring(d.extracted_text FROM (gs.n * 6000) + 1 FOR 6000)) / 4.0)::INT
FROM public.documents d
CROSS JOIN LATERAL generate_series(
  0,
  GREATEST(CEIL(length(d.extracted_text) / 6000.0)::INT - 1, 0)
) AS gs(n)
WHERE d.extracted_text IS NOT NULL
  AND length(d.extracted_text) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.document_chunks dc
    WHERE dc.document_id = d.id
  );
