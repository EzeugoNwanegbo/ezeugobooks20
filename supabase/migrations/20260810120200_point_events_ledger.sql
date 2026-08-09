-- ═══════════════════════════════════════════════════════════════════════════
-- THE POINTS LEDGER - STAGE A
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/gamification-plan.md §1 describes the goal state: user_profiles.points
-- becomes a derived value no client can write, computed from an append-only
-- ledger of awards the server itself granted. This file builds the ledger, the
-- award primitive, the daily caps in SQL, the legacy import and the retention
-- policy. It deliberately does NOT flip authority - see "WHAT STAGE A IS NOT".
--
-- WHY STAGED
-- ----------
-- Points are earned in five places in the web client today (question sets,
-- session completion, timed bonuses, weekend missions, streak milestones,
-- roadmaps, document shares), all computed in the browser from localStorage.
-- Moving all of them server-side at once, while the same client is still
-- pushing its own total to user_profiles.points, produces two totals that
-- disagree and a leaderboard that flickers between them. A half-migrated points
-- system is worse than the current honest-but-cheatable one.
--
-- So Stage A gives the ledger a real, honest first customer - the challenge win,
-- which is decided entirely server-side from stored answers and cannot be
-- claimed by a client at all - and a read path the client reconciles its display
-- cache against. Stage B (a later migration, sketched at the foot of this file)
-- moves the remaining awards and revokes the client's UPDATE on the points
-- columns.
--
-- WHAT STAGE A IS NOT
-- -------------------
-- It is NOT tamper-proof points. The blanket policy "Users update own profile"
-- (FOR UPDATE USING auth.uid() = id, created in 20260425233320) still lets a
-- client write user_profiles.points directly, and every ordinary award is still
-- decided in the browser. Nothing here changes that. What it does change is that
-- there is now a place where a server-decided award can be recorded such that no
-- client can invent one, and one award actually uses it.


-- ── The ledger ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.point_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Matches GamificationEvent in src/lib/gamification.ts, plus 'legacy_import'.
  -- Deliberately not an enum: the client's event list changes more often than a
  -- migration window allows, and an unknown string here costs nothing.
  event_type  TEXT NOT NULL,
  -- Server-decided. There is no code path anywhere that takes this from a
  -- request body.
  points      INTEGER NOT NULL,
  earned_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  -- What the award was for: 'challenge' + challenge id, 'legacy' + user id.
  -- Lets the same source be deduplicated and lets an award be traced back.
  source_kind TEXT,
  source_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The whole anti-replay model in one constraint: an award tied to a source can
-- only ever be granted once, no matter how many times anything asks. Both
-- players' clients call challenge_sync_mine(), and challenge_resolve() is
-- explicitly idempotent, so this WILL be hit in normal operation.
CREATE UNIQUE INDEX IF NOT EXISTS point_events_source_uniq
  ON public.point_events (user_id, source_kind, source_id)
  WHERE source_id IS NOT NULL;

-- Serves the daily cap check and the per-user total.
CREATE INDEX IF NOT EXISTS point_events_user_day
  ON public.point_events (user_id, earned_on);

-- Serves the client's reconcile ("everything after the id I last absorbed").
CREATE INDEX IF NOT EXISTS point_events_user_id_desc
  ON public.point_events (user_id, id DESC);


-- ── The rollup, which is what keeps this table from eating the instance ─────
--
-- STORAGE ARITHMETIC, because the plan flagged this table as the one that
-- breaks the free tier (~700 MB/yr at 2,000 students) and this instance has
-- ~95 MB of headroom.
--
-- The plan's figure assumes ~8 rows per student per day, one per award. Two
-- decisions cut that before any retention policy is applied:
--   * chat_entered is never logged. +2 for opening a page was ~1/8 of all rows
--     for the least meaningful award in the system (the plan's own mitigation 2).
--   * per-question awards are logged as ONE row per session with the count
--     folded into `points`, not one row per question. A 50-question set is one
--     row, not fifty.
-- That leaves ~4 rows per active student per day: the set, its correct answers,
-- a timed bonus or two, and occasionally a weekend mission, a streak milestone
-- or a challenge win.
--
--   Raw row, including its three indexes:              ~120 B
--   Unbounded at 2,000 students:  2000 x 4 x 365       = 2.92M rows/yr = ~350 MB/yr
--                                                        ^^^ still fatal
--   With a 30-day raw window:     2000 x 4 x 30        = 240k rows     = ~29 MB
--                                                        ^^^ steady state, not per year
--
--   Monthly rollup row (incl. PK):                     ~100 B
--   A student earns ~5 distinct event types in a month:
--                                 2000 x 5 x 12        = 120k rows/yr  = ~12 MB/yr
--
-- Steady state at 2,000 students: ~29 MB raw + ~12 MB/yr of rollup. At the
-- current real scale (a couple of hundred students) it is ~3 MB raw and ~1 MB a
-- year. That fits the headroom; 2,000 students plus two years of rollup does
-- not, and the trigger to move to the $25 Pro tier is ~40 MB of point_events*,
-- not a student count.
--
-- The rollup preserves totals exactly (points are summed, never sampled) and
-- keeps the leaderboard's "Recent points" panel - which only ever renders 8 rows
-- - fully functional, because 8 rows is always inside a 30-day window.
CREATE TABLE IF NOT EXISTS public.point_events_monthly (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month      DATE NOT NULL,             -- first day of the month
  event_type TEXT NOT NULL,
  points     INTEGER NOT NULL,
  events     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month, event_type)
);


-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- SELECT your own history (the leaderboard's "Recent points" panel reads it).
-- NO INSERT, UPDATE OR DELETE POLICY ON EITHER TABLE, FOR ANY ROLE. With RLS on
-- and no write policy, these tables are write-proof from the client whatever the
-- request contains. Every write below happens inside a SECURITY DEFINER
-- function that decides the number it is about to store. That is the entire
-- security model and it is worth more than any amount of validation logic.
ALTER TABLE public.point_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_events_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS point_events_select ON public.point_events;
CREATE POLICY point_events_select ON public.point_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS point_events_monthly_select ON public.point_events_monthly;
CREATE POLICY point_events_monthly_select ON public.point_events_monthly FOR SELECT
  USING (auth.uid() = user_id);


-- ── Totals ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.points_total(p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT greatest(0,
    coalesce((SELECT sum(e.points) FROM public.point_events e WHERE e.user_id = p_user), 0)
  + coalesce((SELECT sum(m.points) FROM public.point_events_monthly m WHERE m.user_id = p_user), 0)
  )::INTEGER;
$$;

REVOKE ALL ON FUNCTION public.points_total(UUID) FROM PUBLIC, anon, authenticated;


-- ── The award primitive ─────────────────────────────────────────────────────
--
-- The ONLY way a row enters the ledger. Internal: no role may call it, so an
-- award can only ever be granted by another SECURITY DEFINER function that has
-- checked the evidence itself.
--
-- p_daily_cap is the most this event type may pay in one day, mirroring
-- DAILY_POINT_CAPS in src/lib/gamification.ts. NULL means uncapped, which is
-- correct for penalties: a penalty that stops applying is a loophole, not a
-- mercy. The cap is measured against today's POSITIVE awards of the same type,
-- which is exactly what the client's applyPoints() does.
--
-- Returns the points actually awarded: 0 for "already paid for this source" and
-- 0 for "the cap is used up".
CREATE OR REPLACE FUNCTION public.award_points(
  p_user        UUID,
  p_event_type  TEXT,
  p_points      INTEGER,
  p_source_kind TEXT DEFAULT NULL,
  p_source_id   UUID DEFAULT NULL,
  p_daily_cap   INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_earned INTEGER;
  v_awarded      INTEGER := p_points;
  v_rows         INTEGER;
BEGIN
  IF p_user IS NULL OR p_points IS NULL OR p_points = 0 THEN
    RETURN 0;
  END IF;

  IF p_points > 0 AND p_daily_cap IS NOT NULL THEN
    SELECT coalesce(sum(e.points), 0) INTO v_today_earned
    FROM public.point_events e
    WHERE e.user_id = p_user
      AND e.event_type = p_event_type
      AND e.earned_on = CURRENT_DATE
      AND e.points > 0;

    v_awarded := least(p_points, greatest(0, p_daily_cap - v_today_earned));
    IF v_awarded <= 0 THEN
      RETURN 0;
    END IF;
  END IF;

  INSERT INTO public.point_events (user_id, event_type, points, source_kind, source_id)
  VALUES (p_user, p_event_type, v_awarded, p_source_kind, p_source_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN 0;             -- this source has already been paid for. Once, ever.
  END IF;

  -- STAGE A: increment rather than recompute.
  --
  -- The client still owns the total (it is computed in localStorage and pushed
  -- to this column), so writing the ledger's own sum here would overwrite every
  -- point earned since the legacy import with a number that does not include
  -- them. Incrementing adds the server's award to whatever the client believes,
  -- which is the only operation that is correct while both are writing.
  --
  -- The client absorbs the same award into its cache by id, so the next push
  -- from the browser carries it too rather than undoing it - see
  -- reconcilePointsFromServer() in src/lib/gamification.ts and points_summary()
  -- below. In Stage B this line becomes `points = public.points_total(p_user)`.
  UPDATE public.user_profiles
  SET points = greatest(0, coalesce(points, 0) + v_awarded),
      gamification_updated_at = now()
  WHERE id = p_user;

  RETURN v_awarded;
END;
$$;

REVOKE ALL ON FUNCTION public.award_points(UUID, TEXT, INTEGER, TEXT, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;


-- ── The read path the client reconciles against ─────────────────────────────
--
-- Returns the caller's server-side total and the awards the server has granted,
-- newest first. The client keeps the id of the last one it absorbed into its
-- localStorage cache; anything with a higher id is new.
--
-- ids are from a single monotonic identity sequence, so "greater than the last
-- id I absorbed" is exact - no set of seen ids, no timestamps, no clock skew.
--
-- legacy_import is excluded: it is not something that happened to the student,
-- it is the opening balance their existing total was carried in as, and it is
-- already in the cache by definition (it was copied FROM it).
CREATE OR REPLACE FUNCTION public.points_summary(p_since_id BIGINT DEFAULT 0, p_limit INT DEFAULT 20)
RETURNS TABLE (
  server_total INTEGER,
  award_id     BIGINT,
  event_type   TEXT,
  points       INTEGER,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.points_total(auth.uid()),
    e.id,
    e.event_type,
    e.points,
    e.created_at
  FROM public.point_events e
  WHERE e.user_id = auth.uid()
    AND e.event_type <> 'legacy_import'
    AND e.id > coalesce(p_since_id, 0)
  ORDER BY e.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

REVOKE ALL ON FUNCTION public.points_summary(BIGINT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.points_summary(BIGINT, INT) TO authenticated;

-- A caller with no new awards still needs the total, and the query above returns
-- no rows in that case. This is the "just the number" companion.
CREATE OR REPLACE FUNCTION public.points_total_mine()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.points_total(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.points_total_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.points_total_mine() TO authenticated;


-- ── Carrying existing students in ───────────────────────────────────────────
--
-- The part the plan says will get skipped and shouldn't. Existing students have
-- real totals that were honestly earned and have no ledger rows behind them.
-- Deleting them to "start clean" punishes the loyal users hardest.
--
-- One row per student, event_type 'legacy_import', points = whatever
-- user_profiles.points says on the day this runs, source ('legacy', user id).
-- The unique index guarantees it can happen exactly once per student however
-- many times this is run, so it is safe to re-run and safe to run before the
-- rest of Stage A is switched on in the client.
--
-- It imports whatever inflation already exists, which is the honest trade and is
-- the reason to do it now rather than after a public leaderboard push has given
-- anybody a reason to inflate.
--
-- It does NOT touch user_profiles.points: after this runs the ledger total and
-- the profile total are the same number, which is exactly the invariant Stage B
-- needs to be able to switch the profile column to being derived.
CREATE OR REPLACE FUNCTION public.import_legacy_points()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.point_events (user_id, event_type, points, source_kind, source_id, earned_on)
  SELECT p.id, 'legacy_import', p.points, 'legacy', p.id,
         coalesce(p.gamification_updated_at::DATE, CURRENT_DATE)
  FROM public.user_profiles p
  WHERE coalesce(p.points, 0) > 0
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.import_legacy_points() FROM PUBLIC, anon, authenticated;

-- Run it now, as part of applying this migration. Every student's total is
-- preserved; nobody resets to zero.
SELECT public.import_legacy_points();


-- ── Retention ───────────────────────────────────────────────────────────────
--
-- Collapse raw rows older than the keep window into one monthly row per user per
-- event type, then delete them. Totals are preserved exactly.
--
-- legacy_import is never rolled up. It is one row per student for the life of
-- the account (~2,000 rows, ~240 KB at the planning figure) and keeping it raw
-- keeps the unique index on (user_id,'legacy',user_id) permanently effective -
-- if it were folded into the rollup, a second import_legacy_points() would find
-- no conflict and pay every student their whole balance twice.
--
-- Not scheduled here. pg_cron is not enabled on this project, and a job nobody
-- knows exists is worse than a documented manual step. Run it monthly:
--     select public.rollup_point_events();
CREATE OR REPLACE FUNCTION public.rollup_point_events(p_keep_days INT DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff DATE := CURRENT_DATE - greatest(7, coalesce(p_keep_days, 30));
  n INTEGER;
BEGIN
  WITH moved AS (
    DELETE FROM public.point_events e
    WHERE e.earned_on < v_cutoff
      AND e.event_type <> 'legacy_import'
    RETURNING e.user_id, date_trunc('month', e.earned_on)::DATE AS month, e.event_type, e.points
  ),
  grouped AS (
    SELECT user_id, month, event_type, sum(points)::INTEGER AS points, count(*)::INTEGER AS events
    FROM moved
    GROUP BY user_id, month, event_type
  )
  INSERT INTO public.point_events_monthly (user_id, month, event_type, points, events)
  SELECT user_id, month, event_type, points, events FROM grouped
  ON CONFLICT (user_id, month, event_type) DO UPDATE
    SET points = public.point_events_monthly.points + EXCLUDED.points,
        events = public.point_events_monthly.events + EXCLUDED.events;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.rollup_point_events(INT) FROM PUBLIC, anon, authenticated;


COMMENT ON TABLE public.point_events IS
  'Append-only ledger of awards the SERVER granted. No client write policy of any kind; every row is written by a SECURITY DEFINER function. Raw rows older than 30 days are rolled up into point_events_monthly.';
COMMENT ON TABLE public.point_events_monthly IS
  'Per user / month / event type rollup of point_events. Preserves totals exactly; exists so the ledger does not grow ~350 MB a year at 2,000 students.';


-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE B - NOT IN THIS FILE, AND NOT SAFE TO IMPROVISE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Stage B is what makes the leaderboard verifiable. In order:
--
--   1. award_for_session(session_id) - a SECURITY DEFINER function that reads
--      study_sessions + study_answers, confirms the session is the caller's and
--      completed, counts correct answers ITSELF (it can, now that
--      study_mcq_grade() is what wrote them), applies DAILY_POINT_CAPS through
--      award_points(), and returns the new total. source ('session', id), so the
--      unique index makes it pay once however many times the client calls it.
--      The timed bonus is checkable from feedback.timer_seconds and
--      completed_at, both already server-side. This replaces the five
--      recordGamificationEvent() calls on the practice screen.
--   2. Streaks derived from `SELECT DISTINCT earned_on` rather than stored -
--      note this must be read BEFORE the rollup window, or streaks longer than
--      the keep window stop being computable. Either lengthen the window or
--      keep a per-user last_active_on column.
--   3. award_points() changes its final UPDATE to
--      `points = public.points_total(p_user)` - the profile column becomes
--      derived rather than incremented.
--   4. Only then: replace the blanket "Users update own profile" policy so the
--      client cannot write points / weekly_points / current_streak. A BEFORE
--      UPDATE trigger that resets those three columns to their OLD values for
--      any non-definer caller is simpler than a column-restricted policy and
--      fails safe. Until this step, the ledger is decoration: a cheat can ignore
--      it and write the profile column directly.
--   5. The client's localStorage total stops being additive and becomes a pure
--      display cache of the server total.
--
-- Steps 3-5 must land in the SAME deploy as each other. Between 3 and 4 there is
-- a window where the profile column is derived but still client-writable, i.e.
-- where a client push silently reverts to a stale number.
