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
