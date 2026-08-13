-- Chunk de-duplication, stage 1 of 5: the G&D pool, RLS, and consumers.
--
-- Run order (each file explains itself; nothing here is automatic):
--   1  20260808120000_dedup_document_chunks_schema.sql     schema + RLS   (safe)
--   2  20260808120100_dedup_fingerprint.sql                compute hashes (safe)
--   3  20260808120200_dedup_preview_readonly.sql           look           (read-only)
--   4  20260808120300_dedup_backfill_links.sql             pool + link    (reversible)
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
-- ── THIS FILE REPLACES AN EARLIER DESIGN. READ THIS BEFORE THE SQL. ──────────
--
-- The first version of this migration made a student's documents row point at
-- ANOTHER STUDENT'S document (documents.canonical_document_id). IT IS APPLIED IN
-- PRODUCTION - it was run before this redesign existed - so this file cannot
-- assume a clean slate, and did not survive contact with one: the new dedup.plan
-- renames two output columns, `CREATE OR REPLACE VIEW` cannot do that, and the
-- migration aborted with
--
--     ERROR: 42P16: cannot change name of view column "canonical_id" to "donor_id"
--
-- Section 0 and section 8 remove the superseded design, between them and in that
-- order for the reason section 0 sets out. Everything in between is the new
-- design and is unchanged by any of it. Both sections are no-ops on a database
-- that has never seen the old file, so this migration now applies cleanly from
-- either state.
--
-- It is superseded here by the owner's design: the shared copy is
-- moved into a G&D-OWNED POOL - owner-less rows with no user_id, in the shape of
-- library_documents / library_document_chunks - and every student's row points
-- at the pool instead.
--
-- The pool is not a stylistic preference. It deletes two whole mechanisms that
-- the old design could not do without:
--
--   1. THE GUARD TRIGGER IS GONE, and with it a SECURITY DEFINER function that
--      read other users' rows. documents already has a blanket
--      "Users update own docs" FOR UPDATE policy with no column restriction, so
--      under the old design a student could point canonical_document_id at any
--      document id they could guess or learn and inherit read access to that
--      student's textbook. The old file closed that with a trigger asserting
--      "your content_hash already equals the target's".
--
--      Here the same assertion is a FOREIGN KEY:
--
--          FOREIGN KEY (pooled_document_id, content_hash)
--            REFERENCES public.pool_documents (id, content_hash)
--          CHECK (pooled_document_id IS NULL OR content_hash IS NOT NULL)
--
--      A student may only link to a pool row whose fingerprint they already
--      hold, and the database enforces it declaratively, on every write path,
--      including ones nobody has thought of yet. The CHECK is load-bearing and
--      is not tidiness: without it a row with (some_pool_id, NULL) satisfies the
--      foreign key without any lookup at all, which would hand the whole hole
--      straight back. MATCH FULL is the usual fix and cannot be used here - it
--      would also reject the ordinary (NULL, hash) row that every fingerprinted
--      but un-pooled document is. See section 2.
--
--      Note what CANNOT be reached this way even in principle: a pool row is not
--      a student's document. Linking to one grants a copy of content the linker
--      has already proved they possess, and nothing else. There is no longer a
--      pointer in the schema that can be aimed at private data.
--
--   2. THE REPARENT TRIGGER IS GONE. Under the old design the chunks lived under
--      one student's document, so that student deleting their file would cascade
--      the chunks away and silently empty the book for everyone linked to it.
--      documents_reparent_canonical existed to hand the chunks to a surviving
--      dependent mid-DELETE. A pool row has no owner, appears in no student's
--      library, and is matched by no ON DELETE CASCADE from auth.users, so
--      neither deleting a file nor deleting an account can touch it. The failure
--      mode does not exist, so neither does the machinery for it.
--
-- Chains and cycles also stop being possible rather than being forbidden: a
-- pool row cannot itself be a link, because pool_documents has no link column.
--
-- WHAT THE STUDENT IS PROMISED
-- ----------------------------
-- "This document is in our safe hands now - a delete won't affect us." That
-- sentence is a statement about this schema, and every part of it is enforced
-- here: pool_documents has no user_id, no FK to auth.users on the content path,
-- and no policy that lets a student write to it. See section 3.
--
-- WHY documents.pooled_document_id AND NOT A REPOINTED document_chunks
-- -------------------------------------------------------------------
-- Carried over from the old design, and still the deciding argument:
--   * document_chunks.document_id would have to be repointed for all 59,933 rows
--     and its UNIQUE (document_id, chunk_index) rebuilt - a full table rewrite on
--     a database that has no headroom to rewrite anything.
--   * EVERY consumer selects by document_id today. Renaming the join key
--     everywhere at once is how a consumer gets missed, and a missed consumer is
--     a student who silently gets zero results.
--   * The mobile app ships separately from the web app, so a schema change that
--     forces a client change is a change we cannot fully roll out.
-- pooled_document_id keeps document_id as the join key, so resolution stays a
-- single decision inside functions the clients already call. Consumers that go
-- through the RPCs need no code change at all.
--
-- NULL pooled_document_id = "my chunks are mine, under my id, in
-- document_chunks". Non-NULL = "my chunks are the pool's, under that pool id".
--
-- THE ONE COST OF A SEPARATE TABLE, STATED HONESTLY
-- ------------------------------------------------
-- Moving a chunk set into the pool is an INSERT ... SELECT followed by a DELETE,
-- not an UPDATE, so the database grows by one copy of the donated book before it
-- shrinks by all the redundant ones. Stage 3 measures that transient cost
-- exactly, before anything is written, and stage 4 does the work one book at a
-- time so the peak is a single textbook rather than the whole corpus. The
-- alternative - putting owner-less rows in `documents` with user_id NULL - would
-- avoid the copy, but it puts pool rows and private rows in the SAME table,
-- which means the foreign key above can no longer tell them apart and the guard
-- trigger comes straight back. The copy is the price of deleting the trigger.
--
-- THIS FILE IS SAFE AND REVERSIBLE. It creates two empty tables, adds a column,
-- and replaces four functions. It moves no data and deletes no chunk, document
-- or user row.
--
-- The one exception to "deletes nothing" is the supersession in sections 0 and
-- 8, which removes the earlier design's schema objects: a column that is NULL on
-- every row, two triggers, three functions, one policy (replaced by the original
-- it had itself replaced) and a scratch schema of views. No student-visible data
-- passes through any of them, and documents.content_hash - the only column of
-- the old design that holds anything - is explicitly kept (0d).
--
-- ROLLBACK
-- --------
--   drop view if exists public.document_chunks_effective;
--   drop function if exists public.pool_share_document(uuid);
--   drop function if exists public.find_pooled_document(text);
--   drop function if exists public.pool_chunkset_digest(uuid);
--   drop function if exists public.refresh_document_content_hash(uuid);
--   drop function if exists public.document_chunkset_digest(uuid);
--   drop schema if exists dedup cascade;
--   drop policy if exists "Users insert own document chunks" on public.document_chunks;
--   create policy "Users insert own document chunks" on public.document_chunks
--     for insert with check (auth.uid() = user_id);
--   alter table public.documents drop constraint if exists documents_pooled_link_fkey;
--   alter table public.documents drop constraint if exists documents_pooled_needs_hash;
--   alter table public.documents drop column if exists pooled_document_id;
--   -- content_hash: LEAVE IT. Both designs write the identical value into it
--   -- (see section 0d), so it is the one artefact worth keeping whichever design
--   -- wins, and re-deriving it means streaming ~380 MB of chunk text again. Drop
--   -- it only if you are abandoning de-duplication altogether:
--   --   alter table public.documents drop column if exists content_hash;
--   --   drop index if exists public.idx_documents_content_hash;
--   drop table if exists public.pool_document_chunks;
--   drop table if exists public.pool_documents;
--   -- then re-run 20260503000100_optimize_document_chunk_search.sql,
--   -- 20260608000100_add_chunk_embeddings.sql and
--   -- 20260719130000_promote_to_library.sql to restore the pre-dedup function
--   -- bodies. document_chunks' SELECT policy needs nothing: section 0a already
--   -- restored it to the original `auth.uid() = user_id`, which is what the
--   -- pre-dedup app expects.
-- Rolling this back is only safe BEFORE stage 5 has deleted anything. Once a
-- student's own chunks are gone, dropping the pool strands them.
--
-- SECTIONS 0 AND 8 ARE NOT ROLLED BACK BY ANY OF THE ABOVE, deliberately. They
-- remove a superseded design rather than anything this file introduces, and the
-- statements above land you on the pre-dedup schema, which is where the
-- superseded design started from too. If you genuinely need it back, it is in
-- git:
--   git show 53ccde1:supabase/migrations/20260808120000_dedup_document_chunks_schema.sql


-- ─── 0. SUPERSESSION, PART 1 OF 2: undo the canonical-link design ─────────────
--
-- SAFE TO RUN ON A VIRGIN DATABASE AND ON ONE CARRYING THE OLD DESIGN, and safe
-- to run twice. Every removal below is `IF EXISTS`, so on a database that never
-- saw the superseded stage 1 this section does nothing at all except re-state
-- document_chunks' SELECT policy in exactly the words
-- 20260430002000_add_document_chunks.sql used - which is a no-op there too.
--
-- WHAT THE OLD DESIGN LEFT BEHIND, AND WHERE EACH PIECE IS DEALT WITH.
-- Read off the superseded file itself, not off a sample of the live catalogue:
--   git show 53ccde1:supabase/migrations/20260808120000_dedup_document_chunks_schema.sql
--
--   documents.canonical_document_id, its self-FK, idx_documents_user_canonical
--     and idx_documents_canonical .................... section 8
--   documents.content_hash ......................... KEPT, untouched - see 0d
--   idx_documents_content_hash ..................... KEPT - byte-identical
--                                                    definition in both designs
--   public.document_chunkset_digest(uuid) .......... kept; section 4 replaces it
--                                                    in place with a
--                                                    byte-identical body
--   public.documents_check_canonical_link() ........ section 8
--   trigger documents_canonical_guard .............. section 8
--   public.documents_reparent_canonical() .......... section 8
--   trigger documents_reparent_canonical ........... section 8
--   policy "Users view own or linked document chunks" ......... HERE, 0a
--   policy "Users insert own document chunks", canonical form . section 3
--   public.find_canonical_document(text) ........... HERE, 0b
--   schema dedup, and everything in it ............. HERE, 0c
--   public.refresh_document_content_hash(uuid) ..... section 4 replaces in place
--   view public.document_chunks_effective .......... section 6 drops + recreates
--   public.search_document_chunks(text[],uuid[],int) .......... section 6
--   public.search_document_chunks_hybrid(text[],text,uuid[],int) section 6
--   public.promote_document_to_library(uuid,uuid) .. section 6
--
-- Everything in that list marked "section 4/6" is replaced IN PLACE rather than
-- dropped, and can be: name, argument types and return type are identical in the
-- two designs, so CREATE OR REPLACE FUNCTION is legal. Only two objects in the
-- whole migration have a shape `CREATE OR REPLACE` cannot reach -
-- public.document_chunks_effective (its column list changed) and dedup.plan
-- (canonical_id -> donor_id, is_canonical -> is_donor). The first is already
-- handled where it is created, by an explicit DROP VIEW; the second is what
-- raised the 42P16, and 0c is its fix.
--
-- WHY THE REMOVAL IS SPLIT ACROSS SECTIONS 0 AND 8 RATHER THAN ALL DONE HERE
-- -------------------------------------------------------------------------
-- This is the part that would break retrieval for every student if it were got
-- wrong, so it is spelled out rather than assumed.
--
-- A SQL-language or plpgsql function body is not resolved when the function is
-- created; it is resolved when it runs. So dropping
-- documents.canonical_document_id does not error and does not invalidate
-- anything - it silently arms three live functions to fail on their next call.
-- In production right now, public.search_document_chunks,
-- public.search_document_chunks_hybrid and public.promote_document_to_library
-- are the OLD bodies, which resolve COALESCE(d.canonical_document_id, d.id), and
-- public.document_chunks_effective is the old view, which selects it. Chat
-- retrieval on web and on mobile goes through search_document_chunks_hybrid.
--
-- Sections 4 to 6 replace every one of those with a body that names no such
-- column. So the column must not go until they have. Two ways to guarantee that:
--
--   (a) drop the column here, and restore the pre-dedup bodies
--       (20260503000100 / 20260608000100 / 20260719130000) here as well, so that
--       every function is valid at every instant; or
--   (b) drop the column after sections 4 to 6 have run.
--
-- (b) is what this file does. It is the same guarantee without a third copy of
-- two 120-line search functions living in the repo, and it buys one thing (a)
-- does not: documents_canonical_guard stays alive for exactly as long as the
-- column and the old function bodies do.
--
-- That last point is not tidiness. documents carries a blanket "Users update own
-- docs" FOR UPDATE policy with no column restriction. Drop the guard trigger
-- while the old search bodies are still live and a student can point
-- canonical_document_id at another student's document id and have
-- search_document_chunks_hybrid - SECURITY DEFINER, so RLS does not save us -
-- hand them that student's textbook. Retiring the guard in the same section as
-- the column, after the last old body is gone, means that window is never
-- opened rather than merely being kept short.
--
-- So the intermediate state, between section 0 and section 8, is: the old
-- column, the old guard trigger and the old function bodies, all still agreeing
-- with each other and all still returning exactly what they return today (no
-- documents row has canonical_document_id set, so COALESCE(canonical, id) = id
-- for every row) - plus the new pool objects, which nothing points at yet. Every
-- statement boundary is coherent. And if the file runs as one transaction, which
-- it does through the Supabase SQL editor and through `supabase db push`, none
-- of it is observable from outside at all.


-- 0a. RLS on document_chunks.
--
--     The old design DROPPED the original "Users view own document chunks" and
--     replaced it with an "own OR linked" policy whose EXISTS() reads
--     documents.canonical_document_id.
--
--     This file creates NO SELECT policy on document_chunks - section 3 argues
--     that the original one is exactly right for the pool design and leaves it
--     alone. So if the old policy were merely dropped along with the column,
--     document_chunks would be left with no SELECT policy whatsoever, and under
--     RLS that denies every read: src/lib/embeddings.ts' backfill and the
--     library page's per-document chunk counts would go silently empty for
--     everybody. The original is therefore restored here, verbatim from
--     20260430002000_add_document_chunks.sql.
--
--     This narrows, never widens. No documents row has canonical_document_id
--     set, so the branch being removed matches nothing today.
--
--     END STATE on document_chunks: exactly one SELECT policy (own rows only),
--     the INSERT policy section 3 rewrites, and the untouched UPDATE and DELETE
--     policies - four in total, the same four the table had before any of this
--     started.
DROP POLICY IF EXISTS "Users view own or linked document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users view own document chunks" ON public.document_chunks;
CREATE POLICY "Users view own document chunks"
  ON public.document_chunks FOR SELECT
  USING (auth.uid() = user_id);


-- 0b. The old canonical lookup, superseded by find_pooled_document() in section
--     5, which answers the same question against the pool. Nothing calls it -
--     src/routes/-app.library-page.tsx calls find_pooled_document and is gated
--     on DEDUP_SCHEMA_APPLIED, still false - but it is GRANTed to authenticated
--     and its body reads canonical_document_id, so leaving it behind would leave
--     a broken function callable over the API. Dropped by exact signature; there
--     has only ever been the one.
DROP FUNCTION IF EXISTS public.find_canonical_document(TEXT);


-- 0c. The dedup schema, whole. THIS IS THE FIX FOR THE 42P16.
--
--     dedup.plan is the view that raised it: CREATE OR REPLACE VIEW cannot
--     rename canonical_id to donor_id or is_canonical to is_donor.
--     dedup.doc_stats and dedup.ineligible would in fact have replaced cleanly -
--     their column lists are identical in both designs - but doc_stats' WHERE
--     clause reads canonical_document_id, which would block section 8's column
--     drop, and dedup.plan cannot be dropped without doc_stats going too.
--     Dropping the schema is also exactly what the superseded file's own
--     ROLLBACK note prescribes.
--
--     WHAT CASCADE TAKES, AND WHY EACH IS FINE:
--       dedup.doc_stats, dedup.ineligible, dedup.plan - recreated in section 7.
--       dedup.fingerprint_batch(int) - recreated in section 7.
--       dedup.merge_log, if the superseded stage 4 was ever run. Its old shape
--         is canonical_id NOT NULL with no pool columns, and stage 4's
--         CREATE TABLE IF NOT EXISTS would silently keep it and then fail on the
--         INSERT - the same class of bug as this one. It holds nothing but a
--         frozen copy of dedup.plan, which stage 4 re-freezes; it cannot hold
--         completed work, because completing any would have set
--         canonical_document_id on a documents row and no row has one set.
--         20260808120300 checks for the old shape itself as well.
--       dedup.partial_extractions, if supabase/repairs/mark-partial-extractions.sql
--         was ever run. Owner-run diagnostic view; its old version also reads
--         canonical_document_id, and re-running that file recreates it against
--         pooled_document_id. Nothing depends on it.
--     Nothing outside the dedup schema depends on anything inside it - no public
--     view, function, policy or constraint names dedup.* - so the cascade cannot
--     reach further than that list.
DROP SCHEMA IF EXISTS dedup CASCADE;


-- 0d. documents.content_hash IS DELIBERATELY NOT TOUCHED: not dropped, not
--     cleared, not recomputed.
--
--     THE TWO DESIGNS DEFINE IT IDENTICALLY. The stored value is
--     'chunkset-sha256-v1:' || public.document_chunkset_digest(id) in both, and
--     document_chunkset_digest's body is byte-for-byte the same text in the
--     superseded file and in section 4 of this one: per-chunk SHA-256 over
--     chunk_index|page_start|page_end|sha256(content), joined by newlines,
--     hashed again, over public.document_chunks ordered by chunk_index. Same
--     source rows, same algorithm, same 'v1' tag, same prefix - so a hash
--     written by the old stage 2 is precisely the hash the new stage 2 would
--     write, and src/lib/content-hash.ts reproduces both.
--
--     Re-deriving it would therefore be pure cost: it streams ~380 MB of chunk
--     text through a free-tier instance already at its size ceiling, which is
--     the entire reason stage 2 is a separate, batched, restartable file. Stage
--     2 skips rows that already have one (`WHERE d2.content_hash IS NULL`), so
--     whatever is already stored is kept and re-running it costs nothing.
--
--     Consequently section 2's `ADD COLUMN IF NOT EXISTS content_hash` and
--     `CREATE INDEX IF NOT EXISTS idx_documents_content_hash` are no-ops on a
--     database carrying the old design rather than a rebuild - the index
--     definition is identical in both. The only thing about content_hash that
--     changes is the wording of its COMMENT.
--
--     Nothing to execute here. This note is the decision.


-- ─── 1. The pool ──────────────────────────────────────────────────────────────
--
-- Owner-less by construction, exactly like library_documents /
-- library_document_chunks: no user_id column exists, so there is no value any
-- cascade could match and no row any student's RLS could claim.
--
-- WHAT IT IS NOT: it is not the shared library, and it deliberately does not
-- reuse those tables. The two look alike and mean opposite things.
--
--   library_documents  = REDISTRIBUTION. An admin decided this book may be
--                        handed to students who never had it. Discipline-scoped,
--                        moderated, discoverable, searched by everyone.
--   pool_documents     = DE-DUPLICATION. One stored copy of content that several
--                        students each already possess. Not discoverable, not
--                        scoped, searched only by the students who linked to it.
--
-- Three concrete reasons the library cannot double as the pool:
--   * Its RLS reads `status = 'approved'`. Pool rows would have to be approved
--     to be readable, which would silently redistribute every shared upload to a
--     whole discipline with no review - the exact decision the library exists to
--     keep in the owner's hands. Leaving them 'pending' instead makes them
--     unreadable, so a second policy would be needed anyway, which is this table.
--   * promote_document_to_library() DELETEs every library_document_chunks row
--     for a library id before re-inserting. Pointed at a shared table, a
--     re-promotion would delete the chunk set that hundreds of linked students
--     are reading through. Separate tables make that class of accident
--     impossible rather than merely unlikely.
--   * The library is discipline-scoped; possession is not. Two students in
--     different disciplines can upload the same book, and the corpus the owner
--     recently emptied would have taken the pool with it (ON DELETE CASCADE).
--
-- WHAT THIS MEANS FOR ADMIN APPROVAL: nothing changes. /app/admin still lists
-- library_documents submissions, still approves them, and
-- promote_document_to_library() still copies chunks into
-- library_document_chunks. The only difference is that the source chunks may now
-- live in the pool, which section 6 handles inside the function. Sharing into
-- the pool is NOT a library submission and never appears in the review queue -
-- it grants no student any content they did not already have, so there is
-- nothing for an admin to decide. A student who wants their book redistributed
-- still uses "Share with everyone" on the card, which is unchanged.
CREATE TABLE IF NOT EXISTS public.pool_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- THE IDENTITY KEY. One meaning, always: a fingerprint of the EXTRACTED TEXT
  -- as it is actually stored, never of the file bytes.
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
  --     this database has no memory to spare). See document_chunkset_digest.
  --   * chunk_index and the page numbers are inside the hash, so a document with
  --     gaps, duplicated indexes or different page labels can never collide with
  --     a cleanly-extracted one even if the prose matches.
  --
  -- 'v1' is a version tag on the algorithm. If the chunker or the format ever
  -- changes, bump it rather than letting old and new hashes mingle.
  --
  -- UNIQUE is what makes the pool a pool: one stored copy per distinct content.
  content_hash TEXT NOT NULL UNIQUE,

  -- Display metadata only. Nothing resolves on these; two students may file the
  -- same book under different names and every consumer quotes the name on the
  -- CALLER'S documents row, never this one.
  file_name  TEXT NOT NULL,
  file_size  BIGINT,
  page_count INT,
  chunk_count INT NOT NULL DEFAULT 0,

  -- Credit, not ownership. ON DELETE SET NULL is the whole point: deleting the
  -- contributor's account erases who gave it, never what they gave. There is no
  -- path by which any auth.users row's deletion removes pooled content.
  contributed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contributed_at  TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),

  -- Needed for the composite foreign key in section 2. Redundant with the PK
  -- and the UNIQUE above, and cheap; it exists so the FK has an index to point
  -- at, which is what lets the constraint be declarative.
  CONSTRAINT pool_documents_id_hash_key UNIQUE (id, content_hash)
);

COMMENT ON TABLE public.pool_documents IS
  'G&D-owned pool of de-duplicated chunk sets. Owner-less: no user_id, no cascade from auth.users. A student links to a row here only by presenting its content_hash, which means possessing its content.';

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.pool_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_document_id UUID NOT NULL
    REFERENCES public.pool_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  page_start INT,
  page_end INT,
  content TEXT NOT NULL,
  token_estimate INT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (pool_document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_pool_chunks_doc
  ON public.pool_document_chunks(pool_document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_pool_chunks_content_trgm
  ON public.pool_document_chunks USING gin (content gin_trgm_ops);

-- Semantic search over pooled books needs the same ANN index document_chunks
-- has. It costs space on an instance that has none to spare, which is only
-- acceptable because the same index on document_chunks gets smaller by more than
-- this one grows: the vectors move, they are not duplicated.
CREATE INDEX IF NOT EXISTS idx_pool_chunks_embedding_hnsw
  ON public.pool_document_chunks USING hnsw (embedding vector_cosine_ops);


-- ─── 2. The link, and why it needs no trigger ─────────────────────────────────

ALTER TABLE public.documents
  -- NULL = "my chunks are mine". Non-NULL = "read my chunks from that pool row".
  ADD COLUMN IF NOT EXISTS pooled_document_id UUID,
  -- The caller's own fingerprint. Set when a document's chunk set is complete
  -- and true of it; it is both the lookup key for "do we already store this?"
  -- and, below, the proof of possession that authorises the link.
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

COMMENT ON COLUMN public.documents.pooled_document_id IS
  'NULL = this document owns its chunks in document_chunks. Non-NULL = its chunks are pool_document_chunks under that pool id. Settable only with a matching content_hash - see documents_pooled_link_fkey.';
COMMENT ON COLUMN public.documents.content_hash IS
  'chunkset-sha256-v1:<hex>. Fingerprint of the stored extracted text. Never a hash of the file bytes. Identical value = substituting one chunk set for the other is provably invisible to every consumer.';

-- THE SECURITY CHECK, AS A CONSTRAINT.
--
-- Replaces documents_canonical_guard entirely. To point at a pool row a student
-- must set content_hash to that row's fingerprint in the same row; the only ways
-- to know that value are to possess the same file and hash it, or to invert
-- SHA-256. Possessing the file is precisely the intended feature.
--
-- THE HOLE A COMPOSITE FOREIGN KEY LEAVES, AND HOW IT IS CLOSED HERE.
--
-- Under the default MATCH SIMPLE, a partially-NULL key skips the lookup
-- entirely: (pooled_document_id = <guess>, content_hash = NULL) is accepted with
-- no check at all, and the protection above would be decorative.
--
-- MATCH FULL is the textbook answer to that and it is the WRONG one here. MATCH
-- FULL does not merely check partially-NULL keys - it FORBIDS them outright
-- ("MATCH FULL does not allow mixing of null and nonnull key values"). The
-- overwhelmingly common row in this table is a document that owns its chunks and
-- has been fingerprinted: (NULL, 'chunkset-sha256-v1:...'). That is a mixed key.
-- MATCH FULL would reject every single row stage 2 writes, and with it the
-- forward path - the browser stamps content_hash on ordinary uploads so the NEXT
-- student can match them.
--
-- So: MATCH SIMPLE, plus a CHECK that removes the only case MATCH SIMPLE would
-- have waved through.
--
--   pooled_document_id IS NULL OR content_hash IS NOT NULL
--
-- With that, a non-NULL pooled_document_id forces a non-NULL content_hash, both
-- columns are non-NULL together, and MATCH SIMPLE performs the full lookup. The
-- remaining shapes are exactly the ones we want:
--
--   (NULL, NULL)      not fingerprinted yet, owns its chunks   - unchecked, fine
--   (NULL, hash)      fingerprinted, owns its chunks           - unchecked, fine
--   (pool_id, hash)   a link                                   - LOOKED UP
--   (pool_id, NULL)   the attack                               - REJECTED by CHECK
--
-- The guarantee is identical to the one the header claims for MATCH FULL, it is
-- still declarative and still enforced on every write path, and unlike MATCH
-- FULL it lets an ordinary document carry a fingerprint. Two constraints instead
-- of one, and still no trigger and no SECURITY DEFINER function reading other
-- users' rows.
--
-- ON DELETE SET NULL: removing a pool row (an owner-only act - a rights
-- complaint, say) unlinks its readers rather than dangling or blocking. It nulls
-- BOTH columns of the key, which satisfies the CHECK, so the unlink cannot fail.
-- Their documents row survives with no chunks, which reads as an empty book
-- everywhere, and is honest. ON UPDATE CASCADE is inert - neither column is ever
-- updated in place - and is there so the constraint has no unspecified branch.
DO $$
BEGIN
  -- The CHECK first: it must already hold before the foreign key can be relied
  -- on, and on an empty-column table both are instant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_pooled_needs_hash'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_pooled_needs_hash
      CHECK (pooled_document_id IS NULL OR content_hash IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_pooled_link_fkey'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_pooled_link_fkey
      FOREIGN KEY (pooled_document_id, content_hash)
      REFERENCES public.pool_documents (id, content_hash)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Lookup path for the backfill's grouping, and for "has this document already
-- been fingerprinted?". Partial so it stays small.
CREATE INDEX IF NOT EXISTS idx_documents_content_hash
  ON public.documents(content_hash)
  WHERE content_hash IS NOT NULL;

-- Serves the pool RLS EXISTS() below and the resolution join: given a user,
-- which of their documents are pooled, and to what.
CREATE INDEX IF NOT EXISTS idx_documents_user_pooled
  ON public.documents(user_id, pooled_document_id)
  WHERE pooled_document_id IS NOT NULL;


-- ─── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.pool_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_document_chunks ENABLE ROW LEVEL SECURITY;

-- Deny by default and stay that way. No INSERT, UPDATE or DELETE policy exists
-- on either table, for any role, so RLS refuses every client write outright.
-- The only writer is pool_share_document() (section 5), which is SECURITY
-- DEFINER and therefore not subject to these policies - and which validates
-- everything before it writes. That is the enforcement behind "a delete won't
-- affect us": there is no statement a student can send that removes or alters
-- pooled content.
REVOKE ALL ON public.pool_documents       FROM anon, authenticated;
REVOKE ALL ON public.pool_document_chunks FROM anon, authenticated;
GRANT SELECT ON public.pool_documents       TO authenticated;
GRANT SELECT ON public.pool_document_chunks TO authenticated;

-- You may read a pool row you are linked to, and no other.
--
-- Both policies are anchored on `d.user_id = auth.uid()`, so only rows the
-- caller owns can satisfy them and the caller can never widen the grant by
-- naming somebody else's document. The set exposed is exactly the pool rows
-- named by the caller's own documents - and the foreign key in section 2 already
-- guarantees each of those was named with a fingerprint the caller held.
--
-- Note what is deliberately NOT granted: an authenticated student cannot browse
-- the pool. Reading requires a link, a link requires the hash, and the hash
-- requires the content. Without that restriction the pool would be a directory
-- of every textbook every student has ever uploaded, readable by anyone with an
-- account - which is redistribution, and redistribution is the library's job and
-- the admin's decision.
DROP POLICY IF EXISTS "Read pooled documents you link to" ON public.pool_documents;
CREATE POLICY "Read pooled documents you link to"
  ON public.pool_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.user_id = auth.uid()
      AND d.pooled_document_id = pool_documents.id
  ));

DROP POLICY IF EXISTS "Read pooled chunks you link to" ON public.pool_document_chunks;
CREATE POLICY "Read pooled chunks you link to"
  ON public.pool_document_chunks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.user_id = auth.uid()
      AND d.pooled_document_id = pool_document_chunks.pool_document_id
  ));

-- document_chunks' SELECT policy is deliberately UNCHANGED at
-- `auth.uid() = user_id`. This is a real simplification over the superseded
-- design, which had to widen it to "own OR the chunks of the document I link
-- to" - a cross-user read branch on the app's largest table. Pooled content
-- does not live in document_chunks, so the branch is not needed and the old
-- policy is exactly right.
--
-- INSERT is tightened, not loosened: you may still only insert chunks you own,
-- and now only onto a document that is yours AND is not pooled. Writing chunks
-- onto a pooled document is always a bug - they would be invisible (resolution
-- reads the pool) and would waste exactly the space this migration reclaims.
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
        AND d.pooled_document_id IS NULL
    )
  );

-- UPDATE and DELETE on document_chunks keep `auth.uid() = user_id`. A student
-- deleting their own chunk rows now harms only themselves: the shared copy is in
-- the pool, which they cannot write to at all.


-- ─── 4. Fingerprint helpers ───────────────────────────────────────────────────
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
-- Not granted to clients: internal helpers, not an API. Both must produce the
-- same hex string as src/lib/content-hash.ts.
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

-- The same digest over a pool row. Used to prove a copy landed byte-for-byte
-- before the source is deleted - the check that makes pooling safe rather than
-- merely plausible.
CREATE OR REPLACE FUNCTION public.pool_chunkset_digest(p_pool_document_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        COALESCE(
          string_agg(
            pc.chunk_index::text || '|'
              || COALESCE(pc.page_start::text, '') || '|'
              || COALESCE(pc.page_end::text, '') || '|'
              || encode(sha256(convert_to(pc.content, 'UTF8')), 'hex'),
            E'\n' ORDER BY pc.chunk_index
          ),
          ''
        ),
        'UTF8'
      )
    ),
    'hex'
  )
  FROM public.pool_document_chunks pc
  WHERE pc.pool_document_id = p_pool_document_id;
$$;

REVOKE ALL ON FUNCTION public.pool_chunkset_digest(UUID) FROM PUBLIC, anon, authenticated;

-- Stamp a document's fingerprint from what is actually stored under it.
--
-- The browser upload path hashes chunks itself (src/lib/content-hash.ts) before
-- it writes them, so it can check the pool first and skip the insert entirely.
-- extract-pdf and ocr-worker cannot: they discover the text only after doing the
-- work, and ocr-worker assembles a document from many part-jobs. For those, the
-- chunks are written first and this stamps the fingerprint afterwards so the
-- NEXT student to upload that book can link to the pool.
--
-- Not granted to authenticated: the hash is a claim about content, and only the
-- server, which just wrote that content, has any business asserting it.
CREATE OR REPLACE FUNCTION public.refresh_document_content_hash(p_document_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  -- A pooled document owns no chunks; hashing it would store a fingerprint of
  -- nothing, and overwriting its content_hash would violate the link FK.
  IF EXISTS (
    SELECT 1 FROM public.documents
    WHERE id = p_document_id AND pooled_document_id IS NOT NULL
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


-- ─── 5. Finding the pool, and joining it ──────────────────────────────────────

-- "Do we already store this content?" for the upload path.
--
-- SECURITY DEFINER because pool_documents is unreadable until you are linked to
-- it, and this is the call that tells you whether to link. Safe to expose: the
-- caller must already hold the full chunk-set hash, which means they already
-- hold the content. The uuid alone grants nothing - reading the chunks still
-- requires the link, and the link's foreign key re-checks the same hash.
--
-- Linking here is a READ, not a contribution: it costs the student nothing, adds
-- nothing to the pool, and is why the share prompt is only ever raised for a
-- document that did NOT match.
CREATE OR REPLACE FUNCTION public.find_pooled_document(p_content_hash TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.pool_documents p
  WHERE p_content_hash IS NOT NULL
    AND length(p_content_hash) >= 32          -- never match on '' or a stub
    AND p.content_hash = p_content_hash
    AND EXISTS (
      SELECT 1 FROM public.pool_document_chunks pc WHERE pc.pool_document_id = p.id
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_pooled_document(TEXT) TO authenticated;

-- Contribute a document's chunk set to the pool, and link to it.
--
-- THE ONLY WRITE PATH INTO THE POOL. Everything a student is told when they
-- press "Share with G&D" is decided here, not in the browser: eligibility, the
-- byte-for-byte verification, the link, and the removal of their now-redundant
-- private copy.
--
-- Returns one row: (pool_id, chunks_pooled, created_pool). The output columns are
-- named so none of them collides with a column of any table this function
-- touches - in plpgsql a RETURNS TABLE column is a variable, and an unqualified
-- name that also exists as a column is a silent bug waiting for a refactor.
--   created_pool = true  -> this student's copy became the stored one.
--   created_pool = false -> the pool already had it; the student is now linked
--                           and their private duplicate is gone. Still a saving,
--                           still counts as sharing.
--
-- ELIGIBILITY. A broken extraction must never enter the pool: today a failed
-- extraction hurts one student, but pooled it hands the same empty book to
-- everyone who uploads that title afterwards. There are seven such books in
-- production already. So the rules below are the same ones dedup.plan applies to
-- the historical backfill, asserted again for every live share:
--   * extract_status is exactly 'ready'. Not "'ready' or NULL" - NULL means
--     "unknown", and unknown is not a state anything gets pooled from;
--   * at least one chunk, and chunk_index runs 0..n-1 with no gaps (a
--     half-finished OCR run leaves holes);
--   * at least 1,000 characters of text. Two different scanned books that both
--     extracted to nothing but "Scanned by CamScanner" would hash identically.
--     Near-empty documents are exactly where a content hash stops discriminating;
--   * not grossly under-extracted: for 20+ pages, at least one chunk per 20
--     pages. Real chunks hold ~6,000 characters, so a healthy book clears this by
--     an order of magnitude and only a truncated extraction trips it.
--
-- GUESTS are refused. A guest is a real Supabase ANONYMOUS auth user with a
-- genuine auth.uid(), so nothing about RLS stops them on its own. They are
-- refused because an anonymous session is discarded the moment it is signed out
-- - contributed_by would point at an account that no longer means anything - and
-- because anonymous accounts can be minted on demand, which would make the
-- client's daily points cap free to bypass. The claim is read from the JWT
-- directly rather than through public.is_guest_account(), which is created by a
-- LATER, also-unapplied migration; depending on it would make the order these
-- two are applied in matter.
CREATE OR REPLACE FUNCTION public.pool_share_document(p_document_id UUID)
RETURNS TABLE (pool_id UUID, chunks_pooled INT, created_pool BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_doc          RECORD;
  v_chunks       INT;
  v_min_index    INT;
  v_max_index    INT;
  v_text_chars   BIGINT;
  v_hash         TEXT;
  v_pool_id      UUID;
  v_created      BOOLEAN := FALSE;
  v_pool_digest  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to share a document.';
  END IF;

  IF COALESCE((auth.jwt() ->> 'is_anonymous')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Create a free account to share documents with G&D.';
  END IF;

  SELECT d.id, d.user_id, d.file_name, d.file_size, d.page_count,
         d.extract_status, d.pooled_document_id
    INTO v_doc
  FROM public.documents d
  WHERE d.id = p_document_id
    AND d.user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That document could not be found.';
  END IF;

  IF v_doc.pooled_document_id IS NOT NULL THEN
    -- Already shared. Idempotent rather than an error: a retried save after a
    -- dropped response must not look like a failure to the student.
    RETURN QUERY
      SELECT v_doc.pooled_document_id,
             (SELECT count(*)::INT FROM public.pool_document_chunks pc
               WHERE pc.pool_document_id = v_doc.pooled_document_id),
             FALSE;
    RETURN;
  END IF;

  IF v_doc.extract_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'This file has not finished processing, so it cannot be shared yet.';
  END IF;

  SELECT count(*)::INT, min(dc.chunk_index), max(dc.chunk_index),
         COALESCE(sum(length(dc.content)), 0)
    INTO v_chunks, v_min_index, v_max_index, v_text_chars
  FROM public.document_chunks dc
  WHERE dc.document_id = p_document_id;

  IF v_chunks = 0 THEN
    RAISE EXCEPTION 'There is no searchable text stored for this file.';
  END IF;
  IF v_min_index <> 0 OR v_max_index <> v_chunks - 1 THEN
    RAISE EXCEPTION 'This file is missing sections, so it cannot be shared.';
  END IF;
  IF v_text_chars < 1000 THEN
    RAISE EXCEPTION 'There is too little text in this file to share it.';
  END IF;
  IF v_doc.page_count IS NOT NULL
     AND v_doc.page_count >= 20
     AND v_chunks < v_doc.page_count / 20.0 THEN
    RAISE EXCEPTION 'Only part of this file was read, so it cannot be shared.';
  END IF;

  v_hash := 'chunkset-sha256-v1:' || public.document_chunkset_digest(p_document_id);

  -- Claim-or-join, in one statement, because two students can press Share on the
  -- same textbook at the same second. ON CONFLICT makes the UNIQUE index the
  -- arbiter instead of a read-then-write race: the loser gets no row back from
  -- the INSERT and falls through to the SELECT, which now finds the winner's.
  INSERT INTO public.pool_documents
    (content_hash, file_name, file_size, page_count, chunk_count, contributed_by)
  VALUES
    (v_hash, v_doc.file_name, v_doc.file_size, v_doc.page_count, v_chunks, v_uid)
  ON CONFLICT (content_hash) DO NOTHING
  RETURNING id INTO v_pool_id;

  IF v_pool_id IS NULL THEN
    SELECT p.id INTO v_pool_id
    FROM public.pool_documents p
    WHERE p.content_hash = v_hash;
    IF v_pool_id IS NULL THEN
      RAISE EXCEPTION 'Could not reach the shared copy just now. Please try again.';
    END IF;
  ELSE
    -- The embedding comes across with the text. This matters more than it
    -- looks: a pooled chunk has no owner, so the client-side backfill
    -- (src/lib/embeddings.ts, which selects `user_id = me`) can never reach it.
    -- Whatever vectors exist at the moment of sharing are the vectors the pool
    -- keeps, which is why the historical backfill donates the copy with the MOST
    -- embedded chunks and why sharing is offered after the client has had a
    -- chance to embed.
    INSERT INTO public.pool_document_chunks
      (pool_document_id, chunk_index, page_start, page_end, content, token_estimate, embedding)
    SELECT v_pool_id, dc.chunk_index, dc.page_start, dc.page_end,
           dc.content, dc.token_estimate, dc.embedding
    FROM public.document_chunks dc
    WHERE dc.document_id = p_document_id;

    v_created := TRUE;
  END IF;

  -- PROVE THE COPY BEFORE TRUSTING IT. Recomputed from the pool rows, not read
  -- back from a column, so a bad copy cannot certify itself. This runs on the
  -- pre-existing branch too: it is also the check that the row we are about to
  -- hand this student is the content they actually uploaded.
  v_pool_digest := 'chunkset-sha256-v1:' || public.pool_chunkset_digest(v_pool_id);
  IF v_pool_digest IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Could not verify the shared copy, so nothing was changed.';
  END IF;

  -- Both columns in one statement: the composite foreign key is checked as a
  -- pair, and setting only one of them would fail.
  UPDATE public.documents
  SET pooled_document_id = v_pool_id,
      content_hash       = v_hash
  WHERE id = p_document_id;

  -- The private copy is now redundant. This is the whole saving, and it is safe
  -- exactly because the digest above matched: the student reads the same bytes
  -- through the pool, and the pool cannot be deleted by them or by anyone whose
  -- account goes away.
  DELETE FROM public.document_chunks WHERE document_id = p_document_id;

  RETURN QUERY SELECT v_pool_id, v_chunks, v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pool_share_document(UUID) TO authenticated;


-- ─── 6. Consumers ─────────────────────────────────────────────────────────────
--
-- Every reader of chunk content, and how each resolves a pooled copy. A missed
-- one is a student who silently gets zero results, so the list is exhaustive:
--
--   search_document_chunks          rewritten below (union of own + pooled)
--   search_document_chunks_hybrid   rewritten below (union of own + pooled)
--   promote_document_to_library     rewritten below (reads whichever holds it)
--   document_chunks_effective       new view below; used by
--                                     src/lib/studybody-data.ts and
--                                     gandd-mobile/lib/studybody-data.ts
--   supabase/functions/extract-pdf  skips a pooled document entirely (it already
--                                     has the text); code-side, gated
--   supabase/functions/ocr-worker   only ever finalises a document it OCR'd, and
--                                     a document is pooled only after it is
--                                     ready, so it never meets one; its
--                                     refresh_document_content_hash() call
--                                     returns NULL for a pooled row (section 4)
--   src/lib/embeddings.ts           unchanged and correct: it backfills the
--                                     caller's OWN chunks, and a pooled document
--                                     has none, so it no-ops instead of failing
--   src/routes/-app.chat-page.tsx   goes through search_document_chunks_hybrid;
--                                     its documents.extracted_text read is
--                                     untouched (pooling does not clear it)
--   gandd-mobile/lib/chat-client.ts goes through search_document_chunks_hybrid
--   gandd-mobile/app/(app)/coach.tsx goes through gandd-mobile/lib/studybody-data
--   scripts/ingest-library.mjs      writes library_document_chunks only
--   scripts/repair-extractions.mjs  owner-run repair; skips pooled documents (it
--                                     would write a private copy nothing reads)
--                                     and re-stamps the hash after re-extracting
--   supabase/repairs/mark-partial-extractions.sql
--                                   owner-run; excludes pooled documents, which
--                                     hold no chunks by design and would
--                                     otherwise all be marked broken
--
-- Both search RPCs used to start from `document_chunks WHERE user_id =
-- auth.uid()`. That is wrong twice over once pooling exists: a linked student
-- owns no chunks, and match_document_ids carries THEIR document ids, which no
-- pooled chunk row references. Both start from the caller's documents instead,
-- and take each document's chunks from whichever table holds them.
--
-- The security filter moves from "the chunk is mine" to "the document is mine",
-- which is the same guarantee expressed one hop earlier - and it is the only
-- form that survives de-duplication. Both stay SECURITY DEFINER, so the WHERE
-- clause below IS the access control; it is not backed up by RLS.
--
-- file_name/folder come from the CALLER'S document row, never the pool's. Two
-- students may file the same book under different names, and a citation must
-- quote the name the student sees.

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
      d.id                 AS doc_id,
      d.pooled_document_id AS pool_id,
      d.file_name,
      f.name               AS folder
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
    SELECT dc.id, md.doc_id AS document_id, md.file_name, md.folder,
           dc.chunk_index, dc.page_start, dc.page_end, dc.content
    FROM my_documents md
    JOIN public.document_chunks dc ON dc.document_id = md.doc_id
    WHERE md.pool_id IS NULL
    UNION ALL
    SELECT pc.id, md.doc_id AS document_id, md.file_name, md.folder,
           pc.chunk_index, pc.page_start, pc.page_end, pc.content
    FROM my_documents md
    JOIN public.pool_document_chunks pc ON pc.pool_document_id = md.pool_id
    WHERE md.pool_id IS NOT NULL
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
      d.id                 AS doc_id,
      d.pooled_document_id AS pool_id,
      d.file_name,
      f.name               AS folder
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
    SELECT dc.id, md.doc_id AS document_id, md.file_name, md.folder,
           dc.chunk_index, dc.page_start, dc.page_end, dc.content, dc.embedding
    FROM my_documents md
    JOIN public.document_chunks dc ON dc.document_id = md.doc_id
    WHERE md.pool_id IS NULL
    UNION ALL
    SELECT pc.id, md.doc_id AS document_id, md.file_name, md.folder,
           pc.chunk_index, pc.page_start, pc.page_end, pc.content, pc.embedding
    FROM my_documents md
    JOIN public.pool_document_chunks pc ON pc.pool_document_id = md.pool_id
    WHERE md.pool_id IS NOT NULL
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
-- If an admin promotes a pooled document, `where dc.document_id = <the student's
-- id>` matches nothing and the library book is silently added with zero chunks.
-- Read from whichever table actually holds the content. Body is otherwise
-- unchanged from 20260719130000_promote_to_library.sql.
--
-- Promotion still COPIES rather than links. The library is a separate, moderated
-- corpus with its own lifecycle - an admin re-promoting or deleting a library
-- book must never reach into the pool that live students are reading through.
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
  v_pool_id    uuid;
  v_found      boolean;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select true, d.pooled_document_id into v_found, v_pool_id
  from public.documents d
  where d.id = p_source_document_id;

  if not coalesce(v_found, false) then
    raise exception 'source document % not found', p_source_document_id;
  end if;

  select discipline into v_discipline
  from public.library_documents
  where id = p_library_id;

  -- Idempotent: clear any prior copy before re-inserting.
  delete from public.library_document_chunks
  where library_document_id = p_library_id;

  if v_pool_id is null then
    insert into public.library_document_chunks
      (library_document_id, discipline, chunk_index, page_start, page_end,
       content, token_estimate, embedding)
    select
      p_library_id, v_discipline, dc.chunk_index, dc.page_start, dc.page_end,
      dc.content, dc.token_estimate, dc.embedding
    from public.document_chunks dc
    where dc.document_id = p_source_document_id;
  else
    insert into public.library_document_chunks
      (library_document_id, discipline, chunk_index, page_start, page_end,
       content, token_estimate, embedding)
    select
      p_library_id, v_discipline, pc.chunk_index, pc.page_start, pc.page_end,
      pc.content, pc.token_estimate, pc.embedding
    from public.pool_document_chunks pc
    where pc.pool_document_id = v_pool_id;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

GRANT EXECUTE ON FUNCTION public.promote_document_to_library(uuid, uuid) TO authenticated;


-- Some consumers read chunks straight off the table by document_id rather than
-- through an RPC (StudyBody's whole-document span sampler, web and mobile). For
-- those, this view is a drop-in rename: it presents the CALLER'S document id
-- while serving whichever chunk rows that document resolves to, so
-- `.in("document_id", ids)` and the per-document grouping downstream keep
-- working unchanged.
--
-- security_invoker = true is essential. Without it the view would run as its
-- owner and bypass RLS on every table it touches, turning a convenience view
-- into a full cross-tenant leak. With it, the documents join is filtered to the
-- caller's own rows and the chunk rows are filtered by their own SELECT policies
-- - two independent restrictions that both have to hold.
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
    d.id        AS document_id,      -- the caller's document
    d.user_id   AS document_user_id,
    NULL::uuid  AS pool_document_id,
    dc.chunk_index,
    dc.page_start,
    dc.page_end,
    dc.content,
    dc.token_estimate,
    dc.created_at
  FROM public.documents d
  JOIN public.document_chunks dc ON dc.document_id = d.id
  WHERE d.pooled_document_id IS NULL
UNION ALL
  SELECT
    pc.id,
    d.id        AS document_id,
    d.user_id   AS document_user_id,
    d.pooled_document_id AS pool_document_id,
    pc.chunk_index,
    pc.page_start,
    pc.page_end,
    pc.content,
    pc.token_estimate,
    pc.created_at
  FROM public.documents d
  JOIN public.pool_document_chunks pc ON pc.pool_document_id = d.pooled_document_id
  WHERE d.pooled_document_id IS NOT NULL;

REVOKE ALL ON public.document_chunks_effective FROM anon, authenticated;
GRANT SELECT ON public.document_chunks_effective TO authenticated;


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
      AND d2.pooled_document_id IS NULL
      AND EXISTS (SELECT 1 FROM public.document_chunks dc WHERE dc.document_id = d2.id)
    ORDER BY d2.created_at
    LIMIT GREATEST(p_limit, 1)
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- One row per un-pooled document that actually holds chunks, with everything the
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
WHERE d.pooled_document_id IS NULL
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
--     * it holds at least one chunk, and is not already pooled;
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
-- DONOR selection: MOST EMBEDDED CHUNKS WINS, not oldest. 36,695 of 59,933
-- chunks have a NULL embedding, so "oldest" would routinely donate an unembedded
-- copy and demote the whole group to keyword-only search - permanently, because
-- a pooled chunk has no owner and the client backfill only ever touches its
-- caller's own rows. Ties break on oldest, then id, so the choice is stable
-- across runs.
--
-- Note the difference from the superseded design: the donor is not "the one that
-- keeps its chunks". Its copy is what SEEDS the pool, and then it becomes a link
-- like everyone else and loses its own chunks too. Every document in a group
-- ends up pooled; nobody is left holding the group's only copy.
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
    first_value(c.id) OVER w AS donor_id,
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
  r.donor_id,
  (r.rn = 1)     AS is_donor,
  r.group_size
FROM ranked r
WHERE r.group_size > 1;

COMMENT ON VIEW dedup.plan IS
  'One row per document in a provably-identical group. is_donor = its chunks seed the pool row; every row in the group (donor included) then links to that pool row and gives up its own chunks.';


-- ─── 8. SUPERSESSION, PART 2 OF 2: the old link column and its guards ─────────
--
-- Section 0 explains at length why this is down here rather than up there. The
-- one-line version: until the statements above had run,
-- public.search_document_chunks, public.search_document_chunks_hybrid and
-- public.promote_document_to_library were still the superseded bodies that
-- resolve COALESCE(d.canonical_document_id, d.id), and
-- public.document_chunks_effective was still the superseded view that selects
-- it. Sections 4 and 6 have now replaced all four, and there is no longer a
-- single statement anywhere in this file - or anywhere in the database - that
-- names canonical_document_id. It is dead weight now, and only now.
--
-- SAFE ON A VIRGIN DATABASE: every statement is IF EXISTS, so this section does
-- nothing on one that never had the old design.
--
-- The guard trigger goes here, with the column, not in section 0. It is what
-- stops a student aiming canonical_document_id at another student's document,
-- and the old search bodies would have honoured such a pointer. Guard and column
-- have to die together, or not yet.

DROP TRIGGER IF EXISTS documents_canonical_guard ON public.documents;
DROP TRIGGER IF EXISTS documents_reparent_canonical ON public.documents;

-- After the triggers, never before: a function with a trigger still attached
-- cannot be dropped without CASCADE, and CASCADE is the wrong instrument for
-- something this load-bearing.
DROP FUNCTION IF EXISTS public.documents_check_canonical_link();
DROP FUNCTION IF EXISTS public.documents_reparent_canonical();

-- Two partial indexes on canonical_document_id. DROP COLUMN would take them
-- anyway; named here so the removal is auditable rather than incidental.
DROP INDEX IF EXISTS public.idx_documents_user_canonical;
DROP INDEX IF EXISTS public.idx_documents_canonical;

-- The self-reference documents.canonical_document_id -> documents.id, auto-named
-- by Postgres when the superseded file wrote `REFERENCES public.documents(id)`.
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_canonical_document_id_fkey;

-- THE PRECONDITION, ENFORCED RATHER THAN ASSERTED.
--
-- Section 0 states three times that no documents row has canonical_document_id
-- set, and every "this narrows, never widens" argument in this file rests on it.
-- Until now nothing checked it, and the DROP below would not have: `ALTER TABLE
-- ... DROP COLUMN` does not care whether the column holds data. It drops either
-- way, silently. (20260808120300 reasons that "stage 1 would not have been able
-- to drop that column if any row had one" - that is not true of Postgres, and
-- the comment there is wrong.) The `NOT CASCADE` below is real protection, but
-- only against catalogue DEPENDENCIES; a million populated rows are not a
-- dependency.
--
-- So assert it for real. If the superseded design ever did link a document, this
-- raises and takes the whole file down with it - which is the correct outcome:
-- those links are the only record that the work happened, and the pool design
-- needs to be told about them rather than have them deleted underneath it.
-- Recovery is to read the rows out, decide what the pool equivalent is, and only
-- then re-run. IF EXISTS on the column keeps this a no-op on a virgin database.
DO $$
DECLARE
  v_linked INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'documents'
      AND column_name  = 'canonical_document_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.documents WHERE canonical_document_id IS NOT NULL'
      INTO v_linked;

    IF v_linked > 0 THEN
      RAISE EXCEPTION
        'Refusing to drop documents.canonical_document_id: % row(s) still link through it. '
        'The superseded design was used for real work, so this migration''s '
        '"no row has one set" premise does not hold. Export those rows and decide '
        'their pool equivalent before re-running stage 1.', v_linked;
    END IF;
  END IF;
END
$$;

-- Deliberately NOT `CASCADE`. If anything still depends on this column, this
-- statement must fail loudly and take the whole file down with it, not quietly
-- delete whatever it is. Nothing should: 0a removed the policy, 0c the views,
-- and sections 4 and 6 the function bodies - and function bodies never created a
-- catalogue dependency to begin with, which is exactly why their ordering had to
-- be reasoned about by hand rather than left to Postgres.
--
-- documents.content_hash stays. See 0d for why, and for the evidence that the
-- values already in it are the values the pool design wants.
ALTER TABLE public.documents
  DROP COLUMN IF EXISTS canonical_document_id;
