-- Part-aware OCR jobs: large scanned PDFs (up to ~200 MB) are now SPLIT on the
-- web client into <=45 MB parts before upload (see src/lib/server-ocr.ts), so
-- no single storage object exceeds the bucket's 50 MB limit and no edge-function
-- isolate (256 MB) ever has to hold a whole textbook. Each job downloads only
-- its own part instead of re-downloading the entire book, which previously cost
-- O(jobs * fileSize) of egress (a 200 MB book x 160 jobs = ~32 GB).
--
-- Two new columns carry the split:
--   * storage_path    - the PART file this job's pages live in. NULL means
--                       "use the document's own storage_path" - the pre-split
--                       single-file layout, kept so any in-flight jobs created
--                       before this migration still resolve.
--   * part_first_page - the ABSOLUTE document page number that is page 1 of that
--                       part file. The worker maps each absolute page in
--                       [page_start, page_end] to a page inside the part via
--                       (absolutePage - part_first_page + 1). page_start /
--                       page_end stay ABSOLUTE so labels, chunk_index, and the
--                       ocr_pages_done/total progress rollup are all unchanged.
--
-- claim_ocr_job / complete_ocr_job need no changes: they RETURN j.* (so the new
-- columns flow through to the worker automatically) and only ever read the
-- absolute page_start/page_end.

ALTER TABLE public.ocr_jobs
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS part_first_page INT NOT NULL DEFAULT 1;
