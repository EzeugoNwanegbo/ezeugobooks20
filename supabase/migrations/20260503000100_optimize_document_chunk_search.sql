CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_document_chunks_content_trgm
  ON public.document_chunks USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_documents_file_name_trgm
  ON public.documents USING gin (file_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_folders_name_trgm
  ON public.folders USING gin (name gin_trgm_ops);

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
  WITH params AS (
    SELECT LEAST(GREATEST(match_count, 1), 40) AS lim
  ),
  normalized_terms AS (
    SELECT DISTINCT trim(term) AS term
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
      dc.content
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
  matching_terms AS (
    SELECT
      sc.id,
      sc.document_id,
      sc.file_name,
      sc.folder,
      sc.chunk_index,
      sc.page_start,
      sc.page_end,
      sc.content,
      CASE WHEN sc.content ILIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
      + CASE
          WHEN sc.file_name ILIKE '%' || nt.term || '%'
            OR COALESCE(sc.folder, '') ILIKE '%' || nt.term || '%'
          THEN 2
          ELSE 0
        END AS term_rank
    FROM scoped_chunks sc
    JOIN normalized_terms nt
      ON sc.content ILIKE '%' || nt.term || '%'
      OR sc.file_name ILIKE '%' || nt.term || '%'
      OR COALESCE(sc.folder, '') ILIKE '%' || nt.term || '%'
  ),
  scored AS (
    SELECT
      mt.id,
      mt.document_id,
      mt.file_name,
      mt.folder,
      mt.chunk_index,
      mt.page_start,
      mt.page_end,
      mt.content,
      SUM(mt.term_rank)::INT AS rank
    FROM matching_terms mt
    GROUP BY
      mt.id,
      mt.document_id,
      mt.file_name,
      mt.folder,
      mt.chunk_index,
      mt.page_start,
      mt.page_end,
      mt.content
  ),
  results AS (
    SELECT * FROM scored
    UNION ALL
    SELECT
      sc.id,
      sc.document_id,
      sc.file_name,
      sc.folder,
      sc.chunk_index,
      sc.page_start,
      sc.page_end,
      sc.content,
      0::INT AS rank
    FROM scoped_chunks sc
    WHERE NOT EXISTS (SELECT 1 FROM normalized_terms)
  )
  SELECT
    results.id,
    results.document_id,
    results.file_name,
    results.folder,
    results.chunk_index,
    results.page_start,
    results.page_end,
    results.content,
    results.rank
  FROM results
  ORDER BY results.rank DESC, results.chunk_index ASC
  LIMIT (SELECT lim FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.search_document_chunks(TEXT[], UUID[], INT) TO authenticated;
