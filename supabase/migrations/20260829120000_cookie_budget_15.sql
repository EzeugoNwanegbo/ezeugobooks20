-- ═══════════════════════════════════════════════════════════════════════════
-- ONE BUDGET, FIFTEEN A DAY: THE LADDER IS FLATTENED, THE PRICES ARE RESCALED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR, after
-- 20260824130000_cookies_daily_budget.sql and 20260824150000_cookie_ladder.sql.
-- Everything here is CREATE OR REPLACE over four functions the ladder file
-- already created, with identical signatures and return types, so it is safe to
-- run at any time and safe to re-run. Section 0 refuses if the ladder is not
-- there yet.
--
-- FORWARD-ONLY, like 20260824150000 before it. Neither of the two earlier
-- cookie files is edited: they have both been applied to production, and a
-- migration that has been run is a record of what happened, not a draft. This
-- is the third statement of the same four constants and it is the one that
-- wins, exactly as the ladder file superseded the flat 50 before it.
--
--
-- THE NUMBER (the owner's decision)
-- ---------------------------------
--     15 cookies a day, every day, for everybody.
--
--   days used:  0-2   3-5   6-8   9-11   12-14   15-17   18+
--   allowance:   15    15    15     15      15      15     15
--
-- Replaces the earned ladder (30, +5 every three days, ceiling 60), which
-- replaced a flat 50 before it.
--
--
-- WHY THE LADDER IS SWITCHED OFF RATHER THAN DELETED
-- --------------------------------------------------
-- cookie_daily_step() is set to 0 and cookie_daily_ceiling() is brought down to
-- meet cookie_daily_base(). Nothing else changes: cookie_earned_base() still
-- reads `least(ceiling, base + step * (active_days / step_days))`, which with a
-- step of zero is `least(15, 15)` for every account on day zero and on day
-- nine hundred alike.
--
-- The alternative was to rewrite cookie_earned_base() to `SELECT 15` and leave
-- the three ladder constants standing. That is worse, and specifically it is
-- the kind of worse this codebase's comments keep warning about: it leaves
-- cookie_daily_step() and cookie_daily_ceiling() in the database still
-- answering 5 and 60, still granted to `authenticated`, still readable by
-- anything that goes looking - three functions that describe a ladder nothing
-- climbs any more. Collapsing the constants instead keeps every function
-- telling the truth about what it does, and turning a ladder back on later is
-- one more CREATE OR REPLACE of two constants rather than a re-derivation of
-- the arithmetic.
--
-- cookie_daily_step_days() is deliberately left at 3. With a step of 0 the
-- integer division it feeds is multiplied away, so its value cannot affect an
-- allowance; changing it would be noise in a diff, and 3 is still the right
-- number if the ladder is ever switched back on.
--
-- cookie_active_days() is untouched and still counts. The admin screen reads it
-- through cookie_status_for() and it remains the honest answer to "how much has
-- this student actually used the app", which is what an admin wants to know
-- before granting more - it simply no longer buys anything on its own.
--
--
-- THE PRICES MOVE WITH IT - AND THEY DO NOT LIVE HERE
-- ---------------------------------------------------
-- 15 at the OLD prices would have been about seven chat messages a day, which
-- is not a budget, it is a wall. So the price list is rescaled in the same
-- change:
--
--   chat                 2      ->  1        15 messages a day
--   generate_questions   n/5    ->  n/10     a 40-question set: 8 -> 4
--   generate_flashcards  n/10   ->  n/20     a 20-card set:     2 -> 1
--   generate_plan        5      ->  2
--   last_minute          5      ->  2
--   battle_royale        3      ->  2
--   review_answers       0      ->  0        unchanged; the set already paid
--
-- Those numbers are NOT in this file and cannot be. Nothing in the database
-- knows what an action costs - spend_cookies_for() is told a cost by its
-- caller and charges it. The price list lives in src/lib/cookies.ts, with a
-- second copy of each individual price inside the Edge Function that bills it
-- (supabase/functions/{chat,studybody,last-minute}/index.ts). It is written
-- out above only so that whoever reads this file a year from now can see the
-- whole decision in one place instead of half of it.
--
-- WHICH MEANS THIS FILE ALONE IS NOT THE CHANGE. Applying this without
-- deploying those three Edge Functions leaves students on 15 a day paying the
-- old prices - seven chat messages. The two halves have to land together, and
-- the Edge Functions are the half that does not deploy itself. See the note in
-- supabase/APPLY-PENDING.sql PART 8.
--
--
-- WHAT DOES NOT NEED DOING AFTERWARDS
-- -----------------------------------
-- No client change is required for the NUMBER. The meter reads its allowance
-- back from cookie_balance() rather than hard-coding it, so every ring, the
-- dialog and the admin screen pick 15 up on their next read whether or not the
-- frontend has been rebuilt.
--
-- Nothing is backfilled and nothing is lost. Allowances are computed per read,
-- never stored, so there is no row anywhere holding a stale 30 or 60. Today's
-- already-recorded spends stand: a student who has spent 22 cookies today under
-- the old ladder is simply at zero remaining until 00:00 UTC, which
-- cookie_balance() already clamps with greatest(allowance - spent, 0).
--
-- Grants are untouched and still stack on top of the 15, which matters more now
-- than it did at 60: the empty-state dialog's offer to call or message is the
-- only way past this number, and it is a much closer number than it was.


-- ── Section 0: guard ────────────────────────────────────────────────────────
-- Checks for the LADDER, not just the tables: this file only replaces
-- constants that 20260824150000 introduced, so applying it to a database that
-- has the base migration but not the ladder would create cookie_daily_step()
-- and cookie_daily_ceiling() out of nowhere and leave cookie_earned_base()
-- absent - a half-state neither file describes.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cookie_earned_base'
  ) THEN
    RAISE EXCEPTION
      'public.cookie_earned_base() is missing. Apply 20260824130000_cookies_daily_budget.sql and 20260824150000_cookie_ladder.sql first.';
  END IF;
END
$guard$;


-- ── The number ──────────────────────────────────────────────────────────────
-- Still the one place the daily allowance is written, and now the whole answer
-- again rather than a floor - because the step below is zero and the ceiling
-- meets it.
CREATE OR REPLACE FUNCTION public.cookie_daily_base()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 15; $fn$;

-- Zero: the ladder is off. cookie_earned_base() multiplies the number of
-- three-day blocks by this, so a step of 0 makes every account sit on the
-- base for ever without changing a line of the arithmetic that computes it.
CREATE OR REPLACE FUNCTION public.cookie_daily_step()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 0; $fn$;

-- Brought down to meet the base. Belt and braces with the zero step above:
-- either one alone would flatten the ladder, and both together mean a stray
-- future edit to one of them cannot quietly re-open the other.
CREATE OR REPLACE FUNCTION public.cookie_daily_ceiling()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT 15; $fn$;

-- cookie_daily_step_days() is NOT replaced here - see the header. It still
-- answers 3, it is still multiplied by a zero step, and it is still the right
-- number if a ladder is ever wanted again.


-- ── Grants ──────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE preserves existing privileges, so these are restatements
-- rather than repairs. They are here because 20260824150000 states them too,
-- and a file that replaces a function should leave no doubt about who may call
-- it afterwards.
REVOKE ALL ON FUNCTION public.cookie_daily_base() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_base() TO authenticated;
REVOKE ALL ON FUNCTION public.cookie_daily_step() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_step() TO authenticated;
REVOKE ALL ON FUNCTION public.cookie_daily_ceiling() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_ceiling() TO authenticated;


COMMENT ON FUNCTION public.cookie_daily_base() IS
  'The daily cookie allowance before grants: 15, the same for every account. Was 30 (the floor of an earned ladder) and 50 (flat) before that.';
COMMENT ON FUNCTION public.cookie_daily_step() IS
  'Extra daily cookies earned per completed block of cookie_daily_step_days() active days. Zero: the earned ladder is switched off and every account sits on cookie_daily_base().';
COMMENT ON FUNCTION public.cookie_daily_ceiling() IS
  'The most cookies an account can reach through use alone. Equal to cookie_daily_base() while the ladder is off, so it binds nothing. Admin grants stack on top of it and always did.';
COMMENT ON FUNCTION public.cookie_earned_base(UUID) IS
  'Daily cookies earned by use alone: cookie_daily_base(), plus cookie_daily_step() per completed block of active days, capped at cookie_daily_ceiling(). All three are currently 15, 0 and 15, so this answers a flat 15 for everyone - the arithmetic is unchanged and the constants are what moved.';
