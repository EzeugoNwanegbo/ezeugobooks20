-- Chunk de-duplication, stage 1 of 5: schema, guards, RLS and consumers.
--
-- Run order (each file explains itself; nothing here is automatic):
--   1  20260808120000_dedup_document_chunks_schema.sql     schema + RLS   (safe)
--   2  20260808120100_dedup_fingerprint.sql                compute hashes (safe)
--   3  20260808120200_dedup_preview_readonly.sql           look           (read-only)
--   4  20260808120300_dedup_backfill_links.sql             link           (reversible)
--   5  20260808120400_dedup_delete_redundant_chunks.sql    delete         (armed manually)
--
-- WHY THIS EXISTS
-- ---------------
-- Every student who uploads "Guyton and Hall 13e" gets their own private copy of
-- its chunks. document_chunks is 59,933 rows / ~380 MB and 51% of those rows are
-- byte-identical re-uploads of a book somebody else already stored. On a 500 MB
-- Supabase free tier that is the difference between working and locked.
--
-- The fix is to let several documents rows resolve to ONE set of chunks.
--
-- WHY canonical_document_id (a self-reference on documents) AND NOT A BLOB TABLE
-- ----------------------------------------------------------------------------
-- The obvious alternative is a `document_content` table holding the chunks, with
-- documents.content_id pointing at it. It is arguably the "purer" model, but it
-- costs far more here:
--   * document_chunks.document_id would have to be repointed to a new parent for
--     all 59,933 rows and its UNIQUE (document_id, chunk_index) rebuilt - a full
--     table rewrite on a database that has no headroom to rewrite anything.
--   * EVERY consumer (two search RPCs, the promote-to-library function, the OCR
--     worker, extract-pdf, the StudyBody span query, the mobile app) selects by
--     document_id today. A blob table renames the join key everywhere at once.
--   * The mobile app ships separately from the web app, so a schema change that
--     forces a client change is a change we cannot fully roll out.
-- canonical_document_id keeps document_id as the join key, so the resolution is a
-- single COALESCE(d.canonical_document_id, d.id) inside functions the clients
-- already call. Consumers that go through the RPCs need NO code change at all.
--
-- NULL canonical_document_id means "I am canonical; my chunks live under my id".
-- Non-NULL means "my chunks are the chunks of that other document". Links are
-- exactly one level deep - see the guard trigger below.
--
-- THIS FILE IS SAFE AND REVERSIBLE. It adds columns, indexes, triggers, views
-- and replaces four functions. It moves no data and deletes nothing. The later
-- stages are separate files, deliberately, so that a schema change and a
-- 30,000-row delete never share a transaction on a database that is over its
-- size ceiling.
--
-- ROLLBACK
-- --------
--   drop view if exists public.document_chunks_effective;
--   drop trigger if exists documents_canonical_guard on public.documents;
--   drop trigger if exists documents_reparent_canonical on public.documents;
--   drop function if exists public.documents_check_canonical_link();
--   drop function if exists public.documents_reparent_canonical();
--   drop function if exists public.find_canonical_document(text);
--   drop function if exists public.refresh_document_content_hash(uuid);
--   drop function if exists public.document_chunkset_digest(uuid);
--   drop schema if exists dedup cascade;
--   drop policy if exists "Users view own or linked document chunks" on public.document_chunks;
--   create policy "Users view own document chunks" on public.document_chunks
--     for select using (auth.uid() = user_id);
--   drop policy if exists "Users insert own document chunks" on public.document_chunks;
--   create policy "Users insert own document chunks" on public.document_chunks
--     for insert with check (auth.uid() = user_id);
--   alter table public.documents
--     drop column if exists canonical_document_id,
--     drop column if exists content_hash;
--   -- then re-run 20260608000100_add_chunk_embeddings.sql and
--   -- 20260719130000_promote_to_library.sql to restore the old function bodies.
-- Rolling this back is only safe BEFORE stage 4 has deleted anything. Once the
-- redundant chunks are gone, dropping canonical_document_id strands the students
-- who link through it.


-- ─── 1. Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
  -- NULL = "I am canonical". Non-NULL = "read my chunks from that document".
  -- ON DELETE SET NULL is a backstop only: the reparent trigger below moves the
  -- chunks to a surviving dependent before the delete happens, so in practice
  -- this never fires with dependents still attached.
  ADD COLUMN IF NOT EXISTS canonical_document_id UUID
    REFERENCES public.documents(id) ON DELETE SET NULL,
  -- THE IDENTITY KEY. One meaning, always, for both existing rows and future
  -- uploads: a fingerprint of the EXTRACTED TEXT as it is actually stored, never
  -- of the file bytes.
  --
  -- That choice is the whole safety argument. We are not trying to prove two
  -- uploaded PDFs were the same file - we cannot, the files were never stored,
  -- and it would be the wrong question anyway. We need the extracted text to be
  -- identical, because the text is the only thing we keep and the only thing
  -- search reads. If two documents produced byte-identical chunk text in the
  -- same order with the same page labels, then serving one student the other's
  -- chunks cannot change a single answer, citation or page number they see.
  -- (A file-byte hash would be worse on both counts: a re-saved or re-compressed
  -- PDF has different bytes and identical text, and identical bytes still say
  -- nothing about how a given extractor version chunked them.)
  --
  -- Exact format - the browser must reproduce this byte for byte, see
  -- src/lib/content-hash.ts:
  --
  --   'chunkset-sha256-v1:' || sha256hex( join('\n', lines) )
  --   where line_i = chunk_index || '|' || page_start || '|' || page_end || '|'
  --                                     || sha256hex(content)
  --   over all chunks of the document, ordered by chunk_index, with NULL page
  --   numbers rendered as the empty string.
  --
  -- Two deliberate details:
  --   * It hashes each chunk and then hashes the LINES, rather than hashing one
  --     giant string_agg of all the content. The result is just as decisive, but
  --     peak memory is a few KB per document instead of the whole book (a 6 MB
  --     textbook materialises a 6 MB text value per row under string_agg, and
  --     this database has no memory to spare). See public.document_chunkset_digest below.
  --   * chunk_index and the page numbers are inside the hash, so a document with
  --     gaps, duplicated indexes or different page labels can never collide with
  --     a cleanly-extracted one even if the prose matches.
  --
  -- 'v1' is a version tag on the algorithm. If the chunker or the format ever
  -- changes, bump it rather than letting old and new hashes mingle.
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

COMMENT ON COLUMN public.documents.canonical_document_id IS
  'NULL = this document owns its chunks. Non-NULL = read chunks from that document instead. One level only; enforced by documents_canonical_guard.';
COMMENT ON COLUMN public.documents.content_hash IS
  'chunkset-sha256-v1:<hex>. Fingerprint of the stored extracted text (per-chunk sha256 over chunk_index|page_start|page_end|sha256(content), joined by newlines, hashed again). Never a hash of the file bytes. Identical value = merging is provably invisible to every consumer.';

-- Lookup path for "is there already a canonical copy of this content?".
CREATE INDEX IF NOT EXISTS idx_documents_content_hash
  ON public.documents(content_hash)
  WHERE content_hash IS NOT NULL;

-- Serves the RLS EXISTS() below: given a user, which documents of theirs are
-- links, and to what. Partial so it stays tiny (most documents are canonical).
CREATE INDEX IF NOT EXISTS idx_documents_user_canonical
  ON public.documents(user_id, canonical_document_id)
  WHERE canonical_document_id IS NOT NULL;

-- Serves the reparent trigger: "does anyone link to the row being deleted?".
CREATE INDEX IF NOT EXISTS idx_documents_canonical
  ON public.documents(canonical_document_id)
  WHERE canonical_document_id IS NOT NULL;


-- The fingerprint of one document, computed from what is actually stored.
--
-- Deliberately NOT md5(string_agg(content, '' ORDER BY chunk_index)). That form
-- is the obvious one and it is correct, but it materialises a document's entire
-- text as a single value - 6 MB for a big textbook, and several alive at once
-- inside a GROUP BY over ~60,000 rows. This instance is at its size ceiling and
-- has whatever work_mem the free tier gives; spilling or running out of memory
-- during the one operation meant to rescue it is not a risk worth taking.
-- Hashing per chunk and then hashing the fixed-width lines is just as decisive
-- and holds a few KB at a time.
--
-- chunk_index and the page numbers are part of each hashed line, so gaps,
-- duplicate indexes or differing page labels change the digest. (Duplicate
-- indexes are already impossible - UNIQUE (document_id, chunk_index) - but gaps
-- are not: ocr-worker deletes and re-inserts by page range, so a job that never
-- completed can leave a hole. dedup.plan excludes those outright as well.)
--
-- Lives in public rather than the dedup schema because the delete-path trigger
-- below depends on it, and dedup is a scratch schema the owner is invited to
-- drop once the migration is finished. Not granted to clients: it is an internal
-- helper, not an API.
--
-- Must produce the same hex string as src/lib/content-hash.ts.
CREATE OR REPLACE FUNCTION public.document_chunkset_digest(p_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        COALESCE(
          string_agg(
            dc.chunk_index::text || '|'
              || COALESCE(dc.page_start::text, '') || '|'
              || COALESCE(dc.page_end::text, '') || '|'
              || encode(sha256(convert_to(dc.content, 'UTF8')), 'hex'),
            E'\n' ORDER BY dc.chunk_index
          ),
          ''
        ),
        'UTF8'
      )
    ),
    'hex'
  )
  FROM public.document_chunks dc
  WHERE dc.document_id = p_document_id;
$$;

REVOKE ALL ON FUNCTION public.document_chunkset_digest(UUID) FROM PUBLIC, anon, authenticated;


-- ─── 2. The write guard on canonical_document_id ──────────────────────────────
--
-- This is the load-bearing part of the security story and it must be read
-- together with the RLS policy in section 3.
--
-- documents already has "Users update own docs" FOR UPDATE USING (auth.uid() =
-- user_id) with no column restriction. So without this trigger a student could
-- run:
--     update documents set canonical_document_id = '<some other student's doc>'
--     where id = '<my doc>';
-- ...and the new RLS policy would then hand them that student's entire textbook.
-- The trigger closes exactly that hole: a link may only be created when the
-- linking row's content_hash already equals the target's content_hash.
--
-- Why that is enough: content_hash is a SHA-256 of the target's chunk contents.
-- To set your row's content_hash to the victim's value you must already know
-- that value, and the only ways to know it are (a) to possess the same file and
-- hash it yourself, or (b) to invert SHA-256. In case (a) the "attack" gains the
-- attacker a copy of a book they already have - which is precisely the intended
-- feature. content_hash is not readable across users (documents RLS is
-- auth.uid() = user_id), so it cannot be copied off another row.
--
-- The function is SECURITY DEFINER because it must read the TARGET document row,
-- which belongs to another user and is invisible under the caller's RLS.
CREATE OR REPLACE FUNCTION public.documents_check_canonical_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_hash      TEXT;
  v_target_canonical UUID;
  v_target_exists    BOOLEAN;
BEGIN
  -- Unlinking is always allowed (it can only reduce what you can read).
  IF NEW.canonical_document_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.canonical_document_id IS NOT DISTINCT FROM OLD.canonical_document_id THEN
    RETURN NEW; -- unchanged; nothing to re-check
  END IF;

  -- No end-user JWT means this is a migration, the SQL editor, a service_role
  -- request or one of our own SECURITY DEFINER helpers (the reparent trigger).
  -- Those are trusted; the anon role cannot reach here because documents' own
  -- RLS (auth.uid() = user_id) rejects the row before the trigger fires.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.canonical_document_id = NEW.id THEN
    RAISE EXCEPTION 'a document cannot be its own canonical copy';
  END IF;

  SELECT TRUE, d.content_hash, d.canonical_document_id
    INTO v_target_exists, v_target_hash, v_target_canonical
  FROM public.documents d
  WHERE d.id = NEW.canonical_document_id;

  IF NOT COALESCE(v_target_exists, FALSE) THEN
    RAISE EXCEPTION 'canonical document % does not exist', NEW.canonical_document_id;
  END IF;

  -- One level only. Chains would need recursive resolution in every consumer and
  -- would make a cycle possible; both are avoidable by simply forbidding them.
  IF v_target_canonical IS NOT NULL THEN
    RAISE EXCEPTION 'cannot link to a document that is itself a link';
  END IF;

  -- ...and this row must not already be someone else's canonical, or their
  -- chunks would disappear behind a second hop.
  IF EXISTS (SELECT 1 FROM public.documents d WHERE d.canonical_document_id = NEW.id) THEN
    RAISE EXCEPTION 'this document is the canonical copy for other documents and cannot become a link';
  END IF;

  IF NEW.content_hash IS NULL
     OR v_target_hash IS NULL
     OR NEW.content_hash <> v_target_hash THEN
    RAISE EXCEPTION 'content_hash must match the canonical document to link to it';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_canonical_guard ON public.documents;
CREATE TRIGGER documents_canonical_guard
  BEFORE INSERT OR UPDATE OF canonical_document_id, content_hash ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_check_canonical_link();


-- ─── 3. Deleting a canonical copy must not take everyone else's book ──────────
--
-- Sharing chunks creates a new failure mode that did not exist before: if the
-- student who happens to own the canonical copy deletes their file, the FK
-- cascade would delete the chunks and every student linked to it silently loses
-- their textbook. Refusing the delete (ON DELETE RESTRICT) would be a bug from
-- the owner's point of view - it is *their* file.
--
-- So instead we hand the chunks over. Before the row goes away we promote the
-- oldest dependent to canonical, move the chunk rows onto it (updating user_id
-- so "own chunks" stays coherent and that student's embedding backfill can still
-- reach them) and re-point the remaining dependents at the new canonical.
CREATE OR REPLACE FUNCTION public.documents_reparent_canonical()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_heir_id   UUID;
  v_heir_user UUID;
  v_heir_hash TEXT;
BEGIN
  -- Fast path for the overwhelmingly common case (nobody links to this row).
  SELECT d.id, d.user_id INTO v_heir_id, v_heir_user
  FROM public.documents d
  WHERE d.canonical_document_id = OLD.id
  ORDER BY d.created_at ASC, d.id ASC
  LIMIT 1;

  IF v_heir_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- The heir is a link, so by construction it holds no chunks of its own. Clear
  -- defensively anyway: UNIQUE (document_id, chunk_index) would abort the move.
  DELETE FROM public.document_chunks WHERE document_id = v_heir_id;

  -- Promote first, so the guard trigger sees a valid (canonical, same-hash)
  -- target when the remaining dependents are re-pointed below.
  UPDATE public.documents SET canonical_document_id = NULL WHERE id = v_heir_id;

  UPDATE public.document_chunks
  SET document_id = v_heir_id,
      user_id     = v_heir_user
  WHERE document_id = OLD.id;

  -- The heir now owns the content, so its fingerprint must describe it. This is
  -- also what keeps the guard trigger from rejecting the re-pointing below: the
  -- guard insists a link's content_hash equals its canonical's, and it fires
  -- here too (auth.uid() is the deleting student, not NULL). Rather than teach
  -- the guard an exception - a bypass flag would be a way around the security
  -- check - we simply make the data satisfy it.
  UPDATE public.documents
  SET content_hash = 'chunkset-sha256-v1:' || public.document_chunkset_digest(v_heir_id)
  WHERE id = v_heir_id
  RETURNING content_hash INTO v_heir_hash;

  UPDATE public.documents
  SET canonical_document_id = v_heir_id,
      content_hash          = v_heir_hash
  WHERE canonical_document_id = OLD.id
    AND id <> v_heir_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS documents_reparent_canonical ON public.documents;
CREATE TRIGGER documents_reparent_canonical
  BEFORE DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_reparent_canonical();


-- ─── 4. RLS ───────────────────────────────────────────────────────────────────
--
-- SELECT. The old policy was `auth.uid() = user_id`. After de-duplication a
-- linked student owns no chunk rows at all, so that policy would return zero
-- results for them - i.e. their textbook would vanish. The new policy adds
-- exactly one thing: the chunks of the document THEY link to.
--
-- Why this cannot over-grant:
--   * The added branch is an EXISTS anchored on `d.user_id = auth.uid()`. Only
--     rows the caller owns can ever satisfy it, so the caller can never widen
--     the grant by referring to somebody else's document row.
--   * The extra chunks exposed are precisely those whose document_id appears in
--     canonical_document_id on one of the caller's own documents. That is a set
--     the caller controls the size of - at most one canonical per document they
--     own - not an open-ended join.
--   * The caller cannot aim that pointer at arbitrary content:
--     documents_canonical_guard (section 2) refuses any link whose content_hash
--     does not already equal the target's. Possessing the hash means possessing
--     the content. Without that trigger this policy WOULD over-grant, which is
--     why the two must never be applied separately.
--   * The branch grants SELECT only. INSERT/UPDATE/DELETE stay owner-only below,
--     so a linked student can read the shared chunks but can neither modify nor
--     destroy another student's rows.
DROP POLICY IF EXISTS "Users view own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users view own or linked document chunks" ON public.document_chunks;
CREATE POLICY "Users view own or linked document chunks"
  ON public.document_chunks FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.user_id = auth.uid()
        AND d.canonical_document_id = document_chunks.document_id
    )
  );

-- INSERT is tightened, not loosened: you may still only insert chunks you own,
-- and now only onto a document that is yours AND is canonical. Writing chunks
-- onto a link is always a bug (they would be invisible - resolution reads the
-- canonical - and would waste exactly the space this migration is reclaiming).
-- extract-pdf and ocr-worker use the service role and bypass RLS entirely; this
-- constrains the browser upload path in src/routes/-app.library-page.tsx.
DROP POLICY IF EXISTS "Users insert own document chunks" ON public.document_chunks;
CREATE POLICY "Users insert own document chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_chunks.document_id
        AND d.user_id = auth.uid()
        AND d.canonical_document_id IS NULL
    )
  );

-- UPDATE and DELETE deliberately keep `auth.uid() = user_id`. Note the
-- consequence: a canonical owner can still DELETE their own chunk rows directly
-- and that would empty the book for everyone linked to it. Nothing in the app
-- does that (only extract-pdf/ocr-worker delete chunks, both via the service
-- role, and only for a document they are re-extracting), and the document-level
-- delete path is covered by the reparent trigger in section 3.


-- ─── 5. Resolution helper + the effective-chunks view ─────────────────────────

-- Canonical lookup for the upload path: "do we already store this content?".
-- SECURITY DEFINER because the answer usually lives in another user's row.
-- Safe to expose: the caller must already hold the full chunk-set hash, which
-- means they already hold the content. Returning the uuid alone grants nothing -
-- reading the chunks still requires creating a link, and the guard trigger only
-- permits that when the hashes match.
CREATE OR REPLACE FUNCTION public.find_canonical_document(p_content_hash TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.documents d
  WHERE p_content_hash IS NOT NULL
    AND length(p_content_hash) >= 32          -- never match on '' or a stub
    AND d.content_hash = p_content_hash
    AND d.canonical_document_id IS NULL
    AND EXISTS (SELECT 1 FROM public.document_chunks dc WHERE dc.document_id = d.id)
  -- Prefer the copy that will give the linking student the best experience:
  -- most embedded chunks first (semantic search actually works), then oldest.
  ORDER BY
    (SELECT count(dc.embedding) FROM public.document_chunks dc WHERE dc.document_id = d.id) DESC,
    d.created_at ASC,
    d.id ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_canonical_document(TEXT) TO authenticated;

-- Some consumers read chunks straight off the table by document_id rather than
-- through an RPC (StudyBody's whole-document span sampler, web and mobile). For
-- those, this view is a drop-in rename: it presents the CALLER'S document id
-- while serving the CANONICAL document's chunk rows, so `.in("document_id", ids)`
-- and the per-document grouping downstream keep working unchanged.
--
-- security_invoker = true is essential. Without it the view would run as its
-- owner and bypass RLS on both tables, turning a convenience view into a full
-- cross-tenant leak. With it, the documents join is filtered to the caller's own
-- rows and the chunk rows are filtered by the SELECT policy above - two
-- independent restrictions that both have to hold.
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION
      'document_chunks_effective needs PostgreSQL 15+ for security_invoker views. On 14 or older, replace this view with a SECURITY DEFINER RPC that filters on documents.user_id = auth.uid().';
  END IF;
END
$$;

DROP VIEW IF EXISTS public.document_chunks_effective;
CREATE VIEW public.document_chunks_effective
WITH (security_invoker = true) AS
SELECT
  dc.id,
  d.id                                        AS document_id,   -- the caller's document
  COALESCE(d.canonical_document_id, d.id)     AS source_document_id,
  d.user_id                                   AS document_user_id,
  dc.chunk_index,
  dc.page_start,
  dc.page_end,
  dc.content,
  dc.token_estimate,
  dc.created_at
FROM public.documents d
JOIN public.document_chunks dc
  ON dc.document_id = COALESCE(d.canonical_document_id, d.id);

REVOKE ALL ON public.document_chunks_effective FROM anon, authenticated;
GRANT SELECT ON public.document_chunks_effective TO authenticated;


-- ─── 6. Consumers that resolve document_id server-side ────────────────────────
--
-- Both search RPCs used to start from `document_chunks WHERE user_id =
-- auth.uid()`. That is now wrong twice over: a linked student owns no chunks,
-- and match_document_ids carries THEIR document ids, which no chunk row
-- references. Both are rewritten to start from the caller's documents, resolve
-- each to its canonical, and join chunks from there.
--
-- The security filter moves from "the chunk is mine" to "the document is mine",
-- which is the same guarantee expressed one hop earlier - and it is the only
-- form that survives de-duplication. Both functions stay SECURITY DEFINER, so
-- the WHERE clause below IS the access control; it is not backed up by RLS.
--
-- Note that file_name/folder come from the CALLER'S document row, not the
-- canonical's. Two students may file the same book under different names, and a
-- citation must quote the name the student sees.

CREATE OR REPLACE FUNCTION public.search_document_chunks(
  query_terms TEXT[],
  match_document_ids UUID[] DEFAULT NULL,
  match_count INT DEFAULT 12
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  file_name TEXT,
  folder TEXT,
  chunk_index INT,
  page_start INT,
  page_end INT,
  content TEXT,
  rank INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT LEAST(GREATEST(match_count, 1), 40) AS lim
  ),
  normalized_terms AS (
    SELECT DISTINCT trim(term) AS term
    FROM unnest(COALESCE(query_terms, ARRAY[]::text[])) AS term
    WHERE length(trim(term)) > 2
  ),
  my_documents AS (
    SELECT
      d.id                                    AS doc_id,
      COALESCE(d.canonical_document_id, d.id) AS source_id,
      d.file_name,
      f.name                                  AS folder
    FROM public.documents d
    LEFT JOIN public.folders f ON f.id = d.folder_id
    WHERE d.user_id = auth.uid()
      AND (
        match_document_ids IS NULL
        OR array_length(match_document_ids, 1) IS NULL
        OR d.id = ANY(match_document_ids)
      )
  ),
  scoped_chunks AS (
    SELECT
      dc.id,
      md.doc_id AS document_id,
      md.file_name,
      md.folder,
      dc.chunk_index,
      dc.page_start,
      dc.page_end,
      dc.content
    FROM my_documents md
    JOIN public.document_chunks dc ON dc.document_id = md.source_id
  ),
  matching_terms AS (
    SELECT
      sc.id,
      sc.document_id,
      sc.file_name,
      sc.folder,
      sc.chunk_index,
      sc.page_start,
      sc.page_end,
      sc.content,
      CASE WHEN sc.content ILIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
      + CASE
          WHEN sc.file_name ILIKE '%' || nt.term || '%'
            OR COALESCE(sc.folder, '') ILIKE '%' || nt.term || '%'
          THEN 2
          ELSE 0
        END AS term_rank
    FROM scoped_chunks sc
    JOIN normalized_terms nt
      ON sc.content ILIKE '%' || nt.term || '%'
      OR sc.file_name ILIKE '%' || nt.term || '%'
      OR COALESCE(sc.folder, '') ILIKE '%' || nt.term || '%'
  ),
  scored AS (
    SELECT
      mt.id,
      mt.document_id,
      mt.file_name,
      mt.folder,
      mt.chunk_index,
      mt.page_start,
      mt.page_end,
      mt.content,
      SUM(mt.term_rank)::INT AS rank
    FROM matching_terms mt
    GROUP BY
      mt.id, mt.document_id, mt.file_name, mt.folder,
      mt.chunk_index, mt.page_start, mt.page_end, mt.content
  ),
  results AS (
    SELECT * FROM scored
    UNION ALL
    SELECT
      sc.id,
      sc.document_id,
      sc.file_name,
      sc.folder,
      sc.chunk_index,
      sc.page_start,
      sc.page_end,
      sc.content,
      0::INT AS rank
    FROM scoped_chunks sc
    WHERE NOT EXISTS (SELECT 1 FROM normalized_terms)
  )
  SELECT
    results.id,
    results.document_id,
    results.file_name,
    results.folder,
    results.chunk_index,
    results.page_start,
    results.page_end,
    results.content,
    results.rank
  FROM results
  ORDER BY results.rank DESC, results.chunk_index ASC
  LIMIT (SELECT lim FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.search_document_chunks(TEXT[], UUID[], INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.search_document_chunks_hybrid(
  query_terms TEXT[],
  query_embedding TEXT DEFAULT NULL,
  match_document_ids UUID[] DEFAULT NULL,
  match_count INT DEFAULT 24
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  file_name TEXT,
  folder TEXT,
  chunk_index INT,
  page_start INT,
  page_end INT,
  content TEXT,
  rank INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH params AS (
    SELECT
      LEAST(GREATEST(match_count, 1), 60) AS lim,
      CASE
        WHEN query_embedding IS NULL OR length(trim(query_embedding)) = 0
          THEN NULL
        ELSE query_embedding::vector
      END AS emb
  ),
  normalized_terms AS (
    SELECT DISTINCT lower(trim(term)) AS term
    FROM unnest(COALESCE(query_terms, ARRAY[]::text[])) AS term
    WHERE length(trim(term)) > 2
  ),
  my_documents AS (
    SELECT
      d.id                                    AS doc_id,
      COALESCE(d.canonical_document_id, d.id) AS source_id,
      d.file_name,
      f.name                                  AS folder
    FROM public.documents d
    LEFT JOIN public.folders f ON f.id = d.folder_id
    WHERE d.user_id = auth.uid()
      AND (
        match_document_ids IS NULL
        OR array_length(match_document_ids, 1) IS NULL
        OR d.id = ANY(match_document_ids)
      )
  ),
  scoped_chunks AS (
    SELECT
      dc.id,
      md.doc_id AS document_id,
      md.file_name,
      md.folder,
      dc.chunk_index,
      dc.page_start,
      dc.page_end,
      dc.content,
      dc.embedding
    FROM my_documents md
    JOIN public.document_chunks dc ON dc.document_id = md.source_id
  ),
  scored AS (
    SELECT
      sc.id,
      sc.document_id,
      sc.file_name,
      sc.folder,
      sc.chunk_index,
      sc.page_start,
      sc.page_end,
      sc.content,
      (
        SELECT COALESCE(SUM(
          CASE WHEN lower(sc.content) LIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
          + CASE
              WHEN lower(sc.file_name || ' ' || COALESCE(sc.folder, '')) LIKE '%' || nt.term || '%'
              THEN 2
              ELSE 0
            END
        ), 0)
        FROM normalized_terms nt
      ) AS kw,
      CASE
        WHEN (SELECT emb FROM params) IS NOT NULL AND sc.embedding IS NOT NULL
          THEN 1 - (sc.embedding <=> (SELECT emb FROM params))
        ELSE NULL
      END AS sim
    FROM scoped_chunks sc
  ),
  blended AS (
    SELECT
      scored.*,
      (COALESCE(scored.sim, 0) * 0.7 + LEAST(scored.kw, 9) / 9.0 * 0.3) AS score
    FROM scored
  )
  SELECT
    blended.id,
    blended.document_id,
    blended.file_name,
    blended.folder,
    blended.chunk_index,
    blended.page_start,
    blended.page_end,
    blended.content,
    GREATEST(ROUND(blended.score * 100)::INT, 1) AS rank
  FROM blended
  WHERE blended.kw > 0
    OR blended.sim IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM normalized_terms)
  ORDER BY blended.score DESC, blended.chunk_index ASC
  LIMIT (SELECT lim FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.search_document_chunks_hybrid(TEXT[], TEXT, UUID[], INT) TO authenticated;


-- promote_document_to_library copies a student's chunks into the shared library.
-- If an admin promotes a document that is a link, `where dc.document_id =
-- p_source_document_id` matches nothing and the library book is silently added
-- with zero chunks. Resolve to the canonical first. Body is otherwise unchanged
-- from 20260719130000_promote_to_library.sql.
CREATE OR REPLACE FUNCTION public.promote_document_to_library(
  p_library_id uuid,
  p_source_document_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_discipline text;
  v_source_id  uuid;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(d.canonical_document_id, d.id) into v_source_id
  from public.documents d
  where d.id = p_source_document_id;

  if v_source_id is null then
    raise exception 'source document % not found', p_source_document_id;
  end if;

  select discipline into v_discipline
  from public.library_documents
  where id = p_library_id;

  -- Idempotent: clear any prior copy before re-inserting.
  delete from public.library_document_chunks
  where library_document_id = p_library_id;

  insert into public.library_document_chunks
    (library_document_id, discipline, chunk_index, page_start, page_end,
     content, token_estimate, embedding)
  select
    p_library_id, v_discipline, dc.chunk_index, dc.page_start, dc.page_end,
    dc.content, dc.token_estimate, dc.embedding
  from public.document_chunks dc
  where dc.document_id = v_source_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

GRANT EXECUTE ON FUNCTION public.promote_document_to_library(uuid, uuid) TO authenticated;


-- ─── 7. Planning views (owner-only; used by stages 2-4) ───────────────────────
--
-- These live in a `dedup` schema, NOT in public, on purpose. Supabase's default
-- privileges grant ALL on new objects in public to anon + authenticated, and
-- PostgREST exposes public - so a cross-user planning view created there would
-- be a live cross-tenant read for every logged-in student. A separate schema is
-- not in PostgREST's exposed list and gets no default grants.
CREATE SCHEMA IF NOT EXISTS dedup;
REVOKE ALL ON SCHEMA dedup FROM anon, authenticated;

-- Materialise content_hash for documents that do not have it yet, p_limit rows
-- at a time. Returns how many it stamped; call it repeatedly until it returns 0.
--
-- Batching is not decoration. Hashing the whole corpus streams ~380 MB of chunk
-- text through the server, and this database's default statement_timeout would
-- kill a single-statement version partway - the same failure mode the repo
-- already hit once on huge books ("survive statement timeouts on huge books").
-- Small batches make the work restartable: whatever committed stays committed,
-- and the next call picks up where it stopped.
CREATE OR REPLACE FUNCTION dedup.fingerprint_batch(p_limit INT DEFAULT 100)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  n INT;
BEGIN
  UPDATE public.documents d
  SET content_hash = 'chunkset-sha256-v1:' || public.document_chunkset_digest(d.id)
  WHERE d.id IN (
    SELECT d2.id
    FROM public.documents d2
    WHERE d2.content_hash IS NULL
      AND d2.canonical_document_id IS NULL
      AND EXISTS (SELECT 1 FROM public.document_chunks dc WHERE dc.document_id = d2.id)
    ORDER BY d2.created_at
    LIMIT GREATEST(p_limit, 1)
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- One row per canonical document that actually holds chunks, with everything the
-- merge decision needs. Bytes are estimated from the stored column widths; treat
-- them as "what the heap rows weigh", not as an exact on-disk figure (indexes
-- and TOAST compression both move the real number).
--
-- This view reads the STORED content_hash. It never hashes anything itself, so
-- it is cheap to query repeatedly - that is the point of materialising the
-- fingerprint in stage 2 before previewing in stage 3.
CREATE OR REPLACE VIEW dedup.doc_stats AS
SELECT
  d.id,
  d.user_id,
  d.file_name,
  d.file_size,
  d.page_count,
  d.created_at,
  d.extract_status,
  d.content_hash,
  count(dc.id)::int                                          AS chunk_count,
  count(dc.embedding)::int                                   AS embedded_count,
  COALESCE(sum(length(dc.content)), 0)::bigint               AS text_chars,
  -- Contiguity: a clean extraction indexes 0..n-1 with no holes.
  (min(dc.chunk_index) = 0
   AND max(dc.chunk_index) = count(dc.id) - 1)               AS index_is_contiguous,
  (COALESCE(sum(pg_column_size(dc.content)), 0)
   + COALESCE(sum(pg_column_size(dc.embedding)), 0))::bigint AS bytes
FROM public.documents d
JOIN public.document_chunks dc ON dc.document_id = d.id
WHERE d.canonical_document_id IS NULL
GROUP BY d.id;

-- Documents that hold chunks but are NOT allowed to take part in a merge, with
-- the reason. Kept as its own view so stage 3 can show the owner exactly what is
-- being held back rather than silently dropping it.
CREATE OR REPLACE VIEW dedup.ineligible AS
SELECT
  s.id AS document_id,
  s.user_id,
  s.file_name,
  s.chunk_count,
  s.page_count,
  s.text_chars,
  CASE
    WHEN s.content_hash IS NULL          THEN 'not fingerprinted yet (run stage 2)'
    WHEN NOT s.index_is_contiguous       THEN 'chunk_index has gaps - possible interrupted OCR/extract'
    WHEN s.text_chars < 1000             THEN 'almost no text - degenerate extraction, could collide with another empty one'
    WHEN s.extract_status IS NOT NULL
     AND s.extract_status <> 'ready'     THEN 'extract_status=' || s.extract_status
    WHEN s.page_count >= 20
     AND s.chunk_count < s.page_count / 20.0
                                         THEN 'far too few chunks for its page count - probably a partial extraction'
  END AS reason
FROM dedup.doc_stats s
WHERE s.content_hash IS NULL
   OR NOT s.index_is_contiguous
   OR s.text_chars < 1000
   OR (s.extract_status IS NOT NULL AND s.extract_status <> 'ready')
   OR (s.page_count >= 20 AND s.chunk_count < s.page_count / 20.0);

-- The merge plan. This is the query that decides whether two students' books are
-- "the same book", so the criteria are spelled out in full.
--
-- THE DECISION IS THE HASH. Equal content_hash means byte-identical chunk text,
-- in the same order, with the same page labels. Nothing a consumer can observe
-- differs between the two, so the substitution is invisible by construction.
--
-- Everything else is either a cheap pre-filter or a guard against the hash being
-- decisive about the wrong thing:
--
--   PRE-FILTER (narrows what we compare; authorises nothing on its own)
--     * same file_name and same file_size as some other document. Used only to
--       find candidate groups quickly.
--
--   ELIGIBILITY (a document must be trustworthy before it may merge at all)
--     * it holds at least one chunk, and is not already a link;
--     * chunk_index runs 0..n-1 with no gaps - a half-finished OCR run leaves
--       holes, and a document assembled from a partial page range is not a copy
--       of anything;
--     * at least 1,000 characters of text in total. Without this, two different
--       scanned books that both extracted to nothing but "Scanned by CamScanner"
--       would hash identically and merge. Near-empty documents are exactly where
--       a content hash stops discriminating, so they are excluded rather than
--       trusted;
--     * extract_status is 'ready' (or absent, for rows predating the column);
--     * not grossly under-extracted: for anything of 20+ pages, at least one
--       chunk per 20 pages. Real chunks hold ~6,000 characters, roughly two to
--       three pages, so a healthy book clears this by an order of magnitude and
--       only a truncated extraction trips it.
--
--   THE MERGE ITSELF (all must be equal within a group)
--     * content_hash - the actual proof;
--     * chunk_count - guards against one truncated document matching another.
--       Implied by the hash, asserted anyway;
--     * file_name, file_size, page_count (NULLs equal to each other) - free
--       here, and they mean a mistake in the hashing code cannot on its own
--       merge two different books.
--
-- Wrongly merging silently poisons a student's search results forever; saving
-- 125 MB instead of 130 MB costs nothing. The asymmetry justifies every extra
-- condition above.
--
-- Canonical selection: MOST EMBEDDED CHUNKS WINS, not oldest. 36,695 of 59,933
-- chunks have a NULL embedding, so "oldest" would routinely keep an unembedded
-- copy and demote the whole group to keyword-only search. Ties break on oldest,
-- then id, so the choice is stable across runs.
CREATE OR REPLACE VIEW dedup.plan AS
WITH eligible AS (
  SELECT s.*
  FROM dedup.doc_stats s
  WHERE s.content_hash IS NOT NULL
    AND s.chunk_count > 0
    AND s.index_is_contiguous
    AND s.text_chars >= 1000
    AND (s.extract_status IS NULL OR s.extract_status = 'ready')
    AND (s.page_count IS NULL OR s.page_count < 20
         OR s.chunk_count >= s.page_count / 20.0)
),
candidates AS (
  SELECT e.*
  FROM eligible e
  WHERE EXISTS (
    SELECT 1 FROM eligible o
    WHERE o.id <> e.id
      AND o.file_name = e.file_name
      AND o.file_size IS NOT DISTINCT FROM e.file_size
  )
),
ranked AS (
  SELECT
    c.*,
    first_value(c.id) OVER w AS canonical_id,
    row_number()      OVER w AS rn,
    count(*) OVER (PARTITION BY c.content_hash, c.chunk_count, c.file_name,
                                c.file_size, c.page_count) AS group_size
  FROM candidates c
  WINDOW w AS (
    PARTITION BY c.content_hash, c.chunk_count, c.file_name, c.file_size, c.page_count
    ORDER BY c.embedded_count DESC, c.created_at ASC, c.id ASC
  )
)
SELECT
  r.id           AS document_id,
  r.user_id,
  r.file_name,
  r.file_size,
  r.page_count,
  r.chunk_count,
  r.embedded_count,
  r.text_chars,
  r.bytes,
  r.content_hash AS digest,
  r.canonical_id,
  (r.rn = 1)     AS is_canonical,
  r.group_size
FROM ranked r
WHERE r.group_size > 1;

COMMENT ON VIEW dedup.plan IS
  'One row per document in a provably-identical group. is_canonical = keep its chunks; false = its chunks are redundant and its documents row should link to canonical_id.';


-- ─── 8. Fingerprinting the server-side extraction paths ───────────────────────
--
-- The browser upload path hashes chunks itself (src/lib/content-hash.ts) before
-- it writes them, so it can check for an existing copy and skip the insert
-- entirely. extract-pdf and ocr-worker cannot: they discover the text only after
-- doing the work, and ocr-worker assembles a document from many part-jobs. For
-- those, the chunks are written first and this stamps the fingerprint afterwards
-- so the NEXT student to upload that book can link to it.
--
-- Not granted to authenticated: a student could otherwise overwrite their own
-- document's hash with a value copied from... nothing they can read, so it is
-- not a live hole - but the hash is a claim about content, and only the server,
-- which just wrote that content, has any business asserting it.
CREATE OR REPLACE FUNCTION public.refresh_document_content_hash(p_document_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  -- Links never own chunks; hashing them would store a fingerprint of nothing.
  IF EXISTS (
    SELECT 1 FROM public.documents
    WHERE id = p_document_id AND canonical_document_id IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.document_chunks WHERE document_id = p_document_id
  ) THEN
    RETURN NULL;
  END IF;

  v_hash := 'chunkset-sha256-v1:' || public.document_chunkset_digest(p_document_id);

  UPDATE public.documents
  SET content_hash = v_hash
  WHERE id = p_document_id;

  RETURN v_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_document_content_hash(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_document_content_hash(UUID) TO service_role;
