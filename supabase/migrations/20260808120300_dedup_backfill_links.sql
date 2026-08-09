-- Chunk de-duplication, stage 4 of 5: BACKFILL. Fills the pool. Deletes nothing.
--
-- Run stages 1 and 2 first, and read stage 3's output - especially section G,
-- the transient cost - before running this. This file copies one chunk set per
-- group into the G&D pool and points every documents row in that group at it.
--
-- NOT ONE STATEMENT. Stage 3 section G measured the cost of the copy; this file
-- pays it one book at a time, so the peak extra space is a single textbook
-- rather than the whole corpus, and so no statement runs long enough to be
-- killed by the database's statement_timeout. Run 4c repeatedly until it returns
-- 0. Each call is its own transaction: whatever finished stays finished, and an
-- interrupted run is resumed by calling it again.
--
-- Private chunk rows are left completely untouched. Afterwards every student can
-- still reach their book by BOTH routes - their own chunks and the pool - which
-- is exactly what makes it possible to verify the new path in the live app
-- before the destructive stage 5 removes the old one.
--
-- Idempotent. Running it twice pools nothing new and links nothing new.
--
-- WHAT CHANGED WITH THE POOL DESIGN
-- ---------------------------------
--   * There is no canonical document. The elected copy is a DONOR: its chunks
--     SEED the pool, and then it links to the pool like everyone else and gives
--     up its private copy in stage 5. Every member of a group ends up pooled.
--   * The link is (pooled_document_id, content_hash) as a matched pair. The
--     foreign key added in stage 1 re-checks the hash on every write, so the
--     "does this row still hash the same" assertion that the superseded design
--     needed a trigger for is enforced by the database on the UPDATE below.
--   * The pool is keyed on content_hash ALONE. dedup.plan partitions groups by
--     (digest, chunk_count, file_name, file_size, page_count), so two groups can
--     in principle share a digest and differ only in what the students named the
--     file. They converge on ONE pool row here, correctly: the content is
--     identical, and every consumer quotes the file name from the CALLER'S
--     documents row, never the pool's. The second group finds the row already
--     present and adopts it without copying anything.
--   * NO POINTS ARE AWARDED. This is a historical backfill performed by the
--     owner, not a student pressing "Share with G&D". The +10 belongs to the
--     live prompt in the app, which goes through public.pool_share_document().
--     pool_documents.contributed_by still records the donor, as credit.
--
-- THE IDENTITY CRITERIA (what "the same book" means here)
-- ------------------------------------------------------
-- The decision is the content hash: documents.content_hash, computed in stage 2
-- from the extracted text as stored - each chunk's SHA-256 combined with its
-- chunk_index and page numbers, in chunk_index order, hashed again. Equal hash
-- means byte-identical text, same order, same page labels, so substituting one
-- chunk set for the other cannot change any answer, citation or page number the
-- app produces. That is a proof about the thing we actually store, not a guess
-- about two files we never kept.
--
-- (file_name, file_size) survives only as a cheap pre-filter that narrows which
-- documents get compared. It authorises nothing.
--
-- On top of the hash, dedup.plan enforces eligibility rules so the hash is never
-- decisive about the wrong thing - contiguous chunk_index, at least 1,000
-- characters of text, extract_status ready, and a sane chunk-to-page ratio.
-- Their full rationale is in stage 1 next to the view; the short version is that
-- a hash stops discriminating when there is almost nothing to hash, and a
-- half-extracted book is not a copy of anything. dedup.ineligible lists exactly
-- what they held back. pool_share_document() asserts the same rules for every
-- live share, so nothing enters the pool by either route without passing them.
--
-- DONOR SELECTION: within a group the copy with the MOST EMBEDDED CHUNKS wins;
-- ties go to the oldest, then the lowest id. Not "the oldest", because 36,695 of
-- 59,933 chunks have a NULL embedding, and whatever the donor holds is what the
-- pool keeps forever - a pooled chunk has no user_id, so the client-side
-- backfill in src/lib/embeddings.ts can never reach it. Picking by age would
-- regularly donate an unembedded copy and switch off semantic search for that
-- book permanently.
--
-- ROLLBACK (safe only until stage 5 has run - after that the private chunks it
-- would fall back to are gone):
--   update public.documents d
--   set pooled_document_id = NULL
--   from dedup.merge_log m
--   where d.id = m.document_id and m.chunks_deleted_at is null;
--
--   -- then, optionally, drop the now-unreferenced pool rows (this cascades to
--   -- pool_document_chunks):
--   delete from public.pool_documents p
--   where not exists (
--     select 1 from public.documents d where d.pooled_document_id = p.id
--   );
--
--   update dedup.merge_log set pool_id = NULL, pooled_at = NULL, linked_at = NULL
--   where chunks_deleted_at is null;
--
-- content_hash is deliberately NOT cleared by that: an un-pooled document is
-- allowed to carry its fingerprint (that is the whole forward path), and
-- clearing it would only make the next student re-store the book.


-- ─── 4a. Freeze the decision ──────────────────────────────────────────────────
-- dedup.plan stops reporting a document the moment it becomes a link, so it is
-- deliberately not consulted again after this point. Everything downstream - the
-- pooling, the delete, the verification, the rollback - reads this table
-- instead. It is also the audit trail: who donated what, who lost which chunks,
-- and when.
--
-- Note that EVERY member is logged, donors included. Under the superseded design
-- the canonical was excluded because it kept its chunks; here it does not.
CREATE TABLE IF NOT EXISTS dedup.merge_log (
  document_id        UUID PRIMARY KEY,
  digest             TEXT NOT NULL,
  user_id            UUID NOT NULL,
  file_name          TEXT NOT NULL,
  file_size          BIGINT,
  page_count         INT,
  chunk_count        INT NOT NULL,
  embedded_count     INT NOT NULL,
  bytes              BIGINT NOT NULL,
  is_donor           BOOLEAN NOT NULL,
  -- Filled by 4c once the group's pool row exists and has been verified.
  pool_id            UUID,
  pooled_at          TIMESTAMPTZ,
  linked_at          TIMESTAMPTZ,
  chunks_deleted_at  TIMESTAMPTZ,
  chunks_deleted     INT
);
REVOKE ALL ON dedup.merge_log FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS merge_log_digest_idx ON dedup.merge_log (digest);

INSERT INTO dedup.merge_log (
  document_id, digest, user_id, file_name, file_size, page_count,
  chunk_count, embedded_count, bytes, is_donor
)
SELECT
  p.document_id, p.digest, p.user_id, p.file_name, p.file_size, p.page_count,
  p.chunk_count, p.embedded_count, p.bytes, p.is_donor
FROM dedup.plan p
ON CONFLICT (document_id) DO NOTHING;

-- What was frozen. Compare against stage 3 query A; they must agree.
SELECT
  count(*)                                                  AS documents_to_pool,
  count(*) FILTER (WHERE is_donor)                          AS groups,
  sum(chunk_count)                                          AS chunk_rows_that_become_redundant,
  pg_size_pretty(sum(bytes) FILTER (WHERE is_donor))        AS bytes_to_be_copied_into_pool,
  pg_size_pretty(sum(bytes) FILTER (WHERE NOT is_donor))    AS net_bytes_at_stake
FROM dedup.merge_log
WHERE linked_at IS NULL;


-- ─── 4b. The pooling routine ──────────────────────────────────────────────────
--
-- One call pools up to p_limit GROUPS and returns how many it pooled. Call it
-- until it returns 0 (4c). Every group is independent, so a call that fails
-- mid-way rolls back only the groups in that call, and the ones already
-- committed keep their pool rows.
--
-- Smallest books first. If something is wrong with the machinery, it should show
-- up on a 40-chunk pamphlet, not after twenty minutes of copying a 3,000-page
-- textbook.
--
-- NOTHING IS TRUSTED FROM PLAN TIME. Before a donor's chunks are copied, its
-- live digest is recomputed and compared to the frozen one; after the copy, the
-- POOL's digest is recomputed from the pool rows themselves and compared again.
-- A copy that does not certify itself is deleted again and the group is skipped
-- with a warning, not silently accepted. This is the check that lets stage 5
-- delete a student's only copy of a book.
CREATE OR REPLACE FUNCTION dedup.pool_batch(p_limit INT DEFAULT 5)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  r             RECORD;
  v_pool_id     UUID;
  v_live        TEXT;
  v_pool_digest TEXT;
  v_created     BOOLEAN;
  v_done        INT := 0;
BEGIN
  FOR r IN
    SELECT m.document_id, m.digest, m.file_name, m.file_size, m.page_count,
           m.chunk_count, m.user_id
    FROM dedup.merge_log m
    WHERE m.is_donor
      AND m.pool_id IS NULL
    ORDER BY m.bytes ASC
    LIMIT GREATEST(p_limit, 1)
  LOOP
    v_created := FALSE;

    -- Another group with the same digest (or a student who pressed "Share with
    -- G&D" in the app before this ran) may already have created the row. Adopt
    -- it; the content is identical by definition of the key.
    SELECT p.id INTO v_pool_id
    FROM public.pool_documents p
    WHERE p.content_hash = r.digest;

    IF v_pool_id IS NULL THEN
      -- The donor must still hold exactly the content that was hashed in stage
      -- 2. Recomputed live, not read back from content_hash, so a stale stored
      -- hash cannot certify a changed document.
      v_live := 'chunkset-sha256-v1:' || public.document_chunkset_digest(r.document_id);
      IF v_live IS DISTINCT FROM r.digest THEN
        RAISE WARNING 'SKIP group %: donor % no longer hashes the same (% vs %)',
          left(r.digest, 20), r.document_id, left(v_live, 26), left(r.digest, 26);
        CONTINUE;
      END IF;

      INSERT INTO public.pool_documents
        (content_hash, file_name, file_size, page_count, chunk_count, contributed_by)
      VALUES
        (r.digest, r.file_name, r.file_size, r.page_count, r.chunk_count, r.user_id)
      ON CONFLICT (content_hash) DO NOTHING
      RETURNING id INTO v_pool_id;

      IF v_pool_id IS NULL THEN
        SELECT p.id INTO v_pool_id
        FROM public.pool_documents p WHERE p.content_hash = r.digest;
      ELSE
        v_created := TRUE;
        -- The embedding travels with the text. It is not recomputed and cannot
        -- be recovered later by the client backfill, which is why the donor is
        -- the copy with the most embedded chunks.
        INSERT INTO public.pool_document_chunks
          (pool_document_id, chunk_index, page_start, page_end, content,
           token_estimate, embedding)
        SELECT v_pool_id, dc.chunk_index, dc.page_start, dc.page_end,
               dc.content, dc.token_estimate, dc.embedding
        FROM public.document_chunks dc
        WHERE dc.document_id = r.document_id;
      END IF;
    END IF;

    IF v_pool_id IS NULL THEN
      RAISE WARNING 'SKIP group %: could not create or find a pool row', left(r.digest, 20);
      CONTINUE;
    END IF;

    -- PROVE THE COPY BEFORE ANYTHING LINKS TO IT.
    v_pool_digest := 'chunkset-sha256-v1:' || public.pool_chunkset_digest(v_pool_id);
    IF v_pool_digest IS DISTINCT FROM r.digest THEN
      IF v_created THEN
        -- Only ever removes a row this call just wrote, and only before anything
        -- points at it. Cascades to pool_document_chunks.
        DELETE FROM public.pool_documents WHERE id = v_pool_id;
      END IF;
      RAISE WARNING 'SKIP group %: pooled copy does not verify (% vs %)',
        left(r.digest, 20), left(v_pool_digest, 26), left(r.digest, 26);
      CONTINUE;
    END IF;

    -- Stamp the whole group, keyed on the digest: any other sub-group with the
    -- same content adopts this row too, and its donor iteration becomes a no-op.
    UPDATE dedup.merge_log m
    SET pool_id = v_pool_id, pooled_at = now()
    WHERE m.digest = r.digest AND m.pool_id IS NULL;

    v_done := v_done + 1;
  END LOOP;

  RETURN v_done;
END;
$$;


-- ─── 4c. Fill the pool ────────────────────────────────────────────────────────
-- Run this line repeatedly until it returns 0. Five groups per call is
-- deliberately small: stage 3 section G says what one book costs, and this keeps
-- the peak to roughly that.
--
--   SELECT dedup.pool_batch(5);
--
-- If a call times out, lower the argument to 1 and carry on. Nothing is lost -
-- committed groups keep their pool rows, and the next call starts from the
-- first group that has none.
SELECT dedup.pool_batch(5) AS groups_pooled;

-- Progress. Keep calling until groups_remaining is 0.
SELECT
  count(*) FILTER (WHERE pool_id IS NULL)     AS groups_remaining,
  count(*) FILTER (WHERE pool_id IS NOT NULL) AS groups_pooled
FROM dedup.merge_log
WHERE is_donor;


-- ─── 4d. Create the links ─────────────────────────────────────────────────────
-- Every member of a pooled group, donor included, now points at the pool row.
--
-- The preconditions are re-checked here at write time rather than trusted from
-- plan time, so a stale plan cannot link something that has changed underneath
-- it. `d.content_hash = m.digest` is not decoration either: the composite
-- foreign key would REJECT a mismatched pair and abort the entire statement, so
-- the predicate is what turns "one bad row kills the batch" into "one bad row is
-- skipped and reported by 4e".
--
-- Only pooled_document_id is written. content_hash is already equal to the
-- digest for every row this matches - stage 2 put it there - and it is the other
-- half of the key the foreign key checks.
UPDATE public.documents d
SET pooled_document_id = m.pool_id
FROM dedup.merge_log m
WHERE d.id = m.document_id
  AND m.pool_id IS NOT NULL
  AND d.pooled_document_id IS NULL
  AND d.content_hash = m.digest                      -- the link still hashes the same
  AND EXISTS (
    SELECT 1 FROM public.pool_documents p
    WHERE p.id = m.pool_id
      AND p.content_hash = m.digest                  -- ...and the pool still holds it
  )
  AND EXISTS (
    SELECT 1 FROM public.pool_document_chunks pc     -- ...and it is not an empty shell
    WHERE pc.pool_document_id = m.pool_id
  );

UPDATE dedup.merge_log m
SET linked_at = now()
FROM public.documents d
WHERE d.id = m.document_id
  AND d.pooled_document_id = m.pool_id
  AND m.linked_at IS NULL;


-- ─── 4e. Verify, before going anywhere near stage 5 ───────────────────────────
-- The first four must return ZERO rows. If any returns anything, STOP - do not
-- run stage 5; a student would lose a book.

-- (i) Every pooled group's document is linked to the intended pool row.
SELECT m.document_id, m.file_name, d.pooled_document_id, m.pool_id
FROM dedup.merge_log m
JOIN public.documents d ON d.id = m.document_id
WHERE m.pool_id IS NOT NULL
  AND d.pooled_document_id IS DISTINCT FROM m.pool_id;

-- (ii) Every pool row still holds exactly the chunk set that was hashed. This is
--      the statement stage 5 depends on: the content a link resolves to is the
--      content that link used to own. Recomputed live from the pool rows, not
--      read back from pool_documents.content_hash, so a bad copy cannot certify
--      itself.
SELECT
  m.pool_id,
  m.digest AS expected,
  'chunkset-sha256-v1:' || public.pool_chunkset_digest(m.pool_id) AS actual
FROM (SELECT DISTINCT pool_id, digest FROM dedup.merge_log WHERE pool_id IS NOT NULL) m
WHERE 'chunkset-sha256-v1:' || public.pool_chunkset_digest(m.pool_id) IS DISTINCT FROM m.digest;

-- (iii) No linked document points at an empty pool row.
SELECT d.id, d.file_name, d.pooled_document_id
FROM public.documents d
WHERE d.pooled_document_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.pool_document_chunks pc
    WHERE pc.pool_document_id = d.pooled_document_id
  );

-- (iv) Both routes agree, per document. own_chunks and pooled_chunks must be
--      equal and non-zero right now. After stage 5, own_chunks becomes 0 and
--      pooled_chunks must be unchanged.
SELECT
  left(m.document_id::text, 8) AS doc,
  m.file_name,
  m.is_donor,
  (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id) AS own_chunks,
  (SELECT count(*) FROM public.pool_document_chunks pc WHERE pc.pool_document_id = m.pool_id) AS pooled_chunks
FROM dedup.merge_log m
WHERE m.linked_at IS NOT NULL
  AND (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id)
   <> (SELECT count(*) FROM public.pool_document_chunks pc WHERE pc.pool_document_id = m.pool_id);

-- CHAINS AND CYCLES: there is no query for them because they cannot exist. A
-- pool row is not a document and has no link column of its own, so a link can
-- never point at another link. Under the superseded design this was three
-- verification queries and a trigger.
--
-- ACCOUNT DELETION: likewise nothing to check. pool_documents has no user_id and
-- no cascading reference to auth.users on its content path; contributed_by is
-- ON DELETE SET NULL, so deleting the donor's account erases who gave the book,
-- never the book.

-- Informational: what stage 5 will delete, and what it will actually free.
SELECT
  count(*)                                                AS documents_linked,
  sum(m.chunk_count)                                      AS chunk_rows_pending_delete,
  pg_size_pretty(sum(m.bytes))                            AS heap_bytes_pending_delete,
  pg_size_pretty(sum(m.bytes) FILTER (WHERE NOT m.is_donor))
                                                          AS net_bytes_actually_freed
FROM dedup.merge_log m
WHERE m.linked_at IS NOT NULL AND m.chunks_deleted_at IS NULL;

-- Anything that did not make it, for follow-up. Expected to be empty.
SELECT digest, file_name, chunk_count, is_donor, pool_id, linked_at
FROM dedup.merge_log
WHERE pool_id IS NULL OR linked_at IS NULL
ORDER BY file_name;


-- ─── 4f. Now go and look at the app ───────────────────────────────────────────
-- This is the cheap moment to catch a missed consumer, because both routes still
-- work and nothing is lost if something is wrong. Deploy the stage-1 functions
-- and flip DEDUP_SCHEMA_APPLIED in src/lib/content-hash.ts (and its twins in
-- supabase/functions/extract-pdf and gandd-mobile/lib/studybody-data.ts), then
-- for one of the students from stage 3 query E:
--   * open a file that has become a link and ask the chat something from it - it
--     must cite that file (search_document_chunks_hybrid resolves the pool);
--   * build or open a StudyBody roadmap over it (document_chunks_effective);
--   * do the same on the mobile app, which ships separately and reads the same
--     view;
--   * if you are an admin, promote one to the library and confirm the chunk
--     count comes back non-zero (promote_document_to_library);
--   * upload the SAME textbook again as a different student and confirm it saves
--     near-instantly and writes no chunks (find_pooled_document matched), and
--     that the share prompt is NOT raised for it - it cost the pool nothing.
-- If any of those returns nothing NOW, it will return nothing forever after
-- stage 5. Fix it first, or roll back with the statements in this file's header.
