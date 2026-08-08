-- Chunk de-duplication, stage 5 of 5: DESTRUCTIVE. Deletes ~30,400 chunk rows.
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
-- PRECONDITIONS. Do not run this until all of these are true:
--   1. Stage 1 applied (schema, RLS, resolving search functions) AND the app has
--      been redeployed with the stage-1 functions live. Until then a linked
--      student's search still goes through the old `dc.user_id = auth.uid()`
--      path and would return nothing the moment their own chunks disappear.
--   2. Stage 4 run, and verification queries (i) through (iii) in its section 4c
--      returned zero rows, and section 4d's spot-checks passed in the live app.
--   3. You have spot-checked in the app: log in as (or impersonate) one of the
--      students listed in stage 3 query E, open a file that is about to become a
--      link, and confirm chat retrieval still cites it. It will still work after
--      this stage only if it works through the link now.
--   4. You have a backup. Supabase free tier keeps daily backups; take a fresh
--      one if the last is old. This deletion is not recoverable from within the
--      database - the chunk text exists nowhere else (the storage bucket holds
--      one 3.7 MB object; the original PDFs were never uploaded).
--
-- ROLLBACK: there isn't one, by construction. Before the delete, undo is
-- `update public.documents set canonical_document_id = NULL ...` (stage 4's
-- rollback). After it, the only route back is a database restore. That
-- asymmetry is exactly why this is a separate file with a separate arming step.


-- ─── 5a. Delete the redundant chunks ──────────────────────────────────────────
--
-- Only rows belonging to a document that is currently a link, whose content is
-- re-verified byte-for-byte against its canonical AT DELETE TIME - not at plan
-- time. Anything that fails that check is skipped with a warning and left alone;
-- it can be investigated afterwards in dedup.merge_log (chunks_deleted_at IS
-- NULL means "not deleted").
DO $$
DECLARE
  r            RECORD;
  v_link_hash  TEXT;
  v_canon_hash TEXT;
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
    SELECT m.document_id, m.canonical_id
    FROM dedup.merge_log m
    JOIN public.documents d ON d.id = m.document_id
    WHERE m.linked_at IS NOT NULL
      AND m.chunks_deleted_at IS NULL
      -- the link must still be a link, and still point where we think it does
      AND d.canonical_document_id = m.canonical_id
    ORDER BY m.file_name
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

    -- The canonical must still hold content, or the delete would leave the
    -- student with nothing at all.
    IF NOT EXISTS (SELECT 1 FROM public.document_chunks WHERE document_id = r.canonical_id) THEN
      RAISE WARNING 'SKIP %: canonical % has no chunks', r.document_id, r.canonical_id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_link_hash  := public.document_chunkset_digest(r.document_id);
    v_canon_hash := public.document_chunkset_digest(r.canonical_id);

    IF v_link_hash IS DISTINCT FROM v_canon_hash THEN
      RAISE WARNING 'SKIP %: content differs from canonical % (% vs %)',
        r.document_id, r.canonical_id, left(v_link_hash, 12), left(v_canon_hash, 12);
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
-- Must return zero rows: every merged document either resolves to a canonical
-- that has chunks, or was skipped above and still has its own.
SELECT
  m.document_id,
  m.file_name,
  m.chunks_deleted,
  (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id)  AS own_chunks,
  (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.canonical_id) AS canonical_chunks
FROM dedup.merge_log m
WHERE (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.canonical_id) = 0
  AND (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id) = 0;

-- Anything the delete refused, for follow-up.
SELECT document_id, canonical_id, file_name, chunk_count
FROM dedup.merge_log
WHERE linked_at IS NOT NULL AND chunks_deleted_at IS NULL;

-- What was actually removed.
SELECT
  count(*)                                   AS documents_emptied,
  COALESCE(sum(chunks_deleted), 0)           AS chunk_rows_deleted,
  pg_size_pretty(COALESCE(sum(bytes), 0))    AS heap_bytes_freed_estimate
FROM dedup.merge_log
WHERE chunks_deleted_at IS NOT NULL;


-- ─── 5c. Reclaim the space (SEPARATE STEP - read this) ────────────────────────
--
-- DELETE does not shrink anything. It marks tuples dead; the table keeps every
-- page it had, and pg_database_size - which is what Supabase's 500 MB ceiling
-- measures - does not move. Until the next step runs, this migration has bought
-- exactly nothing.
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
--     retrieval will fail during it. Do it off-peak.
--   * The HNSW and GIN indexes on this table are rebuilt as part of the rewrite,
--     which shrinks them too - often a bigger win than the heap itself.
--
-- Then re-run stage 3 query F to measure the result, and:
--
--     SELECT pg_size_pretty(pg_database_size(current_database()));
--
-- Expected: document_chunks drops by roughly a third (~130 MB of ~380 MB), plus
-- whatever the index rebuild returns.
