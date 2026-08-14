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
