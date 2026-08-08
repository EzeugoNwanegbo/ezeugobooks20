-- Chunk de-duplication, stage 2 of 5: FINGERPRINT. Computes the identity key.
--
-- Writes exactly one derived column - documents.content_hash - and nothing else.
-- No links, no deletions, no behaviour change: content_hash is inert until stage
-- 4 reads it. Undo is `update public.documents set content_hash = NULL;`.
--
-- WHY THIS IS ITS OWN STAGE
-- -------------------------
-- The fingerprint is the answer to "how do you know two textbooks are the same",
-- so everything downstream depends on it - the preview's numbers, the merge, the
-- final pre-delete re-check, and the forward path where a new upload matches an
-- existing book. Computing it once and storing it means:
--   * the preview is a fast read instead of a 380 MB hash, so it can be re-run
--     and argued about freely;
--   * the merge and the preview cannot disagree, because they read the same
--     stored value rather than each recomputing one;
--   * new uploads can be matched against the existing corpus at all -
--     find_canonical_document() looks up content_hash, so a document without one
--     can never be re-used and the next student to upload that book stores a
--     fresh 3 MB copy of it.
--
-- WHAT IT HASHES
-- --------------
-- The extracted text, as stored, not the file bytes. Full rationale and the
-- exact format are in the column comment written by stage 1; the short version
-- is that the text is the only thing we keep and the only thing search reads, so
-- identical text is the strongest statement of sameness that is actually
-- meaningful here.
--
-- COST AND THE TIMEOUT RISK
-- -------------------------
-- Hashing the whole corpus streams roughly 380 MB of chunk text through the
-- server. Two things could go wrong and both are handled:
--
--   * MEMORY. The natural formulation, md5(string_agg(content, '' ORDER BY
--     chunk_index)), builds the document's entire text as one value - megabytes
--     per row, several alive at once inside a GROUP BY. On a free-tier instance
--     already at its size ceiling that is a needless risk, so
--     public.document_chunkset_digest() hashes each chunk and then hashes the resulting
--     fixed-width lines. Peak memory is a few KB per document. The result is
--     just as decisive: any difference in any chunk's bytes, order, index or
--     page label changes the digest.
--
--   * STATEMENT TIMEOUT. A single UPDATE over every document would run for
--     minutes and this project has been bitten by that before (see the repo's
--     "survive statement timeouts on huge books" work and the batched OCR job
--     design in 20260709120000_ocr_jobs_parts.sql). So the work is a batch
--     function called in a loop: each call commits on its own, whatever finished
--     stays finished, and an interrupted run is resumed by simply calling it
--     again. Nothing needs to be undone if you stop halfway.
--
-- ROLLBACK
--   update public.documents set content_hash = NULL;
--   -- (Only do this before stage 4. After links exist, clearing content_hash
--   -- leaves them intact but makes the guard trigger reject any repair.)


-- ─── 2a. Optional: give the batches room ──────────────────────────────────────
-- 100 documents is small, but a batch that happens to contain several 3,000-page
-- books can still run for a while. Raising the timeout for this session only is
-- cheaper than tuning the batch size by trial and error.
SET statement_timeout = '10min';


-- ─── 2b. Fingerprint the corpus, one batch at a time ──────────────────────────
-- Run this line repeatedly until it returns 0. Each call stamps up to 100
-- documents. With ~530 documents holding chunks, expect around six calls.
--
--   SELECT dedup.fingerprint_batch(100);
--
-- If a batch times out, lower the argument (try 25) and carry on - nothing is
-- lost, the committed rows keep their hashes.
SELECT dedup.fingerprint_batch(100) AS documents_fingerprinted;

-- Prefer to sit and wait rather than click six times? This does the same thing
-- in one call, still committing nothing until it finishes, so it is the version
-- that a timeout would waste work on. Use it only if the batch loop is proving
-- tedious and you have raised statement_timeout above.
--
--   DO $$
--   DECLARE n INT;
--   BEGIN
--     LOOP
--       n := dedup.fingerprint_batch(100);
--       EXIT WHEN n = 0;
--       RAISE NOTICE 'fingerprinted % documents', n;
--     END LOOP;
--   END $$;


-- ─── 2c. Progress ─────────────────────────────────────────────────────────────
-- Keep calling 2b until still_unhashed reaches 0.
SELECT
  count(*) FILTER (WHERE d.content_hash IS NULL)     AS still_unhashed,
  count(*) FILTER (WHERE d.content_hash IS NOT NULL) AS hashed
FROM public.documents d
WHERE d.canonical_document_id IS NULL
  AND EXISTS (SELECT 1 FROM public.document_chunks dc WHERE dc.document_id = d.id);


-- ─── 2d. Sanity check on the fingerprint itself ───────────────────────────────
-- Before trusting the hash to decide what gets deleted, confirm it behaves.
--
-- (i) Distinct hashes should be close to distinct documents. If this shows one
--     hash covering an implausible number of documents, something is wrong with
--     the hash (or a lot of documents are near-empty - which is why stage 1's
--     eligibility rules exclude anything under 1,000 characters).
SELECT
  count(*)                        AS documents_hashed,
  count(DISTINCT d.content_hash)  AS distinct_hashes,
  count(*) - count(DISTINCT d.content_hash) AS redundant_copies_implied
FROM public.documents d
WHERE d.content_hash IS NOT NULL
  AND d.canonical_document_id IS NULL;

-- (ii) Documents that share a hash but DISAGREE on file_size, page_count or
--      chunk count. Should be empty. A row here means the hash considers two
--      documents identical while their metadata says otherwise - do not proceed;
--      investigate before running any merge.
SELECT
  s.content_hash,
  count(*)                        AS copies,
  count(DISTINCT s.file_size)     AS distinct_file_sizes,
  count(DISTINCT s.page_count)    AS distinct_page_counts,
  count(DISTINCT s.chunk_count)   AS distinct_chunk_counts,
  min(s.text_chars)               AS min_chars
FROM dedup.doc_stats s
WHERE s.content_hash IS NOT NULL
GROUP BY s.content_hash
HAVING count(*) > 1
   AND (count(DISTINCT s.file_size) > 1
     OR count(DISTINCT s.page_count) > 1
     OR count(DISTINCT s.chunk_count) > 1);

-- (iii) What the eligibility rules are holding back, and why. These documents
--       will not merge no matter what their hash says. Read the list: if a real
--       textbook appears here, the reason column says which rule caught it and
--       whether that rule needs adjusting.
SELECT reason, count(*) AS documents, sum(chunk_count) AS chunks
FROM dedup.ineligible
GROUP BY reason
ORDER BY count(*) DESC;

SELECT file_name, chunk_count, page_count, text_chars, reason
FROM dedup.ineligible
ORDER BY chunk_count DESC
LIMIT 50;

RESET statement_timeout;
