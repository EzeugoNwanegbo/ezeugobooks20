-- Chunk de-duplication, stage 5 of 5: DESTRUCTIVE. Empties the pooled documents.
--
-- ============================================================================
-- THIS FILE IS INERT UNTIL YOU EXPLICITLY ARM IT.
--
--   Running it as-is does nothing and prints a notice. To actually delete, run
--   this first, in the SAME session:
--
--       SET dedup.confirm_delete = 'DELETE-REDUNDANT-CHUNKS';
--
--   The guard exists so that a stray `supabase db push` - which would otherwise
--   apply stages 1 through 5 back to back - cannot destroy 30,000 rows before
--   anyone has looked at stage 3's numbers.
-- ============================================================================
--
-- WHAT CHANGED WITH THE POOL DESIGN
-- ---------------------------------
-- This stage now deletes the private chunks of EVERY pooled document, the donor
-- included. Under the superseded design the elected canonical kept its copy and
-- only the others were emptied; here the surviving copy lives in
-- pool_document_chunks, written and verified by stage 4, and no student's row is
-- the master any more.
--
-- So the row count deleted here is larger than the old design's while the space
-- freed is the same: stage 4 already wrote one copy per group into the pool.
-- Section 5b reports both numbers separately, and stage 3 section A predicted
-- them.
--
-- The corresponding gain is that this is now the only destructive step in the
-- whole migration and it removes nothing that anyone else depends on. A pooled
-- document's chunks are, by the time they are deleted, a redundant second copy
-- of rows that exist in a table no student can write to or delete from.
--
-- PRECONDITIONS. Do not run this until all of these are true:
--   1. Stage 1 applied (schema, RLS, resolving search functions) AND the app has
--      been redeployed with the stage-1 functions live AND DEDUP_SCHEMA_APPLIED
--      is true in src/lib/content-hash.ts, supabase/functions/extract-pdf and
--      gandd-mobile/lib/studybody-data.ts. Until then a pooled student's search
--      still goes through the old `dc.user_id = auth.uid()` path and would
--      return nothing the moment their own chunks disappear. The mobile app
--      ships separately: confirm the build students actually have installed is
--      the one that resolves the pool.
--   2. Stage 4 run to completion, its verification queries (i) through (iv)
--      returned zero rows, and section 4f's spot-checks passed in the live app -
--      on web AND on mobile.
--   3. You have spot-checked as a real student: log in as (or impersonate) one
--      of the students listed in stage 3 query E, open a file that is about to
--      be emptied, and confirm chat retrieval still cites it. It will still work
--      after this stage only if it works through the pool now.
--   4. You have a backup. Supabase free tier keeps daily backups; take a fresh
--      one if the last is old. The chunk text exists nowhere else (the storage
--      bucket holds one 3.7 MB object; the original PDFs were never uploaded) -
--      but note that after stage 4 it DOES exist twice inside the database,
--      which is exactly why this stage can be run at all.
--
-- ROLLBACK: there isn't one, by construction. Before the delete, undo is stage
-- 4's rollback statement. After it, a document's own chunks are gone and the
-- pool is the only copy - which is the intended end state, not a failure. To
-- unwind a single student anyway, copy the rows back:
--
--   insert into public.document_chunks
--     (document_id, user_id, chunk_index, page_start, page_end, content,
--      token_estimate, embedding)
--   select d.id, d.user_id, pc.chunk_index, pc.page_start, pc.page_end,
--          pc.content, pc.token_estimate, pc.embedding
--   from public.documents d
--   join public.pool_document_chunks pc on pc.pool_document_id = d.pooled_document_id
--   where d.id = '<document id>';
--   update public.documents set pooled_document_id = null where id = '<document id>';
--
-- (In that order. The RLS INSERT policy on document_chunks refuses chunks on a
-- pooled document, so unlinking first would be fine too - but this runs as the
-- owner, which RLS does not apply to, and doing it in this order means the
-- student is never momentarily left with no chunks by either route.)


-- ─── 5a. Delete the now-redundant private chunks ──────────────────────────────
--
-- Only rows belonging to a document that is currently linked to a pool row whose
-- content is re-verified byte-for-byte AT DELETE TIME - not at plan time, and
-- not at stage 4 time. Anything that fails that check is skipped with a warning
-- and left alone; it can be investigated afterwards in dedup.merge_log
-- (chunks_deleted_at IS NULL means "not deleted").
--
-- The pool digest is recomputed once per pool row, not once per document: the
-- loop is ordered by pool_id and remembers the last one. Several students share
-- a pool row, and hashing the same book five times to delete five copies of it
-- would triple the cost of the stage for nothing.
DO $$
DECLARE
  r            RECORD;
  v_doc_hash   TEXT;
  v_pool_hash  TEXT;
  v_pool_seen  UUID;
  v_link_rows  INT;
  n            INT;
  v_doc_total  INT;
  v_total      INT := 0;
  v_docs       INT := 0;
  v_skipped    INT := 0;
BEGIN
  IF COALESCE(current_setting('dedup.confirm_delete', true), '') <> 'DELETE-REDUNDANT-CHUNKS' THEN
    RAISE NOTICE 'Stage 5 skipped (not armed). Run: SET dedup.confirm_delete = ''DELETE-REDUNDANT-CHUNKS''; then re-run this file.';
    RETURN;
  END IF;

  FOR r IN
    SELECT m.document_id, m.pool_id, m.digest
    FROM dedup.merge_log m
    JOIN public.documents d ON d.id = m.document_id
    WHERE m.linked_at IS NOT NULL
      AND m.chunks_deleted_at IS NULL
      AND m.pool_id IS NOT NULL
      -- the link must still be a link, and still point where we think it does
      AND d.pooled_document_id = m.pool_id
    ORDER BY m.pool_id, m.file_name
  LOOP
    SELECT count(*) INTO v_link_rows
    FROM public.document_chunks WHERE document_id = r.document_id;

    -- Already emptied by a previous partial run: just close the log entry.
    IF v_link_rows = 0 THEN
      UPDATE dedup.merge_log
      SET chunks_deleted_at = COALESCE(chunks_deleted_at, now()),
          chunks_deleted    = COALESCE(chunks_deleted, 0)
      WHERE document_id = r.document_id;
      CONTINUE;
    END IF;

    -- The pool row must still hold content, or the delete would leave the
    -- student with nothing at all by either route.
    IF NOT EXISTS (
      SELECT 1 FROM public.pool_document_chunks WHERE pool_document_id = r.pool_id
    ) THEN
      RAISE WARNING 'SKIP %: pool row % has no chunks', r.document_id, r.pool_id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_pool_seen IS DISTINCT FROM r.pool_id THEN
      v_pool_hash := public.pool_chunkset_digest(r.pool_id);
      v_pool_seen := r.pool_id;
    END IF;

    v_doc_hash := public.document_chunkset_digest(r.document_id);

    IF v_doc_hash IS DISTINCT FROM v_pool_hash THEN
      RAISE WARNING 'SKIP %: private content differs from pool % (% vs %)',
        r.document_id, r.pool_id, left(v_doc_hash, 12), left(v_pool_hash, 12);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Delete in slices. One 30,000-row statement would be fine on a healthy
    -- instance, but this one is at its ceiling; slicing keeps each statement's
    -- lock footprint and WAL burst small.
    v_doc_total := 0;
    LOOP
      DELETE FROM public.document_chunks
      WHERE ctid IN (
        SELECT ctid FROM public.document_chunks
        WHERE document_id = r.document_id
        LIMIT 2000
      );
      GET DIAGNOSTICS n = ROW_COUNT;
      EXIT WHEN n = 0;
      v_doc_total := v_doc_total + n;
    END LOOP;

    UPDATE dedup.merge_log
    SET chunks_deleted_at = now(),
        chunks_deleted    = v_doc_total
    WHERE document_id = r.document_id;

    v_total := v_total + v_doc_total;
    v_docs  := v_docs + 1;
  END LOOP;

  RAISE NOTICE 'Deleted % chunk rows across % documents (% skipped).', v_total, v_docs, v_skipped;
END
$$;


-- ─── 5b. Confirm nobody lost their book ───────────────────────────────────────
-- Must return zero rows: every pooled document either resolves to a pool row
-- that has chunks, or was skipped above and still has its own.
SELECT
  m.document_id,
  m.file_name,
  m.chunks_deleted,
  (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id) AS own_chunks,
  (SELECT count(*) FROM public.pool_document_chunks pc WHERE pc.pool_document_id = m.pool_id) AS pooled_chunks
FROM dedup.merge_log m
WHERE (SELECT count(*) FROM public.pool_document_chunks pc WHERE pc.pool_document_id = m.pool_id) = 0
  AND (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id) = 0;

-- Wider version of the same question, not restricted to the merge log: ANY
-- document that reads through the pool and would find nothing there. Also zero.
SELECT d.id, d.user_id, d.file_name, d.pooled_document_id
FROM public.documents d
WHERE d.pooled_document_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.pool_document_chunks pc
    WHERE pc.pool_document_id = d.pooled_document_id
  );

-- Anything the delete refused, for follow-up.
SELECT document_id, pool_id, file_name, chunk_count, is_donor
FROM dedup.merge_log
WHERE linked_at IS NOT NULL AND chunks_deleted_at IS NULL;

-- What was actually removed, and what it actually cost/saved. rows_deleted
-- counts every private copy including the donors'; rows_added_to_pool is the one
-- copy per group stage 4 wrote. The difference is the real saving.
SELECT
  count(*)                                             AS documents_emptied,
  COALESCE(sum(chunks_deleted), 0)                     AS rows_deleted,
  (SELECT count(*) FROM public.pool_document_chunks)   AS rows_added_to_pool,
  COALESCE(sum(chunks_deleted), 0)
    - (SELECT count(*) FROM public.pool_document_chunks) AS rows_net_freed,
  pg_size_pretty(COALESCE(sum(bytes) FILTER (WHERE NOT is_donor), 0))
                                                       AS heap_bytes_net_freed_estimate
FROM dedup.merge_log
WHERE chunks_deleted_at IS NOT NULL;


-- ─── 5c. Reclaim the space (SEPARATE STEP - read this) ────────────────────────
--
-- DELETE does not shrink anything. It marks tuples dead; the table keeps every
-- page it had, and pg_database_size - which is what Supabase's 500 MB ceiling
-- measures - does not move. Until the next step runs, this migration has bought
-- exactly nothing. Worse than nothing, in fact: stage 4 added a real copy to
-- pool_document_chunks, so the database is currently BIGGER than it was before
-- the migration started. That is the transient cost stage 3 section G measured,
-- and this is the step that ends it.
--
-- Run, as a single statement, NOT inside a transaction:
--
--     VACUUM (FULL, ANALYZE) public.document_chunks;
--
-- Notes before you do:
--   * VACUUM cannot run inside a transaction block. The Supabase SQL editor may
--     wrap statements in one and reject it; if so, connect with psql using the
--     project's connection string and run it there.
--   * VACUUM FULL rewrites the table and all its indexes into new files, so it
--     briefly needs free disk roughly equal to the FINAL size (~250 MB here).
--     Free-tier disk is several GB even though the billed database ceiling is
--     500 MB, so this has room - but it is the reason to do it immediately after
--     the delete rather than letting dead tuples accumulate further.
--   * It takes an ACCESS EXCLUSIVE lock: document_chunks is unreadable for the
--     duration (expect tens of seconds at this size). Chat and StudyBody
--     retrieval will fail during it for students who are NOT pooled; pooled
--     students read pool_document_chunks and are unaffected. Do it off-peak.
--   * The HNSW and GIN indexes on this table are rebuilt as part of the rewrite,
--     which shrinks them too - often a bigger win than the heap itself.
--   * pool_document_chunks needs no VACUUM FULL. It was created empty and only
--     ever inserted into, so it has no dead tuples. ANALYZE it anyway so the
--     planner knows how big it is now:
--
--         ANALYZE public.pool_document_chunks;
--
-- Then re-run stage 3 query F to measure the result, and:
--
--     SELECT pg_size_pretty(pg_database_size(current_database()));
--
-- Expected: document_chunks drops by roughly two thirds of its rows, of which
-- about half comes back as pool_document_chunks, for a net ~130 MB - plus
-- whatever the index rebuild returns.


-- ─── 5d. Afterwards ───────────────────────────────────────────────────────────
-- The forward path is now the only thing that matters, and it needs no further
-- migration: a new upload is fingerprinted in the browser, find_pooled_document()
-- either matches (link, no chunks written, nothing to share) or does not (the
-- student is offered "Share with G&D" and pool_share_document() does the same
-- copy-verify-link-delete this stage did, for one document, inside one
-- transaction).
--
-- dedup.merge_log is worth keeping. It is the only record of which student's
-- copy seeded which pool row, and it costs a few kilobytes.
