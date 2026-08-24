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
