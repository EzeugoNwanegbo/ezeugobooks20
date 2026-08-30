-- ═══════════════════════════════════════════════════════════════════════════
-- THE HNSW INDEXES EXIST AND NEITHER HYBRID SEARCH CAN REACH THEM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR, after
-- 20260808120000_dedup_document_chunks_schema.sql (which owns the current
-- search_document_chunks_hybrid) and 20260719120000_add_library.sql (which owns
-- search_library_chunks_hybrid). Section 0 refuses rather than half-applying.
--
-- FORWARD-ONLY. Neither of those two files is edited. Both have been applied to
-- production, and a migration that has been run is a record of what happened,
-- not a draft. This is the third statement of search_document_chunks_hybrid
-- (20260608000100, then 20260808120000, then here) and the second of
-- search_library_chunks_hybrid, and it is the one that wins.
--
-- Everything here is CREATE OR REPLACE over two functions that already exist,
-- with IDENTICAL argument lists, argument names, defaults, return column names
-- and return column types, plus one CREATE INDEX IF NOT EXISTS. Nothing drops,
-- deletes or truncates. Re-running is harmless.
--
--
-- WHAT IS WRONG TODAY
-- -------------------
-- Three HNSW indexes exist and are being paid for in disk on an instance that
-- has none to spare:
--
--   idx_document_chunks_embedding_hnsw    20260608000100
--   idx_library_chunks_embedding_hnsw     20260719120000
--   idx_pool_chunks_embedding_hnsw        20260808120000
--
-- Not one of them can ever be used by the function it was created for.
-- Postgres will only read an HNSW index for `ORDER BY <indexed column> <=>
-- <constant> LIMIT n` ON THE RELATION BEING SCANNED. Both functions instead
-- compute the distance in a SELECT list, one CTE above the scan:
--
--   search_document_chunks_hybrid, scored:
--       CASE WHEN (SELECT emb FROM params) IS NOT NULL AND sc.embedding IS NOT NULL
--            THEN 1 - (sc.embedding <=> (SELECT emb FROM params))
--       ... FROM scoped_chunks sc          -- no ORDER BY, no LIMIT
--
--   search_library_chunks_hybrid, scored:
--       case when ... then 1 - (scoped.embedding <=> (select emb from params))
--       ... from scoped                    -- no ORDER BY, no LIMIT
--
-- `scoped_chunks` / `scoped` is an unbounded set. So every document-grounded
-- chat message computes an exact cosine distance for EVERY chunk the student
-- owns AND for EVERY approved chunk in the shared library, then throws all but
-- 24 and 12 of them away. Each of those distances needs the 1536-float vector
-- detoasted off disk - roughly 6 KB a row that TOAST stores out of line.
--
-- The trigram GIN indexes (idx_document_chunks_content_trgm,
-- idx_pool_chunks_content_trgm) are defeated the same way and for a second
-- reason on top. The keyword score is a correlated subquery over rows the
-- planner has already materialised, so there is no scan left to push a
-- predicate into; and the predicate is `lower(sc.content) LIKE ...`, while the
-- index is on `content` - an index on a column cannot serve a call on that
-- column. Every chunk's content is detoasted too, on every message.
--
-- The library half is the expensive half. A student's own corpus is bounded by
-- what they uploaded; the approved library is the whole shared textbook set and
-- grows with every book the owner ingests, for every student, on every message.
--
--
-- THE SHAPE THAT FIXES IT
-- -----------------------
-- Both functions become: build a bounded CANDIDATE SET the indexes can produce,
-- then score that set EXACTLY, with today's arithmetic untouched.
--
--   1. an ANN candidate query - `... FROM chunks WHERE <cheap filters>
--      ORDER BY embedding <=> :emb LIMIT 200` - which is the exact shape HNSW
--      answers;
--   2. a keyword candidate query - `content ILIKE '%' || term || '%'` per term,
--      which is the exact shape a gin_trgm_ops index answers;
--   3. the union of the two, re-scored with the ORIGINAL expressions, blended
--      with the ORIGINAL weights, and the final LIMIT taken over that union.
--
-- ILIKE rather than lower(...) LIKE is what makes step 2 indexable: pg_trgm
-- lowercases when it extracts trigrams, so an index on `content` serves ILIKE
-- but not `lower(content) LIKE`. It is not a change in meaning here. Every
-- caller builds its terms with `.toLowerCase().replace(/[^a-z0-9...]/g, ' ')`
-- (src/routes/-app.chat-page.tsx queryTerms, src/lib/studybody-data.ts
-- termsFrom and its mobile twin), the function lowercases them again, and
-- against an already-lowercase pattern ILIKE and lower()+LIKE are the same
-- predicate. The SCORING still uses the original `lower(content) LIKE`
-- expression character for character, so the emitted `kw`, `score` and `rank`
-- are unchanged.
--
-- 0.7 COSINE / 0.3 KEYWORD IS PRESERVED EXACTLY, including the two different
-- keyword caps the two functions have always had and which are NOT typos of
-- each other:
--
--   documents:  COALESCE(sim, 0) * 0.7 + LEAST(kw,  9) /  9.0 * 0.3
--   library:    coalesce(sim, 0) * 0.7 + least(kw, 10) / 10.0 * 0.3
--
-- and so are the two different rank columns (documents:
-- `GREATEST(ROUND(score * 100)::INT, 1)`; library: `row_number() OVER (ORDER BY
-- score DESC)::int`), the two different final orderings (documents: score DESC
-- then chunk_index ASC; library: score DESC only), the two different limit
-- clamps (60 and 40) and the two different final filters.
--
--
-- WHY 200 CANDIDATES, AND WHAT THAT COSTS IN RECALL
-- -------------------------------------------------
-- This is approximate where today is exact, and this product cannot afford a
-- wrong page number, so the number is chosen with a lot of room:
--
--   * The largest final limit either function can ever return is 60 (documents,
--     clamped) and 40 (library, clamped). Real callers ask for 12, 24 or 30.
--     200 is 3.3x the worst case and 6.7-8x what is actually used.
--   * The approximation is confined to MEMBERSHIP of the candidate set. Every
--     candidate is then scored with the exact `1 - (embedding <=> emb)`, so no
--     returned number is an estimate and no returned row is mis-ranked relative
--     to another returned row.
--   * A chunk that is neither in the ANN top-200 nor a keyword match cannot
--     have beaten the 200 rows ahead of it: with kw = 0 its score is exactly
--     0.7 * sim, and 200 chunks have a higher sim. So dropping it is not a
--     recall loss at all EXCEPT through HNSW's own error - and HNSW's error is
--     concentrated in the tail, not in the near neighbours that make a top-24.
--   * hnsw.ef_search is raised to 400 for the duration of the call. pgvector
--     will not return more rows than ef_search, so the default 40 would have
--     silently capped a LIMIT 200 at 40 rows. 400 is 2x the candidate count,
--     which buys recall headroom and absorbs the rows lost to the post-scan
--     filters below. It is well inside pgvector's permitted range and costs
--     single-digit milliseconds.
--   * hnsw.iterative_scan is set to relaxed_order where the installed pgvector
--     is new enough to have it, so a filtered scan can keep going instead of
--     stopping at ef_search candidates. Relaxed order is fine BECAUSE the
--     candidate set is re-scored exactly afterwards - the order it arrives in
--     is never used.
--   * hnsw.max_scan_tuples is brought DOWN to 2000 from pgvector's default of
--     20000. That default is a bad trade here: an iterative scan against a
--     filter as selective as "one student's documents out of everybody's" will
--     happily visit twenty thousand heap tuples and still come back short,
--     which is a second or more of random I/O spent on a result the backstop
--     below then has to compute exactly anyway. 2000 is five times ef_search -
--     enough to rescue a moderately selective filter, cheap enough that being
--     wrong about it costs tens of milliseconds rather than seconds.
--
-- THE POST-FILTER CLIFF, AND THE BACKSTOP FOR IT
-- ----------------------------------------------
-- An HNSW scan cannot filter inside the index. It walks the graph in global
-- distance order and the executor throws away rows that fail the WHERE clause.
-- That is harmless for the library, where `status = 'approved'` keeps most of
-- the table. It is dangerous for document_chunks, where the filter is "this one
-- student's documents" out of everybody's - the 400 globally-nearest chunks may
-- contain none of theirs, and the honest answer would be an empty retrieval.
--
-- So every ANN step here is followed by a two-line check: if it came back with
-- fewer than 200 candidates, count (capped at 200) how many rows were actually
-- available to it. If more were available than came back, the index scan gave
-- up early and the step is redone as an EXACT brute-force top-200 through a
-- `WITH ... AS MATERIALIZED` CTE, which the planner cannot push an index into
-- and which is therefore exactly what the function does today.
--
-- The probe is skipped entirely in the healthy case (200 candidates came back),
-- and when it does run it is a capped index-only count of at most 200 rows. The
-- fallback it guards is never slower than today's behaviour, because it IS
-- today's behaviour. The net effect is: this change can make retrieval faster
-- and it cannot make it emptier.
--
--
-- WHAT THE KEYWORD SIDE COSTS
-- ---------------------------
-- Nothing, on the documents side: the per-term candidate query is bounded by
-- the caller's own corpus, which is the same set today's function scans in
-- full, so its worst case is today's normal case.
--
-- On the library side each term is capped at 500 candidate chunks. A term that
-- matches more than 500 chunks of a shared textbook corpus is not a
-- discriminating term, and the cap is what stops one common word turning a
-- bounded query back into the full scan this file exists to remove. The cap is
-- honest about one thing: which 500 is arbitrary (physical order), so in the
-- rare KEYWORD-ONLY mode - the embedding service is down, so query_embedding
-- arrives NULL - a very common term can now surface different library chunks
-- than it used to. With an embedding present, which is the normal path, the
-- keyword term is worth at most 0.3 against similarity's 0.7 and the cap
-- cannot move a top result on its own.
--
-- A file-name / folder / title match is worth +2 per term to EVERY chunk of
-- that document, which today drags the document's whole chunk set into the
-- scored set. Here it contributes the first `match_count` chunks of that
-- document by chunk_index, which is sufficient rather than arbitrary: those
-- chunks all carry the same flat score, the documents function breaks ties by
-- chunk_index ASC, and any chunk of that document that scores ABOVE the flat
-- baseline does so through a content match and is already a candidate from the
-- step before.
--
--
-- THE ONE DELIBERATE BEHAVIOUR CHANGE
-- -----------------------------------
-- `match_count => NULL` used to mean NO LIMIT. `LEAST(GREATEST(match_count, 1),
-- 60)` is NULL when match_count is NULL, and `LIMIT NULL` returns everything -
-- so an explicit NULL asked both functions to return the caller's entire corpus
-- and the entire library, embedding-scored, in one response. That was never
-- intended, no caller does it (every call site passes a number; the generated
-- types make the argument optional, not nullable-with-meaning), and it is now
-- COALESCEd to the declared default. Omitting the argument is unaffected: that
-- takes the DEFAULT, which is what every caller relies on.
--
--
-- SECURITY: WHAT MUST NOT MOVE, AND WHERE IT NOW LIVES
-- ----------------------------------------------------
-- Both functions are SECURITY DEFINER. Their WHERE clauses ARE the access
-- control; there is no RLS underneath to catch a mistake. A rewrite that widens
-- visibility by one row is a leak between students.
--
-- search_document_chunks_hybrid. The filter is, and stays, "the DOCUMENT is
-- mine" - the form 20260808120000 moved it to, because a student linked to a
-- pooled document owns no chunk rows at all. It is evaluated ONCE, at the top,
-- in a single statement:
--
--     FROM public.documents d
--     WHERE d.user_id = auth.uid()
--       AND (match_document_ids IS NULL
--            OR array_length(match_document_ids, 1) IS NULL
--            OR d.id = ANY(match_document_ids))
--
-- Every later step reads only from the id arrays that statement produced, and
-- the final scoring query joins back to those same document ids, so a chunk id
-- that somehow reached the candidate list without belonging to the caller is
-- dropped again by the join. Two gates, one predicate, written once.
--
-- file_name and folder still come from the CALLER'S documents row and never
-- from the pool row, so a citation quotes the name the student filed the book
-- under. Pooled chunks are still reached through pool_document_chunks by
-- pool_document_id, and a caller with two documents pointing at the same pool
-- still sees that pool's chunks once per document, exactly as today.
--
-- search_library_chunks_hybrid. `ld.status = 'approved'` and the discipline
-- rule `(match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline =
-- match_discipline)` are stated on EVERY candidate query and then AGAIN on the
-- final scoring query. A pending or rejected book cannot become a candidate,
-- and could not survive re-scoring if it did. The function still takes no
-- caller identity and is still granted to anon as well as authenticated, which
-- is deliberate and unchanged - the approved library is public by design.
--
-- Neither function gains, loses or reinterprets an argument.
--
--
-- WHY plpgsql
-- -----------
-- Both were LANGUAGE sql. Both become LANGUAGE plpgsql, which CREATE OR REPLACE
-- permits and which changes nothing a caller can observe (a SECURITY DEFINER
-- function is never inlined anyway). It buys three things this rewrite needs:
--
--   * the query embedding is parsed ONCE into a vector variable and passed to
--     each query as a parameter. That is what makes `ORDER BY embedding <=>
--     v_emb LIMIT k` index-eligible - a plpgsql variable reaches the planner as
--     a parameter, which is a pseudo-constant, which is what HNSW requires;
--   * the candidate steps can be skipped rather than filtered. `WHERE
--     v_emb IS NOT NULL` in a single statement does not stop the scan
--     underneath it; an IF does;
--   * the short-result backstop above needs a branch.
--
-- plan_cache_mode is forced to custom for the call. These queries live or die
-- on the planner knowing how many document ids are in the array and what the
-- LIMIT actually is; a generic plan knows neither and would cost the ANN scan
-- against a guess. Set with is_local, so it reverts with the transaction
-- PostgREST wraps the request in.
--
-- The three set_config calls are each wrapped in their own exception block. Two
-- of the three GUCs belong to pgvector, and pgvector's version on this instance
-- is not something this file can check. If a name is unknown Postgres accepts
-- it as a placeholder and ignores it; if a value is ever rejected the block
-- swallows it and the function still returns correct rows, only slower. A
-- performance setting must not be able to take retrieval down.
--
--
-- THE ONE MISSING INDEX (section 4, and it costs disk)
-- ----------------------------------------------------
-- document_chunks and pool_document_chunks both have a gin_trgm_ops index on
-- content. library_document_chunks - the biggest text of the three and the one
-- every student reads - does not. Section 4 adds it, LAST, so that if it is
-- refused the two functions are already in place.
--
-- READ SECTION 4 BEFORE PASTING THIS. It is the only statement in this file
-- that consumes space, this instance has been over its tier's cap before, and a
-- trigram index is a large fraction of the text it covers. The functions are
-- CORRECT without it - the library keyword pass simply falls back to a filtered
-- scan, which is what happens today - so deleting section 4 is a supported way
-- to apply this file.
--
--
-- WHAT DOES NOT NEED DOING AFTERWARDS
-- -----------------------------------
-- No client change, on web or on mobile. Both signatures are byte-identical to
-- the ones already deployed, so src/routes/-app.chat-page.tsx,
-- src/lib/studybody-data.ts, gandd-mobile/lib/chat-client.ts and
-- gandd-mobile/lib/studybody-data.ts keep working across the change, in either
-- order, with no window in which one is ahead of the other.
-- src/integrations/supabase/types.ts already describes exactly these arguments
-- and return columns and does not need regenerating.
--
-- Nothing is backfilled. No row is written, moved or deleted by this file.


-- ── Section 0: guard ────────────────────────────────────────────────────────
-- Checks the SCHEMA THIS REWRITE NAMES, not just that something called
-- search_document_chunks_hybrid exists. Naming unapplied schema fails the whole
-- statement, and the pooled-chunks tables are named throughout section 1.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION
      'The vector extension is not installed. Apply 20260608000100_add_chunk_embeddings.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'pool_document_chunks'
  ) THEN
    RAISE EXCEPTION
      'public.pool_document_chunks is missing. Apply 20260808120000_dedup_document_chunks_schema.sql first - section 1 below reads pooled chunks and would fail on every call.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents'
      AND column_name = 'pooled_document_id'
  ) THEN
    RAISE EXCEPTION
      'public.documents.pooled_document_id is missing. Apply 20260808120000_dedup_document_chunks_schema.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'library_document_chunks'
  ) THEN
    RAISE EXCEPTION
      'public.library_document_chunks is missing. Apply 20260719120000_add_library.sql first.';
  END IF;

  -- Replacing, not creating. If either function is absent then some earlier
  -- migration did not run and this file would be inventing it with a body that
  -- assumes the rest of that migration is there.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_document_chunks_hybrid'
  ) THEN
    RAISE EXCEPTION
      'public.search_document_chunks_hybrid is missing. Apply 20260608000100_add_chunk_embeddings.sql and 20260808120000_dedup_document_chunks_schema.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_library_chunks_hybrid'
  ) THEN
    RAISE EXCEPTION
      'public.search_library_chunks_hybrid is missing. Apply 20260719120000_add_library.sql first.';
  END IF;

  -- Not fatal: a missing ANN index makes this file pointless for that table,
  -- not wrong. Say so instead of refusing.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_document_chunks_embedding_hnsw') THEN
    RAISE NOTICE 'idx_document_chunks_embedding_hnsw is missing; own-document search will brute-force as it does today.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_pool_chunks_embedding_hnsw') THEN
    RAISE NOTICE 'idx_pool_chunks_embedding_hnsw is missing; pooled-document search will brute-force as it does today.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_library_chunks_embedding_hnsw') THEN
    RAISE NOTICE 'idx_library_chunks_embedding_hnsw is missing; library search will brute-force as it does today.';
  END IF;
END
$guard$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Section 1: search_document_chunks_hybrid
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Signature, argument names, defaults and every return column are exactly those
-- of 20260808120000_dedup_document_chunks_schema.sql section 6. Chat retrieval
-- on web AND on mobile goes through this function; nothing about the call
-- changes.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
#variable_conflict use_column
-- The pragma above is first by requirement. RETURNS TABLE makes id, content,
-- rank and the rest into variables; every column reference in this body is
-- table-qualified, and the pragma is the belt to that pair of braces. It is
-- safe because no local here is named after a column.
DECLARE
  -- COALESCE: see "THE ONE DELIBERATE BEHAVIOUR CHANGE" in the header. The
  -- clamp itself - 1..60 - is unchanged.
  v_lim        INT := LEAST(GREATEST(COALESCE(match_count, 24), 1), 60);
  -- Candidates per ANN step. 3.3x the largest limit this function can return.
  v_ann_k      INT := 200;
  v_emb        vector;
  v_terms      TEXT[];
  v_my_docs    UUID[];   -- every document this call is allowed to read
  v_own_docs   UUID[];   -- ...of those, the ones holding their own chunks
  v_pool_ids   UUID[];   -- ...and the pool rows the rest read through
  v_name_docs  UUID[];   -- own documents whose file_name/folder matched a term
  v_name_pools UUID[];   -- pool ids of pooled documents that matched by name
  v_own_cand   UUID[] := ARRAY[]::UUID[];
  v_pool_cand  UUID[] := ARRAY[]::UUID[];
  v_tmp        UUID[];
  v_avail      INT;
BEGIN
  -- auth.uid() IS the access check here; there is no RLS behind a SECURITY
  -- DEFINER function. An unauthenticated caller matched no documents before
  -- (d.user_id = NULL is never true) and returns nothing now.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Parse the embedding literal once. NULL or blank means keyword-only, which
  -- is what the callers rely on when the embedding service is unavailable.
  IF query_embedding IS NOT NULL AND length(trim(query_embedding)) > 0 THEN
    v_emb := query_embedding::vector;
  END IF;

  -- Same normalisation the old normalized_terms CTE did: lowercased, trimmed,
  -- de-duplicated, and only terms longer than two characters.
  SELECT COALESCE(array_agg(DISTINCT lower(trim(t.term))), ARRAY[]::TEXT[])
    INTO v_terms
    FROM unnest(COALESCE(query_terms, ARRAY[]::TEXT[])) AS t(term)
   WHERE length(trim(t.term)) > 2;

  -- Planner settings for this call only. Each is optional and each is allowed
  -- to fail: correctness never depends on any of them. See the header.
  BEGIN
    PERFORM set_config('plan_cache_mode', 'force_custom_plan', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM set_config('hnsw.ef_search', '400', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM set_config('hnsw.max_scan_tuples', '2000', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ─────────────────────────────────────────────────────────────────────────
  -- THE ACCESS CHECK. Once, here, and nowhere else. Everything below reads
  -- from the arrays this produces.
  -- ─────────────────────────────────────────────────────────────────────────
  SELECT array_agg(d.id),
         array_agg(d.id)                 FILTER (WHERE d.pooled_document_id IS NULL),
         array_agg(d.pooled_document_id) FILTER (WHERE d.pooled_document_id IS NOT NULL)
    INTO v_my_docs, v_own_docs, v_pool_ids
    FROM public.documents d
   WHERE d.user_id = auth.uid()
     AND (
       match_document_ids IS NULL
       OR array_length(match_document_ids, 1) IS NULL
       OR d.id = ANY(match_document_ids)
     );

  IF v_my_docs IS NULL THEN
    RETURN;
  END IF;

  -- ── Candidates 1: nearest neighbours among my OWN chunks ─────────────────
  IF v_emb IS NOT NULL AND array_length(v_own_docs, 1) IS NOT NULL THEN
    SELECT array_agg(a.id) INTO v_tmp
      FROM (
        SELECT dc.id
          FROM public.document_chunks dc
         WHERE dc.document_id = ANY(v_own_docs)
           AND dc.embedding IS NOT NULL
         ORDER BY dc.embedding <=> v_emb
         LIMIT v_ann_k
      ) a;

    -- The post-filter cliff backstop. "Fewer than asked for" is the observable
    -- symptom of an HNSW scan that ran out of graph before it ran out of rows
    -- belonging to this student.
    IF COALESCE(array_length(v_tmp, 1), 0) < v_ann_k THEN
      SELECT count(*)::INT INTO v_avail
        FROM (
          SELECT 1
            FROM public.document_chunks dc
           WHERE dc.document_id = ANY(v_own_docs)
             AND dc.embedding IS NOT NULL
           LIMIT v_ann_k
        ) p;

      IF v_avail > COALESCE(array_length(v_tmp, 1), 0) THEN
        -- AS MATERIALIZED is load-bearing: it puts a CTE scan between the table
        -- and the ORDER BY so no index can be chosen, which makes this an exact
        -- brute force over precisely this caller's chunks - what the function
        -- does today.
        SELECT array_agg(a.id) INTO v_tmp
          FROM (
            WITH scoped AS MATERIALIZED (
              SELECT dc.id, dc.embedding
                FROM public.document_chunks dc
               WHERE dc.document_id = ANY(v_own_docs)
                 AND dc.embedding IS NOT NULL
            )
            SELECT s.id FROM scoped s ORDER BY s.embedding <=> v_emb LIMIT v_ann_k
          ) a;
      END IF;
    END IF;

    v_own_cand := v_own_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  -- ── Candidates 2: nearest neighbours among my POOLED chunks ──────────────
  IF v_emb IS NOT NULL AND array_length(v_pool_ids, 1) IS NOT NULL THEN
    SELECT array_agg(a.id) INTO v_tmp
      FROM (
        SELECT pc.id
          FROM public.pool_document_chunks pc
         WHERE pc.pool_document_id = ANY(v_pool_ids)
           AND pc.embedding IS NOT NULL
         ORDER BY pc.embedding <=> v_emb
         LIMIT v_ann_k
      ) a;

    IF COALESCE(array_length(v_tmp, 1), 0) < v_ann_k THEN
      SELECT count(*)::INT INTO v_avail
        FROM (
          SELECT 1
            FROM public.pool_document_chunks pc
           WHERE pc.pool_document_id = ANY(v_pool_ids)
             AND pc.embedding IS NOT NULL
           LIMIT v_ann_k
        ) p;

      IF v_avail > COALESCE(array_length(v_tmp, 1), 0) THEN
        SELECT array_agg(a.id) INTO v_tmp
          FROM (
            WITH scoped AS MATERIALIZED (
              SELECT pc.id, pc.embedding
                FROM public.pool_document_chunks pc
               WHERE pc.pool_document_id = ANY(v_pool_ids)
                 AND pc.embedding IS NOT NULL
            )
            SELECT s.id FROM scoped s ORDER BY s.embedding <=> v_emb LIMIT v_ann_k
          ) a;
      END IF;
    END IF;

    v_pool_cand := v_pool_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  -- ── Candidates 3: keyword hits in chunk CONTENT ──────────────────────────
  -- One indexable predicate per term, so idx_document_chunks_content_trgm and
  -- idx_pool_chunks_content_trgm are both reachable. Uncapped on purpose: the
  -- worst case is every chunk of the caller's own corpus, which is the set
  -- today's function scans on every single message.
  IF array_length(v_terms, 1) IS NOT NULL AND array_length(v_own_docs, 1) IS NOT NULL THEN
    SELECT array_agg(DISTINCT k.id) INTO v_tmp
      FROM unnest(v_terms) AS q(term)
      CROSS JOIN LATERAL (
        SELECT dc.id
          FROM public.document_chunks dc
         WHERE dc.document_id = ANY(v_own_docs)
           AND dc.content ILIKE '%' || q.term || '%'
      ) k;
    v_own_cand := v_own_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  IF array_length(v_terms, 1) IS NOT NULL AND array_length(v_pool_ids, 1) IS NOT NULL THEN
    SELECT array_agg(DISTINCT k.id) INTO v_tmp
      FROM unnest(v_terms) AS q(term)
      CROSS JOIN LATERAL (
        SELECT pc.id
          FROM public.pool_document_chunks pc
         WHERE pc.pool_document_id = ANY(v_pool_ids)
           AND pc.content ILIKE '%' || q.term || '%'
      ) k;
    v_pool_cand := v_pool_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  -- ── Candidates 4: documents whose NAME or FOLDER matched ─────────────────
  -- Worth +2 per term to every chunk of the document, so today the whole
  -- document is scored. The first v_lim chunks by chunk_index are sufficient:
  -- that flat bonus is identical across the document, the final ORDER BY breaks
  -- ties by chunk_index ASC, and any chunk that scores above the flat baseline
  -- got there through a content match and is already a candidate above.
  IF array_length(v_terms, 1) IS NOT NULL THEN
    SELECT array_agg(m.doc_id) FILTER (WHERE m.pool_id IS NULL),
           array_agg(m.pool_id) FILTER (WHERE m.pool_id IS NOT NULL)
      INTO v_name_docs, v_name_pools
      FROM (
        SELECT d.id                 AS doc_id,
               d.pooled_document_id AS pool_id,
               lower(d.file_name || ' ' || COALESCE(f.name, '')) AS haystack
          FROM public.documents d
          LEFT JOIN public.folders f ON f.id = d.folder_id
         WHERE d.id = ANY(v_my_docs)
      ) m
     WHERE EXISTS (
       SELECT 1 FROM unnest(v_terms) AS q(term)
        WHERE m.haystack LIKE '%' || q.term || '%'
     );

    IF array_length(v_name_docs, 1) IS NOT NULL THEN
      SELECT array_agg(DISTINCT c.id) INTO v_tmp
        FROM unnest(v_name_docs) AS q(doc_id)
        CROSS JOIN LATERAL (
          SELECT dc.id
            FROM public.document_chunks dc
           WHERE dc.document_id = q.doc_id
           ORDER BY dc.chunk_index
           LIMIT v_lim
        ) c;
      v_own_cand := v_own_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
    END IF;

    IF array_length(v_name_pools, 1) IS NOT NULL THEN
      SELECT array_agg(DISTINCT c.id) INTO v_tmp
        FROM unnest(v_name_pools) AS q(pool_id)
        CROSS JOIN LATERAL (
          SELECT pc.id
            FROM public.pool_document_chunks pc
           WHERE pc.pool_document_id = q.pool_id
           ORDER BY pc.chunk_index
           LIMIT v_lim
        ) c;
      v_pool_cand := v_pool_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
    END IF;
  END IF;

  -- ── Candidates 5: no terms AND no embedding ──────────────────────────────
  -- The degenerate call. Today's `NOT EXISTS (SELECT 1 FROM normalized_terms)`
  -- branch returns the caller's first chunks by chunk_index with rank 1, and
  -- this reproduces it rather than returning nothing.
  IF v_emb IS NULL AND array_length(v_terms, 1) IS NULL THEN
    IF array_length(v_own_docs, 1) IS NOT NULL THEN
      SELECT array_agg(a.id) INTO v_tmp
        FROM (
          SELECT dc.id
            FROM public.document_chunks dc
           WHERE dc.document_id = ANY(v_own_docs)
           ORDER BY dc.chunk_index
           LIMIT v_lim
        ) a;
      v_own_cand := v_own_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
    END IF;

    IF array_length(v_pool_ids, 1) IS NOT NULL THEN
      SELECT array_agg(a.id) INTO v_tmp
        FROM (
          SELECT pc.id
            FROM public.pool_document_chunks pc
           WHERE pc.pool_document_id = ANY(v_pool_ids)
           ORDER BY pc.chunk_index
           LIMIT v_lim
        ) a;
      v_pool_cand := v_pool_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
    END IF;
  END IF;

  IF array_length(v_own_cand, 1) IS NULL AND array_length(v_pool_cand, 1) IS NULL THEN
    RETURN;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────
  -- SCORING. Bounded set, original arithmetic, original weights, original
  -- filter, original ordering, original rank expression. The only thing that
  -- changed is which rows got this far.
  --
  -- The join to my_documents is the second access gate: a candidate id that is
  -- not a chunk of one of this caller's documents finds no row to join to and
  -- disappears. It is also where file_name and folder come from - the CALLER'S
  -- row, never the pool's.
  -- ─────────────────────────────────────────────────────────────────────────
  RETURN QUERY
  WITH my_documents AS (
    SELECT d.id                 AS doc_id,
           d.pooled_document_id AS pool_id,
           d.file_name,
           f.name               AS folder
      FROM public.documents d
      LEFT JOIN public.folders f ON f.id = d.folder_id
     WHERE d.id = ANY(v_my_docs)
  ),
  candidates AS (
    SELECT dc.id, md.doc_id AS document_id, md.file_name, md.folder,
           dc.chunk_index, dc.page_start, dc.page_end, dc.content, dc.embedding
      FROM my_documents md
      JOIN public.document_chunks dc ON dc.document_id = md.doc_id
     WHERE md.pool_id IS NULL
       AND dc.id = ANY(v_own_cand)
    UNION ALL
    SELECT pc.id, md.doc_id AS document_id, md.file_name, md.folder,
           pc.chunk_index, pc.page_start, pc.page_end, pc.content, pc.embedding
      FROM my_documents md
      JOIN public.pool_document_chunks pc ON pc.pool_document_id = md.pool_id
     WHERE md.pool_id IS NOT NULL
       AND pc.id = ANY(v_pool_cand)
  ),
  scored AS (
    SELECT
      c.id,
      c.document_id,
      c.file_name,
      c.folder,
      c.chunk_index,
      c.page_start,
      c.page_end,
      c.content,
      (
        SELECT COALESCE(SUM(
          CASE WHEN lower(c.content) LIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
          + CASE
              WHEN lower(c.file_name || ' ' || COALESCE(c.folder, '')) LIKE '%' || nt.term || '%'
              THEN 2
              ELSE 0
            END
        ), 0)
        FROM unnest(v_terms) AS nt(term)
      ) AS kw,
      CASE
        WHEN v_emb IS NOT NULL AND c.embedding IS NOT NULL
          THEN 1 - (c.embedding <=> v_emb)
        ELSE NULL
      END AS sim
      FROM candidates c
  ),
  blended AS (
    -- 70% meaning, 30% exact-keyword. Unchanged, cap included.
    SELECT scored.*,
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
    OR array_length(v_terms, 1) IS NULL
  ORDER BY blended.score DESC, blended.chunk_index ASC
  LIMIT v_lim;
END;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Section 2: search_library_chunks_hybrid
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Signature, argument names, defaults and every return column are exactly those
-- of 20260719120000_add_library.sql section 4. Still no caller identity, still
-- granted to anon: the approved library is public by design and that is not
-- what this change is about.
CREATE OR REPLACE FUNCTION public.search_library_chunks_hybrid(
  query_terms TEXT[],
  query_embedding TEXT DEFAULT NULL,
  match_discipline TEXT DEFAULT NULL,
  match_count INT DEFAULT 12
)
RETURNS TABLE (
  id UUID,
  library_document_id UUID,
  title TEXT,
  chunk_index INT,
  page_start INT,
  page_end INT,
  content TEXT,
  rank INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
#variable_conflict use_column
DECLARE
  v_lim         INT := LEAST(GREATEST(COALESCE(match_count, 12), 1), 40);
  v_ann_k       INT := 200;
  -- Per term. The shared corpus is not bounded by anything the caller owns, so
  -- one very common word must not be able to pull the whole library in.
  v_kw_per_term INT := 500;
  v_emb         vector;
  v_terms       TEXT[];
  v_cand        UUID[] := ARRAY[]::UUID[];
  v_tmp         UUID[];
  v_avail       INT;
BEGIN
  IF query_embedding IS NOT NULL AND length(trim(query_embedding)) > 0 THEN
    v_emb := query_embedding::vector;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(trim(t.term))), ARRAY[]::TEXT[])
    INTO v_terms
    FROM unnest(COALESCE(query_terms, ARRAY[]::TEXT[])) AS t(term)
   WHERE length(trim(t.term)) > 2;

  BEGIN
    PERFORM set_config('plan_cache_mode', 'force_custom_plan', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM set_config('hnsw.ef_search', '400', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM set_config('hnsw.max_scan_tuples', '2000', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Candidates 1: nearest neighbours in the APPROVED library ─────────────
  -- status = 'approved' and the discipline rule are stated here, on every other
  -- candidate query below, and once more on the scoring query. A pending or
  -- rejected book cannot enter, and could not survive if it did.
  IF v_emb IS NOT NULL THEN
    SELECT array_agg(a.id) INTO v_tmp
      FROM (
        SELECT lc.id
          FROM public.library_document_chunks lc
          JOIN public.library_documents ld ON ld.id = lc.library_document_id
         WHERE ld.status = 'approved'
           AND (match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline = match_discipline)
           AND lc.embedding IS NOT NULL
         ORDER BY lc.embedding <=> v_emb
         LIMIT v_ann_k
      ) a;

    IF COALESCE(array_length(v_tmp, 1), 0) < v_ann_k THEN
      SELECT count(*)::INT INTO v_avail
        FROM (
          SELECT 1
            FROM public.library_document_chunks lc
            JOIN public.library_documents ld ON ld.id = lc.library_document_id
           WHERE ld.status = 'approved'
             AND (match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline = match_discipline)
             AND lc.embedding IS NOT NULL
           LIMIT v_ann_k
        ) p;

      IF v_avail > COALESCE(array_length(v_tmp, 1), 0) THEN
        SELECT array_agg(a.id) INTO v_tmp
          FROM (
            WITH scoped AS MATERIALIZED (
              SELECT lc.id, lc.embedding
                FROM public.library_document_chunks lc
                JOIN public.library_documents ld ON ld.id = lc.library_document_id
               WHERE ld.status = 'approved'
                 AND (match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline = match_discipline)
                 AND lc.embedding IS NOT NULL
            )
            SELECT s.id FROM scoped s ORDER BY s.embedding <=> v_emb LIMIT v_ann_k
          ) a;
      END IF;
    END IF;

    v_cand := v_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  -- ── Candidates 2: keyword hits in chunk CONTENT ──────────────────────────
  -- One indexable predicate per term. Needs section 4's trigram index to be
  -- fast; correct either way.
  IF array_length(v_terms, 1) IS NOT NULL THEN
    SELECT array_agg(DISTINCT k.id) INTO v_tmp
      FROM unnest(v_terms) AS q(term)
      CROSS JOIN LATERAL (
        SELECT lc.id
          FROM public.library_document_chunks lc
          JOIN public.library_documents ld ON ld.id = lc.library_document_id
         WHERE ld.status = 'approved'
           AND (match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline = match_discipline)
           AND lc.content ILIKE '%' || q.term || '%'
         LIMIT v_kw_per_term
      ) k;
    v_cand := v_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  -- ── Candidates 3: books whose TITLE matched ──────────────────────────────
  -- +2 per term to every chunk of the book; the first v_lim by chunk_index are
  -- enough, for the reason set out in section 1.
  IF array_length(v_terms, 1) IS NOT NULL THEN
    SELECT array_agg(DISTINCT c.id) INTO v_tmp
      FROM (
        SELECT ld.id AS book_id
          FROM public.library_documents ld
         WHERE ld.status = 'approved'
           AND EXISTS (
             SELECT 1 FROM unnest(v_terms) AS q(term)
              WHERE lower(COALESCE(ld.title, '')) LIKE '%' || q.term || '%'
           )
      ) b
      CROSS JOIN LATERAL (
        SELECT lc.id
          FROM public.library_document_chunks lc
         WHERE lc.library_document_id = b.book_id
           AND (match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline = match_discipline)
         ORDER BY lc.chunk_index
         LIMIT v_lim
      ) c;
    v_cand := v_cand || COALESCE(v_tmp, ARRAY[]::UUID[]);
  END IF;

  -- No candidates. Today's filter is `score > 0 or emb is not null`, so a call
  -- with neither an embedding nor a matching term returned nothing before and
  -- returns nothing now.
  IF array_length(v_cand, 1) IS NULL THEN
    RETURN;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────
  -- SCORING. Original arithmetic, original 0.7/0.3 blend with the library's
  -- own cap of 10, original row_number() rank, original filter, original order.
  -- ─────────────────────────────────────────────────────────────────────────
  RETURN QUERY
  WITH candidates AS (
    SELECT lc.id, lc.library_document_id, ld.title, lc.chunk_index,
           lc.page_start, lc.page_end, lc.content, lc.embedding
      FROM public.library_document_chunks lc
      JOIN public.library_documents ld ON ld.id = lc.library_document_id
     WHERE lc.id = ANY(v_cand)
       AND ld.status = 'approved'
       AND (match_discipline IS NULL OR lc.discipline IS NULL OR lc.discipline = match_discipline)
  ),
  scored AS (
    SELECT
      c.id, c.library_document_id, c.title, c.chunk_index,
      c.page_start, c.page_end, c.content,
      (
        SELECT COALESCE(SUM(
          CASE WHEN lower(c.content) LIKE '%' || nt.term || '%' THEN 3 ELSE 0 END
          + CASE WHEN lower(COALESCE(c.title, '')) LIKE '%' || nt.term || '%' THEN 2 ELSE 0 END
        ), 0)
        FROM unnest(v_terms) AS nt(term)
      ) AS kw,
      CASE
        WHEN v_emb IS NOT NULL AND c.embedding IS NOT NULL
          THEN 1 - (c.embedding <=> v_emb)
        ELSE NULL
      END AS sim
      FROM candidates c
  ),
  blended AS (
    SELECT scored.id, scored.library_document_id, scored.title, scored.chunk_index,
           scored.page_start, scored.page_end, scored.content,
           (COALESCE(scored.sim, 0) * 0.7 + LEAST(scored.kw, 10) / 10.0 * 0.3) AS score
      FROM scored
  )
  SELECT
    blended.id,
    blended.library_document_id,
    blended.title,
    blended.chunk_index,
    blended.page_start,
    blended.page_end,
    blended.content,
    row_number() OVER (ORDER BY blended.score DESC)::INT AS rank
  FROM blended
  WHERE blended.score > 0 OR v_emb IS NOT NULL
  ORDER BY blended.score DESC
  LIMIT v_lim;
END;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Section 3: grants and comments
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE preserves existing privileges, so these are restatements
-- rather than repairs. They are here because the two files this supersedes
-- state them too, and a file that replaces a function should leave no doubt
-- about who may call it afterwards. Note the asymmetry, which is deliberate and
-- pre-existing: the per-student search is for authenticated callers only; the
-- approved library is readable by anon as well.
GRANT EXECUTE ON FUNCTION public.search_document_chunks_hybrid(TEXT[], TEXT, UUID[], INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_library_chunks_hybrid(TEXT[], TEXT, TEXT, INT)
  TO authenticated, anon;

COMMENT ON FUNCTION public.search_document_chunks_hybrid(TEXT[], TEXT, UUID[], INT) IS
  'Hybrid retrieval over the caller''s own and pooled chunks: 0.7 cosine + 0.3 keyword, unchanged since 20260608000100. Candidates come from an HNSW top-200 plus every trigram keyword hit, and are then scored exactly; the access check is documents.user_id = auth.uid(), evaluated once and re-applied by the join in the scoring query.';
COMMENT ON FUNCTION public.search_library_chunks_hybrid(TEXT[], TEXT, TEXT, INT) IS
  'Hybrid retrieval over APPROVED library chunks: 0.7 cosine + 0.3 keyword, unchanged since 20260719120000. Candidates come from an HNSW top-200 plus up to 500 trigram keyword hits per term, and are then scored exactly; status = ''approved'' and the discipline rule are stated on every candidate query and again on the scoring query.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Section 4: the trigram index the library never got - AND IT COSTS DISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- document_chunks has idx_document_chunks_content_trgm (20260430002000) and
-- pool_document_chunks has idx_pool_chunks_content_trgm (20260808120000).
-- library_document_chunks has none, and it is the largest body of text on the
-- instance and the one every student reads on every smart-mode message.
--
-- THIS IS THE ONLY STATEMENT IN THIS FILE THAT CONSUMES SPACE. A gin_trgm_ops
-- index runs to a substantial fraction of the text it covers, and this database
-- has been over its tier's storage cap before. Check first:
--
--   SELECT pg_size_pretty(pg_total_relation_size('public.library_document_chunks')) AS table_total,
--          pg_size_pretty(pg_relation_size('public.library_document_chunks'))       AS heap,
--          pg_size_pretty(pg_database_size(current_database()))                     AS db_total;
--
-- and afterwards:
--
--   SELECT pg_size_pretty(pg_relation_size('public.idx_library_chunks_content_trgm'));
--
-- IF SPACE IS TIGHT, DELETE THIS SECTION AND APPLY THE REST. Section 2 is
-- correct without it - the library keyword pass falls back to a filtered scan,
-- which is exactly what happens today - and it can be added later, or added
-- CONCURRENTLY outside a transaction, without touching either function:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_chunks_content_trgm
--     ON public.library_document_chunks USING gin (content gin_trgm_ops);
--
-- Not CONCURRENTLY here, because CONCURRENTLY cannot run inside a transaction
-- block and this file is meant to be pasted and run whole. That means this
-- statement takes a lock that blocks WRITES to library_document_chunks while it
-- builds. Writes to that table are admin ingest only (scripts/ingest-library.mjs
-- and promote_document_to_library), never a student action, so the window
-- affects nobody who is using the app - but do not run it in the middle of an
-- ingest.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_library_chunks_content_trgm
  ON public.library_document_chunks USING gin (content gin_trgm_ops);
