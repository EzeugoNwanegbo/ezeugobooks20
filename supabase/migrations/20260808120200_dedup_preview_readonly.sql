-- Chunk de-duplication, stage 3 of 5: PREVIEW. READ ONLY. CHANGES NOTHING.
--
-- Every statement in this file is a SELECT. It exists so the exact work stage 4
-- will perform can be inspected, and both the space it frees AND the space it
-- temporarily consumes measured, before a single row is written.
--
-- Paste these into the Supabase SQL editor one block at a time. Pushing the file
-- through the CLI is harmless but pointless - the CLI discards result sets, and
-- the numbers are the whole point.
--
-- Depends on stage 1 (the dedup views) and stage 2 (content_hash populated). If
-- stage 2 has not finished, dedup.plan will under-report: an unhashed document
-- is ineligible by definition and simply will not appear.
--
-- WHAT CHANGED WITH THE POOL DESIGN
-- ---------------------------------
-- Under the superseded design one student's copy was elected "canonical", kept
-- its chunks, and everybody else pointed at it. The vocabulary here has changed
-- accordingly and the numbers with it:
--
--   * There is no canonical. The elected copy is a DONOR: its chunks are copied
--     into the G&D pool, and then it becomes a link like everyone else and gives
--     up its private copy too. Every document in a group ends up pooled; nobody
--     is left holding the group's only copy.
--   * So stage 5 deletes MORE rows than the old design did - the donors' rows as
--     well - while freeing the same net space, because the donated copy is
--     re-created once in pool_document_chunks. Section A separates the two.
--   * Pooling is a copy-then-delete, not an UPDATE, so the database GROWS before
--     it shrinks. Section G measures that transient cost exactly. It is the one
--     genuine cost of the pool design and it is why stage 4 works one book at a
--     time.
--
-- ROLLBACK: nothing to roll back. This file writes nothing.


-- ─── A. Headline: what stages 4 and 5 will do ─────────────────────────────────
-- Expect roughly: ~105 redundant documents, ~30,400 redundant chunk rows,
-- ~130 MB net. If the content hash disagrees with the (file_name, file_size)
-- heuristic these numbers come out LOWER - that is the safety margin working,
-- not a fault.
--
-- Read the three row-count columns together:
--   chunk_rows_deleted    every member's private copy, donors included (stage 5)
--   chunk_rows_added_to_pool  one copy per group, written by stage 4
--   chunk_rows_net_freed  the difference - the actual saving
SELECT
  count(*)                                                     AS documents_to_pool,
  count(*) FILTER (WHERE is_donor)                             AS groups,
  count(*) FILTER (WHERE NOT is_donor)                         AS redundant_copies,
  COALESCE(sum(chunk_count), 0)                                AS chunk_rows_deleted,
  COALESCE(sum(chunk_count) FILTER (WHERE is_donor), 0)        AS chunk_rows_added_to_pool,
  COALESCE(sum(chunk_count) FILTER (WHERE NOT is_donor), 0)    AS chunk_rows_net_freed,
  pg_size_pretty(COALESCE(sum(bytes) FILTER (WHERE NOT is_donor), 0))
                                                               AS heap_bytes_net_freed_estimate
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
  (SELECT count(*) FROM heuristic)                          AS name_size_heuristic_says,
  (SELECT count(*) FROM dedup.plan WHERE NOT is_donor)      AS content_hash_says,
  (SELECT count(*) FROM heuristic)
    - (SELECT count(*) FROM dedup.plan WHERE NOT is_donor)  AS rejected_by_safety_checks;

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


-- ─── C. The plan, document by document ────────────────────────────────────────
-- `SEED POOL` is the copy whose chunks are written into pool_document_chunks.
-- Every row - including the seed - then becomes `link` and loses its private
-- copy in stage 5. Check that the SEED row has the highest `embedded` in its
-- group (the donor-selection rule) and that page/chunk counts line up.
SELECT
  p.file_name,
  p.file_size,
  p.page_count,
  p.chunk_count,
  p.embedded_count             AS embedded,
  CASE WHEN p.is_donor THEN 'SEED POOL' ELSE 'link -> seed ' || left(p.donor_id::text, 8) END AS action,
  p.group_size,
  left(p.document_id::text, 8) AS doc,
  left(p.user_id::text, 8)     AS owner,
  pg_size_pretty(p.bytes)      AS heap_bytes,
  right(p.digest, 12)          AS hash_tail
FROM dedup.plan p
ORDER BY p.file_name, p.file_size, p.is_donor DESC, p.embedded_count DESC;


-- ─── D. The embedding trap ────────────────────────────────────────────────────
-- 36,695 of 59,933 chunks have no embedding. Whatever the donor holds is what
-- the pool keeps FOREVER: a pooled chunk has no user_id, so the client-side
-- backfill (src/lib/embeddings.ts, which selects the caller's own rows) can
-- never reach it. Donating an unembedded copy would demote every student in that
-- group to keyword-only search permanently. The donor rule (most embedded wins)
-- exists to prevent that; this query proves it worked.
SELECT
  p.file_name,
  max(p.embedded_count) FILTER (WHERE p.is_donor) AS donor_embedded,
  max(p.embedded_count)                           AS best_embedded_available,
  max(p.chunk_count)                              AS chunk_count
FROM dedup.plan p
GROUP BY p.digest, p.chunk_count, p.file_name, p.file_size, p.page_count
HAVING max(p.embedded_count) FILTER (WHERE p.is_donor) < max(p.embedded_count);
-- Zero rows = no group loses embeddings. Any row here is a bug; stop.

-- Groups where NOBODY has embeddings. These still save space, but semantic
-- search stays off for them permanently unless a service-role backfill fills in
-- pool_document_chunks.embedding directly - the client backfill cannot, for the
-- reason above. Worth knowing before, not after.
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
-- 5 these students read through the pool. Donors are included - they give up
-- their copy too - which is the difference from the superseded design, where the
-- elected student kept theirs.
--
-- Pick one or two from this list to spot-check in the live app between stage 4
-- and stage 5.
SELECT
  left(p.user_id::text, 8)                            AS student,
  count(*)                                            AS files_becoming_links,
  count(*) FILTER (WHERE p.is_donor)                  AS of_which_donated,
  sum(p.chunk_count)                                  AS own_chunk_rows_removed,
  pg_size_pretty(sum(p.bytes))                        AS heap_bytes_removed
FROM dedup.plan p
GROUP BY p.user_id
ORDER BY sum(p.bytes) DESC;

-- Cross-student groups: the ones where pooling actually shares something between
-- accounts. A group inside a single student's account is pure de-duplication of
-- their own re-uploads.
--
-- Note what this is NOT any more. Under the superseded design this number
-- mattered for SECURITY, because a cross-student merge activated a new RLS
-- branch letting one student read another's chunk rows. Pooled content belongs
-- to nobody, document_chunks' SELECT policy is untouched at `auth.uid() =
-- user_id`, and there is no cross-user read branch to exercise. This is now
-- purely informational.
SELECT
  count(*) FILTER (WHERE students > 1) AS cross_student_groups,
  count(*) FILTER (WHERE students = 1) AS single_student_groups
FROM (
  SELECT count(DISTINCT p.user_id) AS students
  FROM dedup.plan p
  GROUP BY p.digest, p.chunk_count, p.file_name, p.file_size, p.page_count
) g;


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


-- ─── G. THE TRANSIENT COST, MEASURED BEFORE IT IS PAID ────────────────────────
--
-- The one honest cost of a separate pool table. Moving a chunk set into the pool
-- is INSERT ... SELECT then DELETE, so the donated copy exists TWICE - once
-- under the student, once in the pool - between stage 4 and stage 5. On a 500 MB
-- instance sitting at ~636 MB of total relation size, "it gets bigger first" is
-- not a footnote; it is the thing that could fail.
--
-- Three numbers, and what to do with each:
--
--   pool_copy_total  what stage 4 writes in total. If stage 5 ran immediately
--                    afterwards, the peak would be this much extra at once.
--   peak_one_book    what stage 4 actually needs at any moment, because it pools
--                    ONE book per iteration. This is the number that has to fit.
--   headroom_needed  peak_one_book plus its share of index growth, roughly
--                    doubled - HNSW and GIN entries are written for the new pool
--                    rows too, and they are not small.
--
-- If peak_one_book is uncomfortable, the answer is to run stage 4 and stage 5
-- alternately over subsets rather than all of stage 4 then all of stage 5. Both
-- files are safe to run repeatedly and pick up where they stopped, so that is a
-- matter of scoping the WHERE clause, not of rewriting anything.
SELECT
  pg_size_pretty(COALESCE(sum(p.bytes) FILTER (WHERE p.is_donor), 0))  AS pool_copy_total,
  pg_size_pretty(COALESCE(max(p.bytes) FILTER (WHERE p.is_donor), 0))  AS peak_one_book,
  pg_size_pretty(COALESCE(max(p.bytes) FILTER (WHERE p.is_donor), 0) * 2)
                                                                       AS headroom_needed_rough,
  pg_size_pretty(COALESCE(sum(p.bytes) FILTER (WHERE NOT p.is_donor), 0))
                                                                       AS eventual_net_saving
FROM dedup.plan p;

-- The same thing as a single before/after sanity line: what the database weighs
-- now, the worst moment during stage 4, and where it lands after stage 5 and the
-- VACUUM FULL. These are estimates from heap column widths - treat them as
-- direction and magnitude, not as a promise.
WITH d AS (
  SELECT
    pg_database_size(current_database())::bigint                       AS now_bytes,
    (SELECT COALESCE(max(bytes) FILTER (WHERE is_donor), 0) FROM dedup.plan)     AS peak_add,
    (SELECT COALESCE(sum(bytes) FILTER (WHERE NOT is_donor), 0) FROM dedup.plan) AS net_free
)
SELECT
  pg_size_pretty(now_bytes)                        AS today,
  pg_size_pretty(now_bytes + peak_add)             AS worst_moment_during_stage_4,
  pg_size_pretty(now_bytes - net_free)             AS after_stage_5_and_vacuum
FROM d;


-- ─── H. Secondary opportunity, NOT addressed by this migration ────────────────
-- Measure it so the decision is informed. documents.extracted_text holds the
-- book's text a SECOND time (the browser upload path stores only a truncated
-- preview, but extract-pdf and ocr-worker store the full text). De-duplicating
-- that as well would add to the saving, but it needs the chat page
-- (src/routes/-app.chat-page.tsx, which reads documents.extracted_text
-- directly) to resolve through the pool first - otherwise clearing the column
-- would blank a pooled student's chat context. Pooling deliberately does not
-- touch extracted_text today, which is why that page needs no change at all.
WITH sized AS (
  SELECT
    COALESCE(pg_column_size(d.extracted_text), 0)::bigint AS bytes,
    (p.document_id IS NOT NULL AND NOT p.is_donor)        AS is_redundant_copy
  FROM public.documents d
  LEFT JOIN dedup.plan p ON p.document_id = d.id
)
SELECT
  pg_size_pretty(sum(bytes)) AS extracted_text_total,
  pg_size_pretty(COALESCE(sum(bytes) FILTER (WHERE is_redundant_copy), 0))
                             AS extracted_text_on_redundant_copies
FROM sized;
