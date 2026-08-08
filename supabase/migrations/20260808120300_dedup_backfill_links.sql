-- Chunk de-duplication, stage 4 of 5: BACKFILL. Writes links. Deletes nothing.
--
-- Run stages 1 and 2 first, and read stage 3's output before running this. This
-- file records the merge decision and points every redundant documents row at
-- its canonical copy. Chunk rows are left completely untouched: afterwards every
-- student can still reach their book by BOTH routes - their own chunks and the
-- link - which is exactly what makes it possible to verify the new path in the
-- live app before the destructive stage 5 removes the old one.
--
-- Idempotent. Running it twice links nothing new.
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
-- what they held back.
--
-- CANONICAL SELECTION: within a group the copy with the MOST EMBEDDED CHUNKS
-- wins; ties go to the oldest, then the lowest id. Not "the oldest", because
-- 36,695 of 59,933 chunks have a NULL embedding - picking by age would regularly
-- keep an unembedded copy and switch off semantic search for the whole group.
--
-- ROLLBACK (safe only until stage 5 has run - after that the chunks it would
-- fall back to are gone):
--   update public.documents d
--   set canonical_document_id = NULL
--   from dedup.merge_log m
--   where d.id = m.document_id and m.chunks_deleted_at is null;


-- ─── 4a. Freeze the decision ──────────────────────────────────────────────────
-- dedup.plan stops reporting a document the moment it becomes a link, so it is
-- deliberately not consulted again after this point. Everything downstream - the
-- delete, the verification, the rollback - reads this table instead. It is also
-- the audit trail: who lost which chunks, and when.
CREATE TABLE IF NOT EXISTS dedup.merge_log (
  document_id        UUID PRIMARY KEY,
  canonical_id       UUID NOT NULL,
  user_id            UUID NOT NULL,
  file_name          TEXT NOT NULL,
  file_size          BIGINT,
  page_count         INT,
  chunk_count        INT NOT NULL,
  embedded_count     INT NOT NULL,
  bytes              BIGINT NOT NULL,
  digest             TEXT NOT NULL,
  linked_at          TIMESTAMPTZ,
  chunks_deleted_at  TIMESTAMPTZ,
  chunks_deleted     INT
);
REVOKE ALL ON dedup.merge_log FROM anon, authenticated;

INSERT INTO dedup.merge_log (
  document_id, canonical_id, user_id, file_name, file_size, page_count,
  chunk_count, embedded_count, bytes, digest
)
SELECT
  p.document_id, p.canonical_id, p.user_id, p.file_name, p.file_size, p.page_count,
  p.chunk_count, p.embedded_count, p.bytes, p.digest
FROM dedup.plan p
WHERE NOT p.is_canonical
ON CONFLICT (document_id) DO NOTHING;

-- What was frozen. Compare against stage 3 query A; they must agree.
SELECT
  count(*)                     AS documents_to_link,
  count(DISTINCT canonical_id) AS groups,
  sum(chunk_count)             AS chunk_rows_that_become_redundant,
  pg_size_pretty(sum(bytes))   AS heap_bytes_at_stake
FROM dedup.merge_log
WHERE linked_at IS NULL;


-- ─── 4b. Create the links ─────────────────────────────────────────────────────
-- The preconditions are re-checked here at write time rather than trusted from
-- plan time, so a stale plan cannot link something that has changed underneath
-- it. Note the hash equality check: it is the same condition the guard trigger
-- from stage 1 applies to application writes, asserted again here.
UPDATE public.documents d
SET canonical_document_id = m.canonical_id
FROM dedup.merge_log m
WHERE d.id = m.document_id
  AND d.canonical_document_id IS NULL
  AND d.id <> m.canonical_id
  AND d.content_hash = m.digest                     -- the link still hashes the same
  AND EXISTS (
    SELECT 1 FROM public.documents c
    WHERE c.id = m.canonical_id
      AND c.canonical_document_id IS NULL           -- canonical is still canonical
      AND c.content_hash = m.digest                 -- ...and still the same content
  )
  AND EXISTS (
    SELECT 1 FROM public.document_chunks dc          -- ...and still has that content
    WHERE dc.document_id = m.canonical_id
  );

UPDATE dedup.merge_log m
SET linked_at = now()
FROM public.documents d
WHERE d.id = m.document_id
  AND d.canonical_document_id = m.canonical_id
  AND m.linked_at IS NULL;


-- ─── 4c. Verify, before going anywhere near stage 5 ───────────────────────────
-- The first three must return ZERO rows. If any returns anything, STOP - do not
-- run stage 5; a student would lose a book.

-- (i) Every logged document is now a link to the intended canonical.
SELECT m.document_id, m.file_name, d.canonical_document_id, m.canonical_id
FROM dedup.merge_log m
JOIN public.documents d ON d.id = m.document_id
WHERE d.canonical_document_id IS DISTINCT FROM m.canonical_id;

-- (ii) Every canonical still holds exactly the chunk set that was hashed. This
--      is the statement stage 5 depends on: the content a link resolves to is
--      the content that link used to own. Recomputed live, not read back from
--      content_hash, so a stale stored hash cannot hide a change.
SELECT
  m.canonical_id,
  m.digest AS expected,
  'chunkset-sha256-v1:' || public.document_chunkset_digest(m.canonical_id) AS actual
FROM (SELECT DISTINCT canonical_id, digest FROM dedup.merge_log) m
WHERE 'chunkset-sha256-v1:' || public.document_chunkset_digest(m.canonical_id) IS DISTINCT FROM m.digest;

-- (iii) No chains and no cycles: a canonical must never itself be a link.
SELECT DISTINCT m.canonical_id, c.canonical_document_id
FROM dedup.merge_log m
JOIN public.documents c ON c.id = m.canonical_id
WHERE c.canonical_document_id IS NOT NULL;

-- (iv) Resolution check - what each linked student will now read. own_chunks and
--      resolved_chunks should both be non-zero and equal at this point (the old
--      route and the new route agree). After stage 5, own_chunks becomes 0 and
--      resolved_chunks must stay the same.
SELECT
  left(m.document_id::text, 8) AS doc,
  m.file_name,
  (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.document_id)  AS own_chunks,
  (SELECT count(*) FROM public.document_chunks dc WHERE dc.document_id = m.canonical_id) AS resolved_chunks
FROM dedup.merge_log m
WHERE m.linked_at IS NOT NULL
ORDER BY m.file_name
LIMIT 50;

-- Informational: what stage 5 will delete.
SELECT
  count(*)                     AS documents_linked,
  sum(m.chunk_count)           AS chunk_rows_pending_delete,
  pg_size_pretty(sum(m.bytes)) AS heap_bytes_pending
FROM dedup.merge_log m
WHERE m.linked_at IS NOT NULL AND m.chunks_deleted_at IS NULL;


-- ─── 4d. Now go and look at the app ───────────────────────────────────────────
-- This is the cheap moment to catch a missed consumer, because both routes still
-- work and nothing is lost if something is wrong. Deploy the stage-1 functions,
-- then for one of the students from stage 3 query E:
--   * open a file that has become a link and ask the chat something from it -
--     it must cite that file (search_document_chunks_hybrid resolves the link);
--   * build or open a StudyBody roadmap over it (document_chunks_effective);
--   * if you are an admin, promote one to the library and confirm the chunk
--     count comes back non-zero (promote_document_to_library).
-- If any of those returns nothing NOW, it will return nothing forever after
-- stage 5. Fix it first, or roll back with the statement in this file's header.
