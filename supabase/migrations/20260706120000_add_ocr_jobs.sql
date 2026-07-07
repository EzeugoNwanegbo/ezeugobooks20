-- Server-side OCR queue for large scanned PDFs (web Library, > 50 pages).
--
-- Edge functions get ~150 s of wall clock, so OCR-ing a whole scanned book in
-- one invocation is impossible. Instead:
--   1. the `ocr-enqueue` function splits a document into small page-range jobs
--      (rows in ocr_jobs) and marks the document extract_status='processing',
--   2. each `ocr-worker` invocation atomically claims exactly ONE job
--      (claim_ocr_job below, FOR UPDATE SKIP LOCKED so concurrent invocations
--      never double-process), OCRs that range, writes its chunks idempotently,
--      and records completion via complete_ocr_job,
--   3. the queue drains via pg_cron poking ocr-worker every minute (optional,
--      see the bottom of this file) AND via the web client poking it while it
--      polls progress - whichever fires first.
--
-- Progress lives on documents (ocr_pages_done / ocr_pages_total) so the web
-- client can render a page-level progress bar with its existing RLS access.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ocr_pages_done INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_pages_total INT;

CREATE TABLE IF NOT EXISTS public.ocr_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  -- pending | processing | done | error
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status ON public.ocr_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_document ON public.ocr_jobs(document_id);

ALTER TABLE public.ocr_jobs ENABLE ROW LEVEL SECURITY;

-- Users may WATCH their own jobs (handy for debugging); only the service role
-- (the edge functions) ever writes them, and service role bypasses RLS.
DROP POLICY IF EXISTS "Users view own ocr jobs" ON public.ocr_jobs;
CREATE POLICY "Users view own ocr jobs" ON public.ocr_jobs
  FOR SELECT USING (auth.uid() = user_id);

-- Atomically claim one runnable job. SKIP LOCKED means any number of
-- concurrent ocr-worker invocations (cron tick + several client pokes) each
-- get a DIFFERENT job or nothing - never the same one twice.
--
-- "Runnable" covers two cases:
--   - status='pending' (fresh or returned after a soft failure), and
--   - status='processing' but stale (> 3 min old): the worker that claimed it
--     was killed by the platform before it could finish or fail the job.
-- Jobs that have already burned 3 attempts are reaped to 'error' here (their
-- document goes to extract_status='error' too), because a worker that crashes
-- hard never gets the chance to report its own failure.
CREATE OR REPLACE FUNCTION public.claim_ocr_job(p_document_id UUID DEFAULT NULL)
RETURNS SETOF public.ocr_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reap jobs that keep dying without reporting back.
  WITH dead AS (
    UPDATE public.ocr_jobs j
       SET status = 'error',
           error = COALESCE(j.error, 'OCR worker crashed repeatedly on this page range.'),
           updated_at = NOW()
     WHERE j.attempts >= 3
       AND (j.status = 'pending'
            OR (j.status = 'processing' AND j.updated_at < NOW() - INTERVAL '3 minutes'))
    RETURNING j.document_id
  )
  UPDATE public.documents d
     SET extract_status = 'error',
         extract_error = 'OCR failed part-way through this document. Delete it and try again, or split the PDF into smaller parts.'
   WHERE d.id IN (SELECT document_id FROM dead);

  -- Claim: prefer the requested document (client pokes pass their own id so
  -- their wall time goes to their file), then fall back to any runnable job
  -- so pokes and cron ticks still drain the global queue.
  RETURN QUERY
  UPDATE public.ocr_jobs j
     SET status = 'processing', attempts = j.attempts + 1, updated_at = NOW()
   WHERE j.id = (
     SELECT c.id FROM public.ocr_jobs c
      WHERE c.attempts < 3
        AND (c.status = 'pending'
             OR (c.status = 'processing' AND c.updated_at < NOW() - INTERVAL '3 minutes'))
        AND (p_document_id IS NULL OR c.document_id = p_document_id)
      ORDER BY c.created_at, c.page_start
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING j.*;

  IF NOT FOUND AND p_document_id IS NOT NULL THEN
    RETURN QUERY
    UPDATE public.ocr_jobs j
       SET status = 'processing', attempts = j.attempts + 1, updated_at = NOW()
     WHERE j.id = (
       SELECT c.id FROM public.ocr_jobs c
        WHERE c.attempts < 3
          AND (c.status = 'pending'
               OR (c.status = 'processing' AND c.updated_at < NOW() - INTERVAL '3 minutes'))
        ORDER BY c.created_at, c.page_start
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING j.*;
  END IF;
END;
$$;

-- Record a finished (or failed) job and roll the aggregate progress up onto
-- the document in the same transaction, so two workers finishing at once
-- can't leave documents.ocr_pages_done behind the truth. Returns the counts
-- the worker needs to decide whether to finalise the document (assemble
-- extracted_text + mark 'ready' - the worker does that, not this function,
-- because assembly needs the chunk contents).
CREATE OR REPLACE FUNCTION public.complete_ocr_job(p_job_id UUID, p_error TEXT DEFAULT NULL)
RETURNS TABLE(doc_id UUID, pages_done INT, pages_total INT, remaining INT, failed INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc UUID;
  v_done INT;
  v_remaining INT;
  v_failed INT;
BEGIN
  UPDATE public.ocr_jobs j
     SET status = CASE WHEN p_error IS NULL THEN 'done' ELSE 'error' END,
         error = p_error,
         updated_at = NOW()
   WHERE j.id = p_job_id
  RETURNING j.document_id INTO v_doc;
  IF v_doc IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(j.page_end - j.page_start + 1) FILTER (WHERE j.status = 'done'), 0)::INT,
         COUNT(*) FILTER (WHERE j.status IN ('pending', 'processing'))::INT,
         COUNT(*) FILTER (WHERE j.status = 'error')::INT
    INTO v_done, v_remaining, v_failed
    FROM public.ocr_jobs j
   WHERE j.document_id = v_doc;

  UPDATE public.documents d
     SET ocr_pages_done = v_done,
         extract_status = CASE WHEN v_failed > 0 THEN 'error' ELSE d.extract_status END,
         extract_error = CASE
           WHEN v_failed > 0 THEN COALESCE(p_error, d.extract_error, 'OCR failed on part of this document.')
           ELSE d.extract_error
         END
   WHERE d.id = v_doc;

  RETURN QUERY
  SELECT v_doc, v_done, d.ocr_pages_total, v_remaining, v_failed
    FROM public.documents d
   WHERE d.id = v_doc;
END;
$$;

-- Only the edge functions (service role) may run the queue machinery -
-- without this, any authenticated user could claim/complete jobs via RPC.
REVOKE ALL ON FUNCTION public.claim_ocr_job(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_ocr_job(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cadence: poke ocr-worker once a minute while any job is runnable.
--
-- OPTIONAL - requires the pg_cron and pg_net extensions (Dashboard →
-- Database → Extensions) plus two Vault secrets (Dashboard → Settings →
-- Vault): 'project_url' (https://<ref>.supabase.co) and 'anon_key'. If any of
-- those are missing this block just logs a NOTICE and the queue still drains
-- via the web client, which pokes the worker while it polls progress - it is
-- only unattended draining (user closed the tab) that needs cron.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.schedule(
      'ocr-worker-drain',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
               || '/functions/v1/ocr-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' ||
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
        ),
        body := '{}'::jsonb
      )
      -- Skip entirely when there is nothing runnable or the secrets are absent.
      WHERE EXISTS (
        SELECT 1 FROM public.ocr_jobs
         WHERE status = 'pending'
            OR (status = 'processing' AND updated_at < NOW() - INTERVAL '3 minutes')
      )
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'anon_key');
      $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron/pg_net not enabled - OCR queue only drains while a web client is polling. Enable both extensions and re-run this block (or the cron.schedule call) for unattended draining.';
  END IF;
END $$;
