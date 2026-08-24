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
