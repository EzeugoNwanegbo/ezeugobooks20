-- Chunk de-duplication, stage 3 of 5: PREVIEW. READ ONLY. CHANGES NOTHING.
--
-- Every statement in this file is a SELECT. It exists so the exact merge stage 4
-- will perform can be inspected, and the space it frees measured, before a
-- single row is written.
--
-- Paste these into the Supabase SQL editor one block at a time. Pushing the file
-- through the CLI is harmless but pointless - the CLI discards result sets, and
-- the numbers are the whole point.
--
-- Depends on stage 1 (the dedup views) and stage 2 (content_hash populated). If
-- stage 2 has not finished, dedup.plan will under-report: an unhashed document
-- is ineligible by definition and simply will not appear.
--
-- ROLLBACK: nothing to roll back. This file writes nothing.


-- ─── A. Headline: what stages 4 and 5 will do ─────────────────────────────────
-- Expect roughly: ~105 redundant documents, ~30,400 chunk rows, ~130 MB.
-- If the content hash disagrees with the (file_name, file_size) heuristic these
-- numbers come out LOWER - that is the safety margin working, not a fault.
SELECT
  count(*) FILTER (WHERE NOT is_canonical)                      AS documents_to_link,
  count(DISTINCT canonical_id)                                  AS groups,
  count(*) FILTER (WHERE is_canonical)                          AS canonical_copies_kept,
  COALESCE(sum(chunk_count) FILTER (WHERE NOT is_canonical), 0) AS chunk_rows_to_delete,
  pg_size_pretty(COALESCE(sum(bytes) FILTER (WHERE NOT is_canonical), 0))
                                                                AS heap_bytes_freed_estimate
FROM dedup.plan;


-- ─── B. The heuristic vs the proof ────────────────────────────────────────────
-- Column 1 counts what a naive "same file_name and file_size" merge would have
-- taken - the original plan for this migration. Column 2 counts what the content
-- hash actually authorises. The gap is the set of same-name, same-size documents
-- whose extracted TEXT is not identical: precisely the books a careless
-- migration would have corrupted.
WITH heuristic AS (
  SELECT s.id
  FROM dedup.doc_stats s
  WHERE s.chunk_count > 0
    AND EXISTS (
      SELECT 1 FROM dedup.doc_stats o
      WHERE o.id <> s.id
        AND o.file_name = s.file_name
        AND o.file_size IS NOT DISTINCT FROM s.file_size
        AND o.chunk_count > 0
        AND (o.created_at, o.id) < (s.created_at, s.id)   -- "not the earliest"
    )
)
SELECT
  (SELECT count(*) FROM heuristic)                             AS name_size_heuristic_says,
  (SELECT count(*) FROM dedup.plan WHERE NOT is_canonical)     AS content_hash_says,
  (SELECT count(*) FROM heuristic)
    - (SELECT count(*) FROM dedup.plan WHERE NOT is_canonical) AS rejected_by_safety_checks;

-- The rejects, itemised. Every row shares a name and byte size with another
-- upload but is not provably the same text. Do not merge these by hand.
SELECT
  s.file_name,
  s.file_size,
  count(*)                            AS copies,
  count(DISTINCT s.content_hash)      AS distinct_content_hashes,
  count(DISTINCT s.page_count)        AS distinct_page_counts,
  count(DISTINCT s.chunk_count)       AS distinct_chunk_counts,
  bool_or(NOT s.index_is_contiguous)  AS any_with_index_gaps,
  min(s.text_chars)                   AS min_chars
FROM dedup.doc_stats s
WHERE s.chunk_count > 0
GROUP BY s.file_name, s.file_size
HAVING count(*) > 1
   AND count(DISTINCT s.content_hash) IS DISTINCT FROM 1
ORDER BY copies DESC, s.file_name;


-- ─── C. The merge, document by document ───────────────────────────────────────
-- The full plan. `KEEP` is the copy whose chunks survive; the rest become links
-- to it. Check that the KEEP row has the highest `embedded` in its group (the
-- canonical-selection rule) and that page/chunk counts line up.
SELECT
  p.file_name,
  p.file_size,
  p.page_count,
  p.chunk_count,
  p.embedded_count             AS embedded,
  CASE WHEN p.is_canonical THEN 'KEEP' ELSE 'link -> ' || left(p.canonical_id::text, 8) END AS action,
  left(p.document_id::text, 8) AS doc,
  left(p.user_id::text, 8)     AS owner,
  pg_size_pretty(p.bytes)      AS heap_bytes,
  right(p.digest, 12)          AS hash_tail
FROM dedup.plan p
ORDER BY p.file_name, p.file_size, p.is_canonical DESC, p.embedded_count DESC;


-- ─── D. The embedding trap ────────────────────────────────────────────────────
-- 36,695 of 59,933 chunks have no embedding. If a group's kept copy is one of
-- the unembedded ones, merging would demote every student in that group to
-- keyword-only search. The canonical rule (most embedded wins) exists to prevent
-- that; this query proves it worked.
SELECT
  p.file_name,
  max(p.embedded_count) FILTER (WHERE p.is_canonical) AS kept_embedded,
  max(p.embedded_count)                               AS best_embedded_available,
  max(p.chunk_count)                                  AS chunk_count
FROM dedup.plan p
GROUP BY p.digest, p.chunk_count, p.file_name, p.file_size, p.page_count
HAVING max(p.embedded_count) FILTER (WHERE p.is_canonical) < max(p.embedded_count);
-- Zero rows = no group loses embeddings. Any row here is a bug; stop.

-- Groups where NOBODY has embeddings. These still save space, but semantic
-- search stays off for them until the canonical owner's client backfills
-- (src/lib/embeddings.ts) or the service-role backfill noted in stage 4 runs.
SELECT
  p.file_name,
  max(p.chunk_count) AS chunk_count,
  count(*)           AS copies
FROM dedup.plan p
GROUP BY p.digest, p.chunk_count, p.file_name, p.file_size, p.page_count
HAVING max(p.embedded_count) = 0
ORDER BY max(p.chunk_count) DESC;


-- ─── E. Who is affected ───────────────────────────────────────────────────────
-- Per-student: how many of their files stop owning their own chunks. After stage
-- 5 these students read through the link. Pick one or two from this list to
-- spot-check in the live app between stage 4 and stage 5.
SELECT
  left(p.user_id::text, 8)     AS student,
  count(*)                     AS files_becoming_links,
  sum(p.chunk_count)           AS chunk_rows_freed,
  pg_size_pretty(sum(p.bytes)) AS heap_bytes_freed
FROM dedup.plan p
WHERE NOT p.is_canonical
GROUP BY p.user_id
ORDER BY sum(p.bytes) DESC;

-- Cross-student merges specifically: these are the ones where the new RLS branch
-- (read the chunks of the document you link to) actually does any work. A merge
-- within a single student's own account needs no sharing at all.
SELECT
  count(*) FILTER (WHERE p.user_id <> c.user_id) AS cross_student_links,
  count(*) FILTER (WHERE p.user_id =  c.user_id) AS same_student_links
FROM dedup.plan p
JOIN public.documents c ON c.id = p.canonical_id
WHERE NOT p.is_canonical;


-- ─── F. Context: where the 636 MB actually is ─────────────────────────────────
-- Run before and after, so the reclaim is measured rather than assumed. The
-- freed space only returns to the filesystem after the VACUUM FULL in stage 5.
SELECT
  relname                                                 AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid))           AS total,
  pg_size_pretty(pg_relation_size(c.oid))                 AS heap,
  pg_size_pretty(pg_indexes_size(c.oid))                  AS indexes,
  pg_size_pretty(pg_total_relation_size(c.reltoastrelid)) AS toast
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 12;

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

-- Secondary opportunity, NOT addressed by this migration - measure it so the
-- decision is informed. documents.extracted_text holds the book's text a SECOND
-- time (the browser upload path stores only a truncated preview, but extract-pdf
-- and ocr-worker store the full text). De-duplicating that as well would add to
-- the saving, but it needs the chat page (src/routes/-app.chat-page.tsx, which
-- reads documents directly) to resolve through the canonical link first -
-- otherwise clearing the column would blank a linked student's chat context.
WITH sized AS (
  SELECT
    COALESCE(pg_column_size(d.extracted_text), 0)::bigint AS bytes,
    (p.document_id IS NOT NULL AND NOT p.is_canonical)    AS is_redundant_copy
  FROM public.documents d
  LEFT JOIN dedup.plan p ON p.document_id = d.id
)
SELECT
  pg_size_pretty(sum(bytes)) AS extracted_text_total,
  pg_size_pretty(COALESCE(sum(bytes) FILTER (WHERE is_redundant_copy), 0))
                             AS extracted_text_on_redundant_copies
FROM sized;
