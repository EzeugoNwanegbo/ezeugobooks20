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
