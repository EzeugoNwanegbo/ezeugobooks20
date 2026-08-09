-- ONE-OFF DATA REPAIR: mark the historically half-extracted documents as failed.
--
-- NOT A MIGRATION, ON PURPOSE. It lives in supabase/repairs/ rather than
-- supabase/migrations/ because:
--   * it changes DATA, not schema. A migration is replayed on every environment
--     that is ever built from this repo, where these rows do not exist and the
--     statement means nothing;
--   * its first half is a PREVIEW whose entire value is the result set, and
--     `supabase db push` throws result sets away;
--   * it must be run once, by a human, who looks at the preview before arming
--     the UPDATE. A migration is by definition run unattended.
-- Paste it into the Supabase SQL editor one block at a time.
--
-- WHAT IS BROKEN
-- --------------
-- Between 2026-05-04 (738110c) and 2026-07-25 (9b61061) the browser upload path
-- inserted chunks in serial batches of 100 and `break`-ed out of the loop on the
-- first error. The first batch landed, the second failed, the loop stopped - and
-- the path never wrote extract_status at all. The result is documents holding
-- exactly 100 chunks of a 2,785-page textbook, listed in the Library as normal,
-- returning nothing when a student asks about anything past page ~200. Seven
-- large textbooks are known to sit at exactly 100 chunks (chunk_index 0..99);
-- others hold none.
--
-- The code paths are fixed (extract-pdf upserts and marks; the web path now
-- writes 'processing' before the first chunk and 'ready' only after the last).
-- This file repairs the damage those bugs already did. It cannot recover the
-- missing text - the browser path never uploaded the source PDF to storage
-- (storage_path is a virtual "text-only/..." marker), so there is nothing to
-- re-extract from. Marking them 'error' is what stops a student silently
-- trusting a book that answers nothing.
--
-- WHAT IT DOES
-- ------------
--   Block 1  creates dedup.partial_extractions, a READ-ONLY view of the targets.
--   Block 2  PREVIEW: headline counts.
--   Block 3  PREVIEW: the itemised list (id, file_name, page_count, chunks).
--   Block 4  snapshots the current status of every target into a backup table.
--   Block 5  the UPDATE: extract_status = 'error' + an actionable extract_error.
--   Block 6  VERIFY: the preview should now return nothing.
--   Block 7  ROLLBACK, from the block 4 snapshot.
--
-- SAFE TO RUN TWICE. Block 5 only touches rows whose extract_status is NULL or
-- 'ready', so a second run finds nothing left to change; block 4's snapshot
-- inserts ON CONFLICT DO NOTHING, so it keeps the ORIGINAL values even if the
-- file is re-run after the update.
--
-- REQUIRES stage 1 of the dedup work (20260808120000_dedup_document_chunks_schema.sql)
-- to have been applied - block 1 borrows its eligibility heuristic and its
-- `dedup` schema.
--
-- ROLLBACK: block 7. Restores every touched row to the exact extract_status and
-- extract_error it had before, from public.extract_repair_backup. It is a plain
-- UPDATE; nothing here deletes a document or a chunk, so nothing is unrecoverable.


-- ─── 0. Preconditions ─────────────────────────────────────────────────────────
-- extract_error must exist as a column before block 5 writes to it. It was added
-- by 20260609130000_add_document_links.sql alongside extract_status; this asserts
-- it rather than assuming it. Expect both to be `true`.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'extract_status')                AS has_extract_status,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'documents'
            AND column_name = 'extract_error')                 AS has_extract_error,
  EXISTS (SELECT 1 FROM information_schema.views
          WHERE table_schema = 'dedup' AND table_name = 'ineligible')
                                                               AS has_dedup_views;


-- ─── 1. The target set, as a view ─────────────────────────────────────────────
-- THE THRESHOLD IS NOT INVENTED HERE. It is dedup.ineligible's existing test,
-- verbatim:
--
--     s.page_count >= 20 AND s.chunk_count < s.page_count / 20.0
--       -> 'far too few chunks for its page count - probably a partial extraction'
--
-- A real chunk holds ~6,000 characters, roughly two to three pages, so a healthy
-- book clears one-chunk-per-20-pages by an order of magnitude and only a
-- truncated extraction trips it. Using the same number in both places is the
-- point: a document this file marks 'error' is a document the dedup plan already
-- refuses to merge, and the two can never disagree about what "broken" means.
--
-- ONE DELIBERATE EXTENSION. dedup.doc_stats INNER JOINs document_chunks, so a
-- document with ZERO chunks is invisible to it - and zero-chunk documents are
-- half of what this repair exists for. The view below LEFT JOINs instead and
-- keeps them. A zero-chunk document is the degenerate case of the same failure,
-- not a new threshold.
--
-- WHAT IS EXCLUDED, AND WHY
--   * pooled documents (pooled_document_id IS NOT NULL) - they hold no chunks BY
--     DESIGN and read the G&D pool's. Marking them would break working books.
--   * anything whose extract_status is already set to something other than
--     'ready'. A server-OCR document mid-flight is legitimately 'processing' and
--     under-chunked; a previously-marked failure is already correct. This
--     exclusion is also what makes the file idempotent.
--   * documents with fewer than 20 pages, and documents with no page_count -
--     dedup.ineligible does not judge those either, and without a page count
--     there is no ratio to judge against.
CREATE OR REPLACE VIEW dedup.partial_extractions AS
SELECT
  d.id                         AS document_id,
  d.user_id,
  d.file_name,
  d.page_count,
  d.created_at,
  d.extract_status,
  d.storage_path,
  count(dc.id)::int            AS chunk_count,
  CASE
    WHEN count(dc.id) = 0 THEN 'no chunks at all - the extraction never wrote one'
    ELSE 'far too few chunks for its page count - probably a partial extraction'
  END                          AS reason
FROM public.documents d
LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
WHERE d.pooled_document_id IS NULL
  AND (d.extract_status IS NULL OR d.extract_status = 'ready')
  AND d.page_count >= 20
GROUP BY d.id
HAVING count(dc.id) < d.page_count / 20.0;

REVOKE ALL ON dedup.partial_extractions FROM anon, authenticated;


-- ─── 2. PREVIEW: the headline ─────────────────────────────────────────────────
-- READ ONLY. Nothing has changed yet. Look at this before block 5.
SELECT
  count(*)                                          AS documents_to_mark,
  count(*) FILTER (WHERE chunk_count = 0)           AS with_no_chunks,
  count(*) FILTER (WHERE chunk_count = 100)         AS stuck_at_exactly_100,
  count(DISTINCT user_id)                           AS students_affected,
  sum(page_count)                                   AS pages_they_claim,
  sum(chunk_count)                                  AS chunks_they_actually_hold
FROM dedup.partial_extractions;


-- ─── 3. PREVIEW: itemised ─────────────────────────────────────────────────────
-- READ ONLY. This is the exact list block 5 will touch, worst first. Read it.
-- A document here answers questions about roughly (chunk_count * 2.5) pages of
-- the page_count it claims, and silently returns nothing about the rest.
SELECT
  document_id,
  file_name,
  page_count,
  chunk_count,
  round(100.0 * chunk_count / GREATEST(page_count / 20.0, 1), 1) AS pct_of_expected_minimum,
  extract_status                                                 AS current_status,
  created_at,
  reason
FROM dedup.partial_extractions
ORDER BY page_count DESC NULLS LAST, chunk_count;


-- ─── 4. Snapshot, so block 7 can undo this exactly ────────────────────────────
-- Which rows were NULL and which were 'ready' is not recoverable from the rows
-- themselves once they all say 'error'. Record it first.
CREATE TABLE IF NOT EXISTS public.extract_repair_backup (
  document_id      UUID PRIMARY KEY,
  extract_status   TEXT,
  extract_error    TEXT,
  chunk_count      INT,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.extract_repair_backup FROM anon, authenticated;

INSERT INTO public.extract_repair_backup (document_id, extract_status, extract_error, chunk_count)
SELECT p.document_id, d.extract_status, d.extract_error, p.chunk_count
FROM dedup.partial_extractions p
JOIN public.documents d ON d.id = p.document_id
ON CONFLICT (document_id) DO NOTHING;   -- keep the FIRST capture, never overwrite

SELECT count(*) AS rows_backed_up FROM public.extract_repair_backup;


-- ─── 5. THE REPAIR ────────────────────────────────────────────────────────────
-- This is the only block that writes to `documents`. Run it once you are happy
-- with blocks 2 and 3.
--
-- 'error' is the right value, not 'processing': nothing is going to finish this
-- document. Every reader already treats 'error' as unusable - last-minute and
-- connect-dots skip anything that is not 'ready', the mobile Library and Links
-- screens show the extract_error text under the file, the web Library card now
-- shows a "Failed" pill and the message, and dedup.plan holds it out of merges.
--
-- The message is written for a student, not for us: it says what happened, what
-- it means for them, and the one action that fixes it.
--
-- content_hash is deliberately LEFT ALONE. It is tempting to null it so these
-- copies can never be chosen as somebody's canonical, but it is not needed and
-- not free: the hash on these rows was computed by the dedup fingerprint stage
-- from the chunks they ACTUALLY hold, so it describes a 100-chunk stub and can
-- never match a future complete upload of the same book; meanwhile nulling the
-- hash of a document that is already somebody's canonical would break the
-- invariant documents_check_canonical_link exists to hold. Marking the status is
-- enough - dedup.plan already refuses to merge anything that is not 'ready'.
UPDATE public.documents d
SET
  extract_status = 'error',
  extract_error  =
    'This file was only partly saved when it was uploaded (a bug we have since fixed), '
    || 'so searching it would miss most of the book and answers about it would be wrong or empty. '
    || 'The original file was not kept on our servers, so we cannot repair it here - '
    || 'please delete this file and upload it again.'
FROM dedup.partial_extractions p
WHERE d.id = p.document_id
  -- Re-asserted against `documents` rather than trusting the view alone, so this
  -- statement is idempotent even if it is run twice in one session.
  AND (d.extract_status IS NULL OR d.extract_status = 'ready')
RETURNING d.id, d.file_name, d.page_count, p.chunk_count, d.extract_status;


-- ─── 6. VERIFY ────────────────────────────────────────────────────────────────
-- The view excludes anything not NULL/'ready', so after block 5 it must be
-- empty. Expect 0. Re-running blocks 4 and 5 now is a no-op.
SELECT count(*) AS still_unmarked FROM dedup.partial_extractions;

-- And the marked rows, for the record.
SELECT d.id, d.file_name, d.page_count, d.extract_status, b.extract_status AS was
FROM public.extract_repair_backup b
JOIN public.documents d ON d.id = b.document_id
ORDER BY d.page_count DESC NULLS LAST;


-- ─── 7. ROLLBACK ──────────────────────────────────────────────────────────────
-- Restores the exact prior extract_status / extract_error of every row block 5
-- touched. Run only if this repair was a mistake.
--
--   UPDATE public.documents d
--   SET extract_status = b.extract_status,
--       extract_error  = b.extract_error
--   FROM public.extract_repair_backup b
--   WHERE d.id = b.document_id
--     AND d.extract_status = 'error';
--
-- Then, to remove this file's artifacts entirely:
--
--   DROP TABLE IF EXISTS public.extract_repair_backup;
--   DROP VIEW  IF EXISTS dedup.partial_extractions;
--
-- Keep both until the repaired books have been re-uploaded; the backup table is
-- a few rows and it is the only record of what these documents used to claim.
