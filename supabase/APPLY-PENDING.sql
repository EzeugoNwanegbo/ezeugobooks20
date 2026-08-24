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
-- Parts 1, 2 and 3 are independent: dropping one does not affect the others.
-- PART 4 REPLACES TWO FUNCTIONS PART 2 CREATES, so it must come after it - as
-- it does here. Applying part 2 without part 4 leaves a This week tab that
-- works and is empty; see the head of part 4 for why. PART 5 stands alone.
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- PART 1 of 7 - FRIEND SEARCH BY HANDLE PREFIX
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
-- PART 2 of 7 - SCHOOL AND THIS-WEEK LEADERBOARDS
-- ###########################################################################
-- source: supabase/migrations/20260818120000_school_and_week_leaderboards.sql
--
-- Adds leaderboard_school(), leaderboard_week() and leaderboard_week_rank().
-- THIS IS THE ONE THAT FIXES 'I am the only person in Veritas'. Without it
-- the browser can read exactly one student's school - its own - because
-- user_profiles RLS is own-row and no existing leaderboard function returns
-- an institution.
--
-- Note on the This week tab: the version created HERE ranks from
-- point_events, which today records only challenge wins - correct, and
-- empty. PART 4 below replaces both weekly functions with ones that rank
-- from the since-Monday total the client actually maintains. Run both.
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
-- PART 3 of 7 - ONCE-IN-A-LIFETIME FIRST-RUN FLAGS
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


-- ###########################################################################
-- PART 4 of 7 - MAKE "THIS WEEK" A BOARD WITH PEOPLE ON IT
-- ###########################################################################
-- source: supabase/migrations/20260824120000_week_leaderboard_from_weekly_points.sql
--
-- MUST RUN AFTER PART 2. It replaces leaderboard_week() and
-- leaderboard_week_rank() with versions that rank from the weekly total the
-- browser actually keeps, instead of from a ledger that only ever receives
-- challenge wins. Without this, the This week tab loads successfully and shows
-- nobody, which is the bug the owner reported.
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- MAKE "THIS WEEK" A BOARD WITH PEOPLE ON IT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR, after (or together with)
-- 20260818120000_school_and_week_leaderboards.sql. Both functions below are
-- CREATE OR REPLACE with the exact signatures and return types that file
-- declares, so running the two in either order leaves the same result and
-- re-running is harmless. Nothing else is needed afterwards: the client already
-- DETECTS these functions (see `weekRpcMissing` in the leaderboard page), so the
-- tab fills in on the next page load.
--
--
-- WHAT WAS WRONG
-- --------------
-- The This week tab was empty for everybody. Two separate reasons, and fixing
-- only one of them fixes nothing:
--
--   1. leaderboard_week() had never been applied at all, so the tab answered
--      PGRST202, latched "unavailable", and rendered "just you so far". That is
--      what applying the pending bundle fixes.
--
--   2. It ranked from public.point_events. That ledger receives exactly ONE
--      kind of row today - award_challenge_win() - because award_points() is
--      REVOKEd from `authenticated` and every ordinary award (finishing a set,
--      correct answers, streak milestones, weekend missions, sharing a
--      document) is still decided in the browser. So even fully applied, the
--      board would list only students who won a friend battle since Monday:
--      true, and empty. The original file said as much - "correct but thin
--      until the ordinary awards move server-side" - and that Stage B has not
--      happened.
--
--
-- WHAT IT RANKS FROM NOW, AND WHY THAT IS HONEST
-- ----------------------------------------------
-- public.user_profiles.weekly_points, gated on freshness.
--
-- The original migration rejected that column for a specific and, at the time,
-- correct reason: "there is no rollover code anywhere in the client", so
-- weekly_points only ever grew and was a second copy of the lifetime total
-- wearing a weekly label. THAT IS NO LONGER TRUE. GamificationStats now carries
-- `weekStartedOn`, and rollWeek() zeroes weeklyPoints whenever the stamped
-- Monday is not this Monday - on load and before every award
-- (src/lib/gamification.ts). The column is written from that number on every
-- sync, so it is a real since-Monday total.
--
-- It is also the MORE complete number, not a compromise: the client folds the
-- server's own awards into it (reconcilePointsFromServer adds each point_events
-- award by id into weeklyPoints, and the next sync pushes it here), so a
-- challenge win the old board could see is counted by this one too.
--
-- THE FRESHNESS GATE IS THE WHOLE TRICK. Rollover is lazy - it happens in a
-- browser, when that student next opens the app. A student who earned 400 points
-- last week and has not opened G&D since still has weekly_points = 400 sitting
-- in this table, and ranking them on it would put a stale number at the top of a
-- board that says "this week". So a row only counts when
-- gamification_updated_at is itself inside this week, which is precisely the
-- condition under which a browser has provably re-stamped that number. Nobody is
-- ranked on a total we cannot show belongs to this week.
--
-- WHAT THAT COSTS, STATED PLAINLY: points earned in a session that never reached
-- the server (offline, or a tab closed before the sync landed) are not here, and
-- neither is a student whose only activity this week was on a device that failed
-- to sync. This is a leaderboard, not an audit - the same standing caveat the
-- global board has carried since 20260718120000, where the points are also
-- client-computed.
--
-- WEEK BOUNDARY. date_trunc('week', ...) is Monday 00:00 in the session's time
-- zone, which on Supabase is UTC. weekKey() in src/lib/gamification.ts computes
-- its Monday in UTC too, deliberately, so the two agree on where the week
-- starts. The leaderboard page's own startOfWeek() is LOCAL midnight, and is
-- used only for the offline fallback strip, where a few hours cannot mis-rank
-- anybody.
--
-- ADDITIVE AND SAFE. Two CREATE OR REPLACE FUNCTIONs and one CREATE INDEX IF NOT
-- EXISTS. No table altered, no row touched, nothing dropped.


-- ── Guard ───────────────────────────────────────────────────────────────────
-- weekly_points and gamification_updated_at come from
-- 20260718120000_add_global_leaderboard.sql. Refuse rather than create two
-- functions that would fail on every call.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'weekly_points'
  ) THEN
    RAISE EXCEPTION
      'user_profiles.weekly_points is missing. Apply 20260718120000_add_global_leaderboard.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'gamification_updated_at'
  ) THEN
    RAISE EXCEPTION
      'user_profiles.gamification_updated_at is missing. Apply 20260718120000_add_global_leaderboard.sql first.';
  END IF;
END
$guard$;


-- Partial on purpose: the board only ever reads rows that have points on them,
-- and most of the table does not.
CREATE INDEX IF NOT EXISTS user_profiles_weekly_board
  ON public.user_profiles (weekly_points DESC, gamification_updated_at DESC)
  WHERE weekly_points > 0;


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
AS $fn$
  WITH week AS (
    SELECT
      p.id                                               AS user_id,
      coalesce(nullif(btrim(p.name), ''), 'Student')     AS name,
      greatest(coalesce(p.weekly_points, 0), 0)::INTEGER AS points,
      coalesce(p.current_streak, 0)                      AS current_streak
    FROM public.user_profiles p
    WHERE coalesce(p.weekly_points, 0) > 0
      AND p.gamification_updated_at >= date_trunc('week', now())
  )
  SELECT
    w.user_id,
    w.name,
    w.points,
    w.current_streak,
    rank() OVER (ORDER BY w.points DESC, w.user_id) AS rank
  FROM week w
  ORDER BY w.points DESC, w.user_id
  LIMIT greatest(1, least(coalesce(limit_count, 50), 200));
$fn$;


-- The caller's own weekly standing, so the "you" strip has a number even when
-- they are far below the visible top of the board.
--
-- The caller is measured on the SAME gate as everyone else. A student whose row
-- has not been re-stamped since Monday reads 0 here, which is the truthful
-- answer: whatever weekly_points still says, no browser has confirmed it belongs
-- to this week. Their first award of the week rolls it over and fixes it.
CREATE OR REPLACE FUNCTION public.leaderboard_week_rank()
RETURNS TABLE (rank BIGINT, total BIGINT, points INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH week AS (
    SELECT
      p.id                                               AS user_id,
      greatest(coalesce(p.weekly_points, 0), 0)::INTEGER AS points
    FROM public.user_profiles p
    WHERE coalesce(p.weekly_points, 0) > 0
      AND p.gamification_updated_at >= date_trunc('week', now())
  ),
  me AS (
    SELECT w.points FROM week w WHERE w.user_id = auth.uid()
  )
  SELECT
    (SELECT count(*) + 1 FROM week w WHERE w.points > coalesce((SELECT points FROM me), 0))::BIGINT,
    (SELECT count(*) FROM week)::BIGINT,
    coalesce((SELECT points FROM me), 0)::INTEGER;
$fn$;


REVOKE ALL ON FUNCTION public.leaderboard_week(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_week(INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.leaderboard_week_rank() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_week_rank() TO authenticated;

COMMENT ON FUNCTION public.leaderboard_week(INTEGER) IS
  'Points since Monday, from user_profiles.weekly_points, counting only rows whose gamification_updated_at is itself inside this week - the condition under which a browser has provably rolled that number over. Replaces the point_events version, which could only ever list challenge wins.';


-- ###########################################################################
-- PART 5 of 7 - COOKIES: THE DAILY AI BUDGET
-- ###########################################################################
-- source: supabase/migrations/20260824130000_cookies_daily_budget.sql
--
-- Independent of parts 1-4; order does not matter. Creates the tables and
-- functions behind the cookie meter, the empty-state dialog, and the admin
-- screen that grants a student more when they call or message about it.
--
-- SAFE TO RUN BEFORE THE APP SHIPS. Nothing charges anybody until the client
-- and the Edge Functions that spend are deployed, and both are written to fail
-- OPEN, so neither order of deploy can lock a student out.
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- COOKIES: A DAILY AI BUDGET THAT A STUDENT CANNOT EDIT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR. Prerequisites: auth.users (always
-- there) and public.is_admin() from 20260719120000_add_library.sql. Section 0
-- checks rather than trusts.
--
-- Nothing to do afterwards: every client and every Edge Function DETECTS these
-- functions instead of reading a hand-flipped constant. Until this is applied
-- cookie_balance() answers PGRST202, the meter hides itself and NOTHING is
-- charged or blocked - see "FAILING OPEN" below, which is the single most
-- important property in this file.
--
--
-- WHY THIS IS SERVER-SIDE WHEN POINTS AND UPLOADS ARE NOT
-- ------------------------------------------------------
-- Points, streaks and the daily upload count all live in localStorage. That is
-- a deliberate, documented compromise (docs/gamification-plan.md, and the head
-- of src/lib/allowances.ts): what those defend is fairness, and a student who
-- opens dev tools and inflates their own points has cheated a leaderboard and
-- cost the product nothing.
--
-- COOKIES DEFEND A BILL. Every cookie stands for a DeepSeek call the owner pays
-- for. A budget stored on the student's own machine is reset in ten seconds
-- from the browser's Application tab, and the request is served and invoiced
-- anyway. So the balance lives here, the spend is recorded here, and the
-- decision to refuse is made here. This is the one counter in G&D that is a
-- boundary rather than a rail, and it is written that way on purpose.
--
--
-- THE SHAPE: A LEDGER, NOT A BALANCE COLUMN
-- -----------------------------------------
-- cookie_spends is append-only rows, exactly like point_events
-- (20260810120200). Today's spend is a SUM over today's rows, so:
--
--   * there is no counter to reset at midnight, and no cron job to forget to
--     run - "today" is just a WHERE clause, so the refill happens by itself;
--   * a refund is a negative row, not a subtraction that can be applied twice;
--   * the owner can see exactly where a student's day went when they ring up
--     asking for more, which is the whole point of the phone number in the
--     empty-state dialog.
--
-- THE DAY BOUNDARY is (now() AT TIME ZONE 'utc')::DATE, which is the same UTC
-- day key todayKey() uses in src/lib/allowances.ts and gamification.ts. Cookies,
-- uploads and the points caps therefore all roll over in the same instant -
-- 00:00 UTC, which is 1am in Lagos. The empty-state dialog renders that instant
-- in the student's own clock via uploadResetLabel(), so the time it names is
-- true wherever they are rather than approximately true here.
--
--
-- FAILING OPEN. READ THIS BEFORE CHANGING ANY CALLER.
-- ---------------------------------------------------
-- The Edge Functions are deployed by hand and separately from this SQL. So
-- there WILL be a window where a function that charges cookies is live against
-- a database that has no spend_cookies(). If a caller treated that as "no
-- balance", every student in the product would be refused every AI action at
-- once - a total outage, caused by a safety feature, in the name of a bill.
--
-- So the rule for every caller, without exception: a MISSING function, a failed
-- call, a timeout or any error that is not an explicit `ok = false` means LET
-- THE REQUEST THROUGH. The only thing that may ever refuse a student is this
-- file answering, in so many words, that they have nothing left. Losing a few
-- cookies of revenue protection during a deploy window is cheap. Locking the
-- product is not.
--
--
-- ADDITIVE AND SAFE. Two new tables, four new functions, their RLS and their
-- grants. Nothing existing is altered, dropped or backfilled. Re-running is
-- harmless (IF NOT EXISTS / CREATE OR REPLACE throughout).


-- ── Section 0: guard ────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  ) THEN
    RAISE EXCEPTION
      'public.is_admin() is missing. Apply 20260719120000_add_library.sql first.';
  END IF;
END
$guard$;


-- ── Section 1: the ledger ───────────────────────────────────────────────────
--
-- `cost` is CHECK (cost <> 0) rather than > 0 because a refund is a negative
-- row. Zero is banned outright: a zero-cost row records nothing and would only
-- ever be a bug that looks like data.
CREATE TABLE IF NOT EXISTS public.cookie_spends (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'chat', 'generate_questions', 'generate_flashcards', 'generate_plan',
  -- 'last_minute', 'battle_royale', or 'refund:<action>'. Free text on purpose:
  -- adding a priced action must not need a migration.
  action     TEXT NOT NULL,
  cost       INTEGER NOT NULL CHECK (cost <> 0),
  spent_on   DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only query shape that exists: "this user, this day".
CREATE INDEX IF NOT EXISTS cookie_spends_user_day
  ON public.cookie_spends (user_id, spent_on);

ALTER TABLE public.cookie_spends ENABLE ROW LEVEL SECURITY;

-- Read your own history and nobody else's. There is deliberately NO insert,
-- update or delete policy for `authenticated`: every write goes through the
-- SECURITY DEFINER functions below, which is what stops a student from
-- inserting a -50 row and refilling themselves.
DROP POLICY IF EXISTS "Students read own cookie spends" ON public.cookie_spends;
CREATE POLICY "Students read own cookie spends"
  ON public.cookie_spends FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());


-- ── Section 2: grants the owner hands out ───────────────────────────────────
--
-- THIS IS THE HALF THAT MAKES THE PHONE NUMBER MEAN SOMETHING. The empty-state
-- dialog tells a student to call or WhatsApp when they run out; without a way
-- to actually raise their allowance, that dialog is a promise the product
-- cannot keep. A grant is extra cookies PER DAY, optionally until a date.
--
-- Several grants stack. `ends_on` NULL means it does not expire, which is the
-- right default for "this student is a course rep, give them more permanently".
CREATE TABLE IF NOT EXISTS public.cookie_grants (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  extra_per_day INTEGER NOT NULL CHECK (extra_per_day > 0 AND extra_per_day <= 1000),
  starts_on     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::DATE,
  ends_on       DATE,
  -- Why it was given. Shown in the admin list so a grant made over WhatsApp in
  -- March is still explicable in June.
  note          TEXT,
  granted_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cookie_grants_user
  ON public.cookie_grants (user_id);

ALTER TABLE public.cookie_grants ENABLE ROW LEVEL SECURITY;

-- A student may SEE that they were given extra - the meter has to be able to
-- explain a number above the base - but only an admin may create, change or
-- remove one.
DROP POLICY IF EXISTS "Students read own cookie grants" ON public.cookie_grants;
CREATE POLICY "Students read own cookie grants"
  ON public.cookie_grants FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Admins write cookie grants" ON public.cookie_grants;
CREATE POLICY "Admins write cookie grants"
  ON public.cookie_grants FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── Section 3: what a day is worth ──────────────────────────────────────────
--
-- The base is stated once, here, and nowhere else. A client that hard-codes 50
-- to draw the meter will disagree with the server the first time this changes,
-- so every caller reads it back from cookie_balance() instead.
CREATE OR REPLACE FUNCTION public.cookie_daily_base()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 50; $fn$;

CREATE OR REPLACE FUNCTION public.cookie_allowance(p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.cookie_daily_base() + coalesce((
    SELECT sum(g.extra_per_day)::INTEGER
    FROM public.cookie_grants g
    WHERE g.user_id = p_user
      AND g.starts_on <= (now() AT TIME ZONE 'utc')::DATE
      AND (g.ends_on IS NULL OR g.ends_on >= (now() AT TIME ZONE 'utc')::DATE)
  ), 0);
$fn$;


-- ── Section 4: the read the meter draws from ────────────────────────────────
--
-- One row, always. A student with no spends today gets (50, 0, 50) rather than
-- an empty result, so the ring has a number to render on the very first paint
-- and never has to guess.
CREATE OR REPLACE FUNCTION public.cookie_balance()
RETURNS TABLE (allowance INTEGER, spent INTEGER, remaining INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH day AS (
    SELECT
      public.cookie_allowance(auth.uid()) AS allowance,
      coalesce((
        SELECT sum(s.cost)::INTEGER
        FROM public.cookie_spends s
        WHERE s.user_id = auth.uid()
          AND s.spent_on = (now() AT TIME ZONE 'utc')::DATE
      ), 0) AS spent
  )
  SELECT
    d.allowance,
    greatest(d.spent, 0),
    greatest(d.allowance - greatest(d.spent, 0), 0)
  FROM day d;
$fn$;


-- ── Section 5: spending ─────────────────────────────────────────────────────
--
-- ALL OR NOTHING. A request that costs 8 with 3 left is REFUSED, not part-paid.
-- Serving half a question set for three cookies would be worse than refusing:
-- the student pays and still cannot use what they got, and the owner pays the
-- DeepSeek call either way.
--
-- p_user is passed rather than read from auth.uid() because the callers that
-- matter are Edge Functions holding the service role key, acting FOR a student
-- whose id they resolved from the request's JWT. The `authenticated` grant is
-- on spend_cookies() (Section 6), which pins p_user to auth.uid() and is the
-- only version a browser can reach.
CREATE OR REPLACE FUNCTION public.spend_cookies_for(
  p_user   UUID,
  p_action TEXT,
  p_cost   INTEGER
)
RETURNS TABLE (ok BOOLEAN, spend_id BIGINT, allowance INTEGER, spent INTEGER, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_allowance INTEGER;
  v_spent     INTEGER;
  v_cost      INTEGER := greatest(coalesce(p_cost, 0), 0);
  v_id        BIGINT;
BEGIN
  IF p_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, 0, 0, 0;
    RETURN;
  END IF;

  v_allowance := public.cookie_allowance(p_user);

  SELECT coalesce(sum(s.cost), 0)::INTEGER INTO v_spent
  FROM public.cookie_spends s
  WHERE s.user_id = p_user
    AND s.spent_on = (now() AT TIME ZONE 'utc')::DATE;

  v_spent := greatest(v_spent, 0);

  -- A free action still answers ok, so a caller can price something at 0
  -- without special-casing it.
  IF v_cost = 0 THEN
    RETURN QUERY
      SELECT true, NULL::BIGINT, v_allowance, v_spent, greatest(v_allowance - v_spent, 0);
    RETURN;
  END IF;

  IF v_spent + v_cost > v_allowance THEN
    RETURN QUERY
      SELECT false, NULL::BIGINT, v_allowance, v_spent, greatest(v_allowance - v_spent, 0);
    RETURN;
  END IF;

  INSERT INTO public.cookie_spends (user_id, action, cost)
  VALUES (p_user, coalesce(nullif(btrim(p_action), ''), 'unknown'), v_cost)
  RETURNING id INTO v_id;

  v_spent := v_spent + v_cost;

  RETURN QUERY
    SELECT true, v_id, v_allowance, v_spent, greatest(v_allowance - v_spent, 0);
END;
$fn$;


-- ── Section 6: the browser's own doorway ────────────────────────────────────
--
-- Identical, minus the ability to name somebody else. The client uses this to
-- pay for work it performs itself, and to keep the meter honest between reads.
CREATE OR REPLACE FUNCTION public.spend_cookies(p_action TEXT, p_cost INTEGER)
RETURNS TABLE (ok BOOLEAN, spend_id BIGINT, allowance INTEGER, spent INTEGER, remaining INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT * FROM public.spend_cookies_for(auth.uid(), p_action, p_cost);
$fn$;


-- ── Section 7: refunds ──────────────────────────────────────────────────────
--
-- Charge first, refund on failure. The other order - charge only once the
-- answer is back - sounds fairer and is not: it means every failed or abandoned
-- generation is a DeepSeek call the owner paid for and nobody was charged for,
-- which is precisely the leak cookies exist to close.
--
-- So a caller that has already spent and then fails hands the spend_id back.
-- The refund is a NEGATIVE row rather than a delete, so the day's history still
-- shows what happened. Guarded three ways:
--   * only a spend belonging to this user (or an admin's) can be refunded;
--   * only a positive spend, so a refund cannot itself be refunded;
--   * only once, enforced by looking for an existing refund of that id.
CREATE OR REPLACE FUNCTION public.refund_cookie_spend(p_spend_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.cookie_spends;
BEGIN
  SELECT * INTO v_row
  FROM public.cookie_spends
  WHERE id = p_spend_id
    AND (user_id = auth.uid() OR public.is_admin())
    AND cost > 0;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cookie_spends r
    WHERE r.user_id = v_row.user_id
      AND r.action = 'refund:' || v_row.action
      AND r.cost = -v_row.cost
      AND r.spent_on = v_row.spent_on
      AND r.created_at > v_row.created_at
  ) THEN
    RETURN false;                       -- already refunded. Once, ever.
  END IF;

  INSERT INTO public.cookie_spends (user_id, action, cost, spent_on)
  VALUES (v_row.user_id, 'refund:' || v_row.action, -v_row.cost, v_row.spent_on);

  RETURN true;
END;
$fn$;


-- ── Section 8: who may call what ────────────────────────────────────────────
--
-- cookie_allowance() and spend_cookies_for() take a user id, so they are
-- REVOKED from `authenticated` outright: reachable only with the service role
-- key, which lives in the Edge Functions and never in a browser. Everything a
-- student needs is the auth.uid()-pinned pair.
REVOKE ALL ON FUNCTION public.cookie_allowance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spend_cookies_for(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cookie_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_balance() TO authenticated;

REVOKE ALL ON FUNCTION public.spend_cookies(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_cookies(TEXT, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.refund_cookie_spend(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_cookie_spend(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.cookie_daily_base() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_base() TO authenticated;


COMMENT ON TABLE public.cookie_spends IS
  'Append-only record of AI actions charged against a student''s daily cookie budget. Today''s spend is a SUM over today''s rows, so the budget refills at 00:00 UTC with no reset job. Written only by spend_cookies()/spend_cookies_for(); there is no insert policy for authenticated.';
COMMENT ON TABLE public.cookie_grants IS
  'Extra cookies per day, granted by an admin - the mechanism behind "call or WhatsApp us for more". Several stack; ends_on NULL means permanent.';
COMMENT ON FUNCTION public.spend_cookies_for(UUID, TEXT, INTEGER) IS
  'All-or-nothing charge against today''s allowance. Service role only: the browser-reachable version is spend_cookies(), which pins the user to auth.uid(). Callers MUST fail open if this function is missing or errors - see the head of the migration.';


-- ###########################################################################
-- PART 6 of 7 - ADMIN STUDENT LOOKUP
-- ###########################################################################
-- source: supabase/migrations/20260824140000_admin_find_students.sql
--
-- Independent of parts 1-5; order does not matter. Lets the cookie grant
-- screen find a student who has turned discoverability OFF - without it, the
-- one group most likely to message privately for more cookies is the one group
-- the owner cannot look up.
--
-- IF YOU HAVE ALREADY RUN PARTS 1-5, this is the only part you still need.
-- Running the whole file again is harmless either way.
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN STUDENT LOOKUP: FIND ANYONE, NOT JUST THE DISCOVERABLE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR. Prerequisites: public.is_admin()
-- (20260719120000_add_library.sql) and public.is_guest_account()
-- (20260809120000_social_usernames_friends_async_challenges.sql). Section 0
-- checks rather than trusts.
--
-- Nothing to do afterwards. The admin page detects this function and falls back
-- to find_students() when it is missing, so applying it simply widens what the
-- search box can reach on the next page load.
--
--
-- WHY THIS EXISTS
-- ---------------
-- The cookie grant screen (/app/admin) has to find a student before it can give
-- them more cookies. It was built on find_students(), the friend-search RPC,
-- because that was the only lookup that existed. That function ends with:
--
--     AND (p.discoverable_by = 'anyone' OR p.id = auth.uid())
--
-- which is exactly right for friend search and exactly wrong here. A student who
-- has turned discoverability off is invisible to it - so when that student
-- messages the owner on WhatsApp asking for more cookies, the owner cannot find
-- them to grant any. The empty-state dialog makes a promise the admin screen
-- could not keep for a subset of students, and it is the privacy-conscious
-- subset, which is the worst group to quietly penalise.
--
--
-- WHY THIS DOES NOT REOPEN THE ENUMERATION RISK
-- ---------------------------------------------
-- 20260815120000 argued at length that a prefix endpoint lets any account page
-- out a roster of identifiable medical and law students, and bounded
-- find_students() tightly because of it: three characters minimum, ten results,
-- no offset, handles only, opted-in students only.
--
-- Every one of those bounds exists because find_students() is reachable by ANY
-- authenticated account. This function is not. It RAISES for anybody who is not
-- an admin - not "returns no rows", which would leave a non-admin unable to tell
-- refusal from absence and would invite probing. The guarded population is a
-- handful of accounts the owner sets by hand in user_profiles.is_admin, so the
-- threat model that shaped find_students() simply does not apply.
--
-- What is kept anyway, because they cost nothing:
--   * a result cap (50), so no call returns the whole table;
--   * guest accounts excluded - an anonymous session is discarded on sign-out,
--     so a cookie grant against one is a promise the app cannot keep;
--   * no offset parameter, so there is still no way to page through everybody.
--
-- What is deliberately relaxed for admins: matching anywhere in the handle
-- rather than only at the start, matching the DISPLAY NAME as well, a two
-- character minimum instead of three, and no discoverability filter. The owner
-- is answering a message from someone who has just told them who they are; the
-- search only has to confirm it.
--
--
-- ADDITIVE AND SAFE. One new function. Nothing altered, dropped or backfilled.


-- ── Section 0: guard ────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  ) THEN
    RAISE EXCEPTION
      'public.is_admin() is missing. Apply 20260719120000_add_library.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_guest_account'
  ) THEN
    RAISE EXCEPTION
      'public.is_guest_account() is missing. Apply 20260809120000_social_usernames_friends_async_challenges.sql first.';
  END IF;
END
$guard$;


CREATE OR REPLACE FUNCTION public.admin_find_students(
  p_query TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  display_name TEXT,
  points       INTEGER,
  -- Surfaced rather than filtered on. An admin looking at a student who cannot
  -- be found by their classmates should be able to SEE that, since it explains
  -- why the student is here asking for help by message in the first place.
  discoverable BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- LIKE has three metacharacters and an admin may type any of them, since this
  -- matches display names as well as handles. Escaping order matters: the
  -- backslash must be doubled FIRST, or the escapes added afterwards would
  -- themselves be re-escaped.
  v_needle TEXT := lower(btrim(coalesce(p_query, '')));
  v_like   TEXT;
  v_limit  INT := greatest(1, least(coalesce(p_limit, 10), 50));
BEGIN
  IF NOT public.is_admin() THEN
    -- Loud, not silent. An empty result would leave a non-admin unable to tell
    -- "you may not ask" from "nobody matched", which is an invitation to probe.
    RAISE EXCEPTION 'admin_find_students is restricted to administrators'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_needle) < 2 THEN
    RETURN;                       -- too short to mean anything. No rows, no error.
  END IF;

  v_like := replace(v_needle, '\', '\\');
  v_like := replace(v_like, '%', '\%');
  v_like := replace(v_like, '_', '\_');

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    coalesce(p.points, 0),
    (p.discoverable_by = 'anyone')
  FROM public.user_profiles p
  WHERE NOT public.is_guest_account(p.id)
    AND (
      lower(coalesce(p.username, '')) LIKE '%' || v_like || '%' ESCAPE '\'
      OR lower(coalesce(p.name, ''))  LIKE '%' || v_like || '%' ESCAPE '\'
    )
  -- Exact handle first (it is what the owner was most likely given over
  -- WhatsApp), then handles that START with the query, then shortest handle,
  -- then alphabetical so repeated identical searches are stable.
  ORDER BY
    (lower(coalesce(p.username, '')) = v_needle) DESC,
    (lower(coalesce(p.username, '')) LIKE v_like || '%' ESCAPE '\') DESC,
    length(coalesce(p.username, '')),
    lower(coalesce(p.username, '')),
    p.id
  LIMIT v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_find_students(TEXT, INT) FROM PUBLIC, anon;
-- Granted to `authenticated` because that is the only role a signed-in admin
-- has; the is_admin() check INSIDE the function is what actually restricts it.
GRANT EXECUTE ON FUNCTION public.admin_find_students(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.admin_find_students(TEXT, INT) IS
  'Admin-only student lookup for the cookie grant screen. Unlike find_students() it ignores discoverable_by, matches display names, and matches anywhere in the handle - safe because it RAISES for non-admins rather than being reachable by every authenticated account. Guests excluded; 50 results maximum; no offset.';


-- ###########################################################################
-- PART 7 of 7 - COOKIES THAT GROW WITH USE
-- ###########################################################################
-- source: supabase/migrations/20260824150000_cookie_ladder.sql
--
-- MUST RUN AFTER PART 5, which creates the tables and the functions this
-- replaces. Changes the daily budget from a flat 50 to an earned ladder:
-- 30 to start, +5 for every three days the student has actually used the app,
-- 60 at the ceiling. Grants still stack on top of the 60.
--
-- Safe to run whether or not the app has been redeployed: the meter reads its
-- allowance back from cookie_balance() rather than hard-coding it.
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- COOKIES THAT GROW WITH USE: 30 A DAY, +5 EVERY THREE DAYS, CAPPED AT 60
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR, after
-- 20260824130000_cookies_daily_budget.sql. Everything here is CREATE OR REPLACE
-- over functions that file already created, with identical signatures and
-- return types, so it is safe to run at any time and safe to re-run. Section 0
-- refuses if the cookie tables are not there yet.
--
-- Nothing to do afterwards. The meter reads its allowance back from
-- cookie_balance() rather than hard-coding a number, so every ring, the dialog
-- and every charge pick the new ladder up on the next read.
--
--
-- THE LADDER (the owner's numbers)
-- --------------------------------
--     30 cookies a day to start
--     +5 for every three days the student has actually used the app
--     60 a day is the ceiling, reached on the 18th day
--
--   days used:  0-2   3-5   6-8   9-11   12-14   15-17   18+
--   allowance:   30    35    40     45      50      55     60
--
-- Replaces a flat 50. A new account starts LOWER than before and a committed
-- one ends HIGHER, which is the shape the owner asked for: the budget is
-- something you grow into rather than something handed over on signup, and the
-- accounts that cost the most to serve are the ones that have shown up
-- repeatedly to earn it.
--
--
-- WHAT COUNTS AS "A DAY THEY USED THE APP", AND WHY IT IS NOT A NEW COLUMN
-- ------------------------------------------------------------------------
-- count(DISTINCT spent_on) over their own cookie_spends rows.
--
-- The obvious alternative was the client's GamificationStats.activeDays, which
-- already exists and already drives the upload ladder. It cannot be used here,
-- and the reason is the reason cookies are server-side at all: activeDays lives
-- in localStorage. A student who edits it to 999 would hand themselves the
-- maximum allowance, which is precisely the bypass this whole subsystem exists
-- to close. An allowance computed from a number the student controls is not an
-- allowance.
--
-- cookie_spends is the opposite: it is written only by SECURITY DEFINER
-- functions the browser cannot insert into, one row per charged action, stamped
-- with a server-side UTC date. The distinct dates in it ARE the days that
-- student used the AI features - not a proxy for it, the record of it. No new
-- column, no new write path, nothing to backfill, and it is already indexed on
-- (user_id, spent_on), which is exactly the shape this counts over.
--
-- Two honest consequences:
--   * A day spent reading uploaded notes without touching an AI feature does
--     not count. Correct, in our view: this ladder pays for the usage it
--     budgets, not for opening the tab.
--   * The count starts the day the ledger does. Students active before this was
--     applied begin at zero days and climb from 30. There is no earlier record
--     of AI usage to credit them from - point_events holds only challenge wins
--     - so any backfill would be an invention. They reach 35 in three days.
--
-- Refunded-to-nothing days are excluded (`cost > 0`): a day whose only row is a
-- charge that was refunded because the generation failed is not a day the
-- student got anything, and it should not advance a reward.
--
--
-- THE 60 CEILING APPLIES TO THE EARNED LADDER, NOT TO GRANTS
-- -----------------------------------------------------------
-- cookie_grants rows still stack on top, and deliberately: the empty-state
-- dialog tells a student to call or message when they run out, and a hard 60
-- with no override would make that offer worthless for exactly the students who
-- take it up. 60 is the most anyone reaches on their own.


-- ── Section 0: guard ────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cookie_spends'
  ) THEN
    RAISE EXCEPTION
      'public.cookie_spends is missing. Apply 20260824130000_cookies_daily_budget.sql first.';
  END IF;
END
$guard$;


-- ── The floor ───────────────────────────────────────────────────────────────
-- Still the one place the starting number is written. It is now a FLOOR rather
-- than the whole answer, so nothing should read it as "the daily allowance" -
-- cookie_balance() is what answers that.
CREATE OR REPLACE FUNCTION public.cookie_daily_base()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 30; $fn$;

CREATE OR REPLACE FUNCTION public.cookie_daily_step()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 5; $fn$;

CREATE OR REPLACE FUNCTION public.cookie_daily_step_days()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 3; $fn$;

CREATE OR REPLACE FUNCTION public.cookie_daily_ceiling()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 60; $fn$;


-- ── Days used ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cookie_active_days(p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT coalesce(count(DISTINCT s.spent_on), 0)::INTEGER
  FROM public.cookie_spends s
  WHERE s.user_id = p_user
    AND s.cost > 0;
$fn$;


-- ── The earned allowance, before any grant ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.cookie_earned_base(p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT least(
    public.cookie_daily_ceiling(),
    public.cookie_daily_base()
      + public.cookie_daily_step()
      * (public.cookie_active_days(p_user) / public.cookie_daily_step_days())
  );
$fn$;
-- Integer division above is deliberate and is the whole ladder: in Postgres
-- `7 / 3` is 2, so days 6, 7 and 8 all sit on the same step. Writing it with an
-- explicit floor() would return numeric and need a cast back.


-- ── What a day is worth, all in ─────────────────────────────────────────────
-- Same signature and same meaning as 20260824130000's version; only the base
-- term changes, from a flat number to the earned ladder. Every caller -
-- cookie_balance(), spend_cookies_for() - is unchanged and picks this up.
CREATE OR REPLACE FUNCTION public.cookie_allowance(p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.cookie_earned_base(p_user) + coalesce((
    SELECT sum(g.extra_per_day)::INTEGER
    FROM public.cookie_grants g
    WHERE g.user_id = p_user
      AND g.starts_on <= (now() AT TIME ZONE 'utc')::DATE
      AND (g.ends_on IS NULL OR g.ends_on >= (now() AT TIME ZONE 'utc')::DATE)
  ), 0);
$fn$;


-- ── What the admin screen needs to explain a number ─────────────────────────
--
-- The grant screen used to show "base 50" because the base WAS 50 for everyone.
-- Now two students can have different allowances with no grant between them, so
-- the screen has to be able to say why. One call, so it cannot show a base and
-- a spend read a second apart.
--
-- RAISES for non-admins rather than returning nothing, for the same reason
-- admin_find_students() does: an empty result cannot be told apart from "no
-- such student" and invites probing.
CREATE OR REPLACE FUNCTION public.cookie_status_for(p_user UUID)
RETURNS TABLE (
  active_days   INTEGER,
  earned_base   INTEGER,
  granted_extra INTEGER,
  allowance     INTEGER,
  spent_today   INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'cookie_status_for is restricted to administrators'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    public.cookie_active_days(p_user),
    public.cookie_earned_base(p_user),
    public.cookie_allowance(p_user) - public.cookie_earned_base(p_user),
    public.cookie_allowance(p_user),
    greatest(coalesce((
      SELECT sum(s.cost)::INTEGER
      FROM public.cookie_spends s
      WHERE s.user_id = p_user
        AND s.spent_on = (now() AT TIME ZONE 'utc')::DATE
    ), 0), 0);
END;
$fn$;


-- ── Grants ──────────────────────────────────────────────────────────────────
-- The three that take a user id stay service-role only, exactly as
-- cookie_allowance() already was: a browser must never be able to ask about
-- somebody else's allowance. cookie_status_for() is the deliberate exception
-- and guards itself with is_admin().
REVOKE ALL ON FUNCTION public.cookie_allowance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cookie_active_days(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cookie_earned_base(UUID) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cookie_status_for(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_status_for(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.cookie_daily_base() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_base() TO authenticated;
REVOKE ALL ON FUNCTION public.cookie_daily_step() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_step() TO authenticated;
REVOKE ALL ON FUNCTION public.cookie_daily_step_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_step_days() TO authenticated;
REVOKE ALL ON FUNCTION public.cookie_daily_ceiling() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_ceiling() TO authenticated;


COMMENT ON FUNCTION public.cookie_earned_base(UUID) IS
  'Daily cookies earned by use alone: 30, plus 5 for every 3 distinct days this account has spent cookies on, capped at 60. Counted from cookie_spends because that is the one record of usage the student cannot edit - the client''s own activeDays lives in localStorage and would hand anyone the maximum.';
COMMENT ON FUNCTION public.cookie_active_days(UUID) IS
  'Distinct UTC days on which this account actually spent cookies. Days whose only charge was refunded do not count.';
