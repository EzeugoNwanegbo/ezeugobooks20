-- Links feature — cross-document synthesis ("connect the dots").
--
-- Reuses the existing documents + document_chunks + embeddings pipeline. This
-- migration adds:
--   1. extract_status / extract_error on documents so the app can show a per-file
--      Uploading -> Extracting -> Ready (or Rejected) state, and so the
--      anti-textbook page-count guard can reject a file with a clear reason.
--   2. a document_links cache table holding the DeepSeek synthesis result for a
--      given set of documents, keyed by a hash of the sorted document ids.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extract_status TEXT,
  ADD COLUMN IF NOT EXISTS extract_error TEXT;

-- Cached synthesis result for one set of documents.
CREATE TABLE IF NOT EXISTS public.document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Sorted document ids that produced this synthesis.
  doc_ids UUID[] NOT NULL,
  -- Stable hash of the sorted doc id set; lets us upsert/return a cached result.
  doc_set_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, doc_set_hash)
);

ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own links" ON public.document_links;
DROP POLICY IF EXISTS "Users insert own links" ON public.document_links;
DROP POLICY IF EXISTS "Users update own links" ON public.document_links;
DROP POLICY IF EXISTS "Users delete own links" ON public.document_links;

CREATE POLICY "Users view own links" ON public.document_links
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own links" ON public.document_links
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own links" ON public.document_links
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own links" ON public.document_links
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_document_links_user
  ON public.document_links(user_id, updated_at DESC);
