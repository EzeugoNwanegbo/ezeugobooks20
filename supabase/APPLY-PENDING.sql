-- ═══════════════════════════════════════════════════════════════════════════
-- G&D - PENDING SQL, ALL OF IT, IN ORDER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Verified against the live database: find_students, leaderboard_school,
-- leaderboard_week and leaderboard_week_rank all answer 404, while
-- leaderboard_top and leaderboard_rank answer 200. So exactly these
-- migrations are missing and everything else is already applied.
--
-- NOTHING TO DO AFTERWARDS. Every one of these is DETECTED by the app rather
-- than gated on a hand-flipped constant, so each feature lights up on the next
-- page load. No code change, no redeploy, no flag to flip.
--
-- Nothing here drops, deletes or truncates. Every statement is additive:
-- CREATE OR REPLACE FUNCTION, CREATE INDEX IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, and GRANT/REVOKE on the new functions only. Re-running is harmless.
--
-- Each part guards its own prerequisites and will RAISE rather than half-apply.
-- The three parts are independent: dropping one does not affect the others.
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- PART 1 of 3 - FRIEND SEARCH BY HANDLE PREFIX
-- ###########################################################################
-- source: supabase/migrations/20260815120000_friend_search_prefix.sql
--
-- Adds public.find_students(). THIS IS THE ONE THAT GIVES YOU SUGGESTIONS
-- AS YOU TYPE in Add friend, instead of needing somebody's exact handle
-- character for character. Three characters is enough to start matching.
--
-- It matches the START of a HANDLE only - never a display name, never
-- anything derived from an email - and only students who opted in to being
-- discoverable. Ten results maximum.
--
-- READ THE PRIVACY SECTION INSIDE. A prefix search lets any account walk
-- the handle space; the file spells out exactly what bounds that. This is
-- the one part of this script that is a JUDGEMENT CALL rather than a fix.
-- ###########################################################################

-- Friend search: suggestions from the START of a handle, instead of the exact
-- handle and nothing else.
--
-- APPLIED BY HAND, as one transaction, in the Supabase SQL editor. Nothing in
-- this repo applies it for you, and the client does not call anything in here
-- until src/lib/social.ts's FRIEND_SEARCH_PREFIX_APPLIED is flipped to true in
-- the same commit that applies it (and gandd-mobile/lib/social.ts's copy with
-- it - both apps hit this same schema).
--
-- PREREQUISITE: 20260809120000_social_usernames_friends_async_challenges.sql
-- must already be applied. Section 0 checks rather than trusts.
--
--
-- WHY THIS EXISTS
-- ---------------
-- find_student() matches `lower(p.username) = needle` and returns at most one
-- row. To add a classmate you must therefore already know their handle exactly,
-- character for character - "ada_lovelace" does not find you if you typed
-- "ada_love". Students hit that constantly, and the app cannot tell them
-- whether they mistyped it or the person simply is not there, because both
-- answers are the same empty result.
--
--
-- WHAT THIS CHANGES ABOUT PRIVACY, STATED PLAINLY
-- -----------------------------------------------
-- The exact-match rule was not an oversight. The comment above find_student()
-- and docs/gamification-plan.md §3 both argue that a prefix endpoint lets any
-- account walk the handle space and page out a roster of identifiable medical
-- and law students. THAT IS STILL TRUE, and applying this file accepts it. What
-- follows is what bounds it, not a claim that the risk is gone:
--
--   * MINIMUM THREE CHARACTERS. Enforced by the same ^[a-z0-9_]{3,20}$ shape
--     guard find_student() uses - a one or two character prefix does not match
--     the pattern, so it returns nothing rather than a slice of the alphabet.
--     Walking the space at three characters is 46,656 queries per prefix depth
--     rather than 36.
--   * TEN RESULTS, HARD. p_limit is clamped, so no caller can ask for a page.
--     There is no offset parameter and there will not be one: the pagination is
--     what turns a search box into an export.
--   * OPT-IN ONLY, UNCHANGED. discoverable_by = 'anyone' is still required, so
--     every student who chose "nobody" and every student who never claimed a
--     handle stays as invisible as they are today. Guests and blocked accounts
--     are excluded by the same two clauses find_student() uses.
--   * HANDLES ONLY. p.name (the real display name) is NOT matched, in either
--     direction. A student who never tells anyone their handle cannot be
--     surfaced by their own name, which is the disclosure that actually
--     identifies a person at a named institution.
--
-- The honest residual: someone determined to enumerate opt-in handles can, at
-- ten per query. The mitigation for that is rate limiting at the edge, which is
-- not something a SQL function can do and is not attempted here.
--
--
-- SAFETY
-- ------
-- Idempotent: one CREATE INDEX IF NOT EXISTS and one CREATE OR REPLACE
-- FUNCTION. Running it twice changes nothing the second time.
--
-- Additive: find_student() is NOT touched, so the exact lookup keeps working
-- exactly as it does today and the client can fall back to it at any time. No
-- row is written, no access is narrowed, no existing function body changes.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.find_students(text, integer);
--   DROP INDEX IF EXISTS public.user_profiles_username_prefix;
--   -- and flip FRIEND_SEARCH_PREFIX_APPLIED back to false in both apps.


-- ═══ 0. PRECONDITIONS, ENFORCED ══════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'username'
  ) THEN
    RAISE EXCEPTION
      'user_profiles.username does not exist. Apply 20260809120000_social_usernames_friends_async_challenges.sql first.';
  END IF;

  IF to_regclass('public.friendships') IS NULL THEN
    RAISE EXCEPTION 'public.friendships does not exist. Apply 20260809120000 first.';
  END IF;

  IF to_regprocedure('public.is_guest_account(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.is_guest_account() does not exist. Apply 20260809120000 first.';
  END IF;

  IF to_regprocedure('public.find_student(text)') IS NULL THEN
    RAISE EXCEPTION 'public.find_student() does not exist. Apply 20260809120000 first.';
  END IF;
END
$$;


-- ═══ 1. AN INDEX THE PREFIX SCAN CAN USE ═════════════════════════════════════
--
-- text_pattern_ops orders by byte rather than by locale, which is the only way
-- a btree can serve `lower(username) LIKE 'ada%'` outside the C collation. The
-- existing user_profiles_username_lower (unique, default opclass) cannot.
--
-- STATED HONESTLY: the planner extracts a prefix range from LIKE only when the
-- pattern is a constant, and inside the function below it is a parameter, so
-- this index is not guaranteed to be chosen - a sequential scan over the
-- profiles that HAVE a handle is the likely plan today, and at this table size
-- that is sub-millisecond and completely fine. The index costs almost nothing,
-- makes the plan available as the table grows, and is there for any caller that
-- does pass a literal. It is not load-bearing; if it were, this would be a
-- range query rather than a LIKE.
--
-- Partial, matching the unique index: rows with no handle are not findable and
-- are the majority.
CREATE INDEX IF NOT EXISTS user_profiles_username_prefix
  ON public.user_profiles (lower(username) text_pattern_ops)
  WHERE username IS NOT NULL;


-- ═══ 2. THE SEARCH ═══════════════════════════════════════════════════════════
--
-- Same columns, same relationship logic and the same four exclusions as
-- find_student(), deliberately: this is that function with `=` widened to a
-- prefix and the LIMIT 1 raised. Anything that made a student unfindable there
-- makes them unfindable here, and a future edit to one should be made to both.
CREATE OR REPLACE FUNCTION public.find_students(p_prefix TEXT, p_limit INT DEFAULT 5)
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  display_name TEXT,
  points       INTEGER,
  relationship TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH needle AS (
    SELECT lower(btrim(coalesce(p_prefix, ''))) AS h
  ),
  pattern AS (
    -- '_' is a LIKE wildcard AND a legal handle character, so it has to be
    -- escaped: unescaped, "ada_" would match "adam" as well as "ada_b". '%' and
    -- '\' need no handling because the shape guard below rejects every
    -- character outside [a-z0-9_] before this is used.
    SELECT h, replace(h, '_', '\_') AS p FROM needle
  )
  SELECT
    p.id,
    p.username,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    p.points,
    CASE
      WHEN p.id = auth.uid() THEN 'self'
      WHEN f.status = 'accepted' THEN 'friends'
      WHEN f.status = 'pending' AND f.requested_by = auth.uid() THEN 'pending_out'
      WHEN f.status = 'pending' THEN 'pending_in'
      ELSE 'none'
    END
  FROM public.user_profiles p
  CROSS JOIN pattern n
  LEFT JOIN public.friendships f
    ON f.user_a = least(p.id, auth.uid())
   AND f.user_b = greatest(p.id, auth.uid())
  WHERE auth.uid() IS NOT NULL
    -- Shape guard first, exactly as in find_student(): an input that is not a
    -- legal handle can never be compared against anything, so an email address
    -- is rejected before it reaches a comparison. This is also what enforces
    -- the three-character minimum - {3,20} - rather than a separate check that
    -- could drift away from it.
    AND n.h ~ '^[a-z0-9_]{3,20}$'
    AND p.username IS NOT NULL
    AND lower(p.username) LIKE n.p || '%' ESCAPE '\'
    AND (p.discoverable_by = 'anyone' OR p.id = auth.uid())
    AND NOT public.is_guest_account(p.id)
    -- A block hides both parties from each other's search, in both directions,
    -- and is indistinguishable from "no such handle".
    AND coalesce(f.status, '') <> 'blocked'
  -- Exact match first (it is what the student most likely meant), then shortest
  -- handle, then alphabetical so the list is stable between identical queries.
  ORDER BY (lower(p.username) = n.h) DESC, length(p.username), lower(p.username)
  LIMIT least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.find_students(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_students(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.find_students(TEXT, INT) IS
  'Handle-prefix search, 3 characters minimum, 10 results maximum, no offset. Opt-in students only (discoverable_by = anyone); guests, blocked accounts and unclaimed handles are excluded exactly as in find_student(). Never matches a display name or anything derived from an email address.';


-- ###########################################################################
-- PART 2 of 3 - SCHOOL AND THIS-WEEK LEADERBOARDS
-- ###########################################################################
-- source: supabase/migrations/20260818120000_school_and_week_leaderboards.sql
--
-- Adds leaderboard_school(), leaderboard_week() and leaderboard_week_rank().
-- THIS IS THE ONE THAT FIXES 'I am the only person in Veritas'. Without it
-- the browser can read exactly one student's school - its own - because
-- user_profiles RLS is own-row and no existing leaderboard function returns
-- an institution.
--
-- Note on the This week tab: it ranks from point_events, which today only
-- records challenge wins. The board will be correct but thin until the
-- ordinary awards move server-side.
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- SCHOOL AND THIS-WEEK LEADERBOARDS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY THIS BY HAND IN THE SUPABASE SQL EDITOR. Nothing else is needed
-- afterwards: the client DETECTS these functions rather than reading a
-- hand-flipped constant, so the School and This week tabs fill in on the next
-- page load. See `schoolRpcMissing` in src/lib/school.ts for why it works that
-- way - a constant meant running this file changed nothing until a separate
-- code change also shipped, which reads as a broken feature rather than a
-- pending one.
--
-- Until it is applied, both callers get PostgREST's PGRST202 ("could not find
-- the function"), treat it as unavailable, and fall back to the student's own
-- standing. That is a caught error on an isolated request, NOT the hazard in
-- never-ship-ahead-of-migrations: what fails destructively is naming unapplied
-- schema inside a larger statement, which nothing here does.
--
-- WHY THE CLIENT CANNOT DO THIS ON ITS OWN
-- ----------------------------------------
-- public.user_profiles RLS is strictly own-row ("Users view own profile",
-- 20260425233320). The two applied leaderboard functions return no institution
-- (leaderboard_top -> user_id, name, points, current_streak, rank) and no
-- per-week total. So a browser can read exactly one student's school and one
-- student's history - its own - and a board of one is not a board.
--
-- WHAT IS DELIBERATELY *NOT* HERE: a SQL mirror of the school matcher.
-- ---------------------------------------------------------------------
-- Collapsing "Veritas", "VUNA", "Veritas University Abuja" and "Medicine and
-- surgery,  veritas university " onto one key is ~400 lines of curated word
-- sets in src/lib/school.ts, and a plpgsql copy of it would drift from the
-- TypeScript within a release. Instead leaderboard_school() takes the caller's
-- own match TERMS and returns a SUPERSET - every ranked student whose
-- university text contains any one of them - and the client re-normalises each
-- row and keeps only exact key matches. One implementation of the matcher, in
-- the language it can be tested in.
--
-- The privacy consequence is deliberate and is the reason it is not simply
-- "return every profile's university": a caller only ever receives rows whose
-- text already contains a piece of their OWN school's name. There is no query
-- here that dumps the roster of an institution the caller does not belong to.


-- ── Guard ───────────────────────────────────────────────────────────────────
-- The weekly board is computed from the points ledger. Applying this file
-- before 20260810120200_point_events_ledger.sql would create a function that
-- fails on every call, so refuse instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'point_events'
  ) THEN
    RAISE EXCEPTION
      'public.point_events does not exist. Apply 20260810120200_point_events_ledger.sql first.';
  END IF;
END
$$;


-- ── School board ────────────────────────────────────────────────────────────
--
-- Every ranked student whose university text contains one of p_terms, with the
-- raw spelling each of them typed. The client does the exact grouping and the
-- ranking; this only narrows the rows.
--
-- The text is flattened the same cheap way on both sides (non-alphanumerics to
-- a space, lowercased) so that a term like 'veritas' matches "VERITAS
-- UNIVERSITY ABUJA " and "Veritas university, 200level" alike. Terms shorter
-- than three characters are ignored so a stray one-letter term cannot select
-- the entire table.
CREATE OR REPLACE FUNCTION public.leaderboard_school(
  p_terms     TEXT[],
  limit_count INTEGER DEFAULT 200
)
RETURNS TABLE (
  user_id        UUID,
  name           TEXT,
  points         INTEGER,
  current_streak INTEGER,
  university     TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    p.points,
    p.current_streak,
    p.university
  FROM public.user_profiles p
  WHERE p.points > 0
    AND p.university IS NOT NULL
    AND btrim(p.university) <> ''
    AND EXISTS (
      SELECT 1
      FROM unnest(coalesce(p_terms, ARRAY[]::TEXT[])) AS t(term)
      WHERE length(btrim(t.term)) >= 3
        AND position(
              lower(btrim(t.term))
              IN lower(regexp_replace(p.university, '[^a-zA-Z0-9]+', ' ', 'g'))
            ) > 0
    )
  ORDER BY p.points DESC, p.gamification_updated_at ASC NULLS LAST
  LIMIT greatest(1, least(coalesce(limit_count, 200), 500));
$$;

-- authenticated only. This is the one function that returns another student's
-- institution, and an anonymous caller has no school of their own to be
-- answering about.
REVOKE ALL ON FUNCTION public.leaderboard_school(TEXT[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_school(TEXT[], INTEGER) TO authenticated;


-- ── This week ───────────────────────────────────────────────────────────────
--
-- Ranked by points EARNED SINCE MONDAY, read from the ledger rather than from
-- user_profiles.weekly_points. That column is written by the browser and is
-- never reset when the week rolls over (there is no rollover code anywhere in
-- the client), so ranking by it would reproduce the all-time board under a
-- different heading - a board that says "this week" and is not.
--
-- point_events is the only per-day record that exists, so this board is exactly
-- as complete as the ledger is. Today that is Stage A: challenge wins only,
-- which makes for a thin board that is at least true. It fills out on its own
-- as Stage B moves the ordinary awards server-side (see the foot of
-- 20260810120200_point_events_ledger.sql); nothing here needs to change then.
--
-- legacy_import is excluded. It is an opening balance stamped with
-- gamification_updated_at, so for anyone active this week it would land inside
-- the window and pay their entire lifetime total into a weekly total.
CREATE INDEX IF NOT EXISTS point_events_earned_on
  ON public.point_events (earned_on);

CREATE OR REPLACE FUNCTION public.leaderboard_week(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  user_id        UUID,
  name           TEXT,
  points         INTEGER,
  current_streak INTEGER,
  rank           BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week AS (
    SELECT e.user_id, sum(e.points)::INTEGER AS points
    FROM public.point_events e
    WHERE e.earned_on >= date_trunc('week', CURRENT_DATE)::DATE
      AND e.event_type <> 'legacy_import'
    GROUP BY e.user_id
    HAVING sum(e.points) > 0
  )
  SELECT
    w.user_id,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    w.points,
    coalesce(p.current_streak, 0),
    rank() OVER (ORDER BY w.points DESC, w.user_id) AS rank
  FROM week w
  JOIN public.user_profiles p ON p.id = w.user_id
  ORDER BY w.points DESC, w.user_id
  LIMIT greatest(1, least(coalesce(limit_count, 50), 200));
$$;

-- The caller's own weekly standing, so the "you" strip has a number even when
-- the student is well below the visible top of the board.
CREATE OR REPLACE FUNCTION public.leaderboard_week_rank()
RETURNS TABLE (rank BIGINT, total BIGINT, points INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week AS (
    SELECT e.user_id, sum(e.points)::INTEGER AS points
    FROM public.point_events e
    WHERE e.earned_on >= date_trunc('week', CURRENT_DATE)::DATE
      AND e.event_type <> 'legacy_import'
    GROUP BY e.user_id
    HAVING sum(e.points) > 0
  ),
  me AS (
    SELECT w.points FROM week w WHERE w.user_id = auth.uid()
  )
  SELECT
    (SELECT count(*) + 1 FROM week w WHERE w.points > coalesce((SELECT points FROM me), 0))::BIGINT,
    (SELECT count(*) FROM week)::BIGINT,
    coalesce((SELECT points FROM me), 0)::INTEGER;
$$;

REVOKE ALL ON FUNCTION public.leaderboard_week(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_week(INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.leaderboard_week_rank() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_week_rank() TO authenticated;


COMMENT ON FUNCTION public.leaderboard_school(TEXT[], INTEGER) IS
  'Ranked students whose university text contains any of the caller-supplied terms. Returns a SUPERSET on purpose: normalizeSchool() in src/lib/school.ts does the exact grouping client-side, so the matcher has one implementation rather than a SQL mirror that drifts.';
COMMENT ON FUNCTION public.leaderboard_week(INTEGER) IS
  'Points earned since Monday, from point_events. Deliberately not user_profiles.weekly_points, which the client never resets and which therefore is not a weekly number.';


-- ###########################################################################
-- PART 3 of 3 - ONCE-IN-A-LIFETIME FIRST-RUN FLAGS
-- ###########################################################################
-- source: supabase/migrations/20260819120000_seen_intros.sql
--
-- Adds user_profiles.seen_intros. THIS IS THE ONE THAT MAKES THE MAP AND THE
-- INTRO TEXT SHOW ONCE PER PERSON rather than once per browser. Until it is
-- applied those flags live only in localStorage, so clearing the cache or
-- opening the app on a second device replays the tour and every intro.
--
-- One additive column with a default. No backfill, no data touched.
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- ONCE IN A LIFETIME: first-run flags that belong to the ACCOUNT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR. Nothing else is needed afterwards:
-- src/lib/seen-once.ts DETECTS this column rather than reading a hand-flipped
-- constant (see [detect-migrations-not-flags]), so the behaviour changes on the
-- next page load. Until it is applied, a missing column answers 42703 /
-- PGRST204, the module latches and degrades to exactly the localStorage-only
-- behaviour that came before it.
--
-- WHY. The guided tour and every per-page intro were gated on localStorage,
-- keyed per user id. That is once per BROWSER, not once per person: clearing
-- the cache, moving from phone to laptop, or opening a private window met the
-- tour and every explanatory paragraph all over again. The owner's rule is once
-- in a lifetime, so the flag has to live where the account lives.
--
-- WHY A text[] AND NOT A BOOLEAN PER SURFACE. There are three surfaces today
-- (tour, library, friends) and there will be more. A column per surface means a
-- migration every time one is added; an open token list means none. The client
-- ignores tokens it does not recognise, so an older build meeting a newer token
-- simply carries on.
--
-- ADDITIVE AND SAFE. One nullable-free column with a default, no backfill, no
-- data touched. Existing rows get '{}' and behave as first-timers on the server
-- side - which is correct, because their real history is the localStorage cache
-- they already have, and seen-once.ts only ever ADDS flags from the server, it
-- never clears a local one.
--
-- NO NEW RLS. user_profiles is already strictly own-row ("Users view own
-- profile", 20260425233320), so a student reads and writes exactly their own
-- list and nobody else's.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS seen_intros TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_profiles.seen_intros IS
  'Tokens for first-run surfaces this account has already been shown (tour, library, friends, ...). Written by src/lib/seen-once.ts. An open token list on purpose: adding a new first-run surface must not need a migration.';
