-- Battle Royale: raise the challenge size cap, make the host's time limit real,
-- and add roadmap series.
--
-- APPLIED BY HAND, as one transaction, in the Supabase SQL editor. Nothing in
-- this repo applies it for you.
--
-- PREREQUISITE: 20260809120000_social_usernames_friends_async_challenges.sql
-- must already be applied. It is - commit fb353c7 flipped SOCIAL_SCHEMA_APPLIED
-- to true on 2026-08-09 after verifying it in production - but section 0 checks
-- rather than trusts, because everything below edits objects that file created.
--
--
-- WHY THIS EXISTS
-- ---------------
-- The mobile app's Battle Royale screen lets a student pick a file, a scope, a
-- question count and a time limit, then send the match to a friend. Two of those
-- four cannot currently be honoured, and this file is what makes them true:
--
--   COUNT. challenges caps question_count at 12, in two places. The Battle
--   Royale design calls for 10/20/30 and a custom number, so 20 and 30 are
--   presently rendered as disabled pills with an apology.
--
--   TIME. The host picks a limit and it reaches nobody. challenge_begin() builds
--   the opponent's session feedback from scratch, so there has never been a
--   field for a limit to survive in. Today the mobile client smuggles it into the
--   title text ("Chapter 3 - 15 min"), which informs but does not enforce.
--
-- And one thing the design asks for that has no schema at all yet:
--
--   ROADMAP. A battle over a whole roadmap should be a SERIES - one round per
--   roadmap topic, a win for each - rather than a single set. Section 3 adds the
--   parent row and the link columns. The client half is not in this file; see
--   the note at the head of section 3.
--
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------
-- challenge_list_mine() is NOT touched. Exposing time_limit_minutes through it
-- would change its RETURNS TABLE shape, which CREATE OR REPLACE cannot do, so it
-- would need a DROP + recreate of an 85-line function - the same manoeuvre that
-- aborted a migration earlier today with
--
--     ERROR: 42P16: cannot change name of view column ...
--
-- for the view equivalent. The payoff does not justify it: the HOST already
-- knows the limit it chose, and the OPPONENT receives it in their session's
-- feedback from section 2, which is the copy that actually governs their sitting.
-- A later migration can widen the list function when something needs it there.
--
-- Series CREATION is likewise absent. Generating N question sets is client work
-- and costs AI spend per set; the server owns the parent row, the links, the
-- access rules and the resolution, and nothing else.
--
--
-- SAFETY
-- ------
-- Idempotent: every statement is IF EXISTS / IF NOT EXISTS or a CREATE OR
-- REPLACE, and section 0 refuses rather than half-applies. Running it twice
-- changes nothing the second time.
--
-- Additive: it adds two nullable columns and one table, widens one CHECK, and
-- replaces two function bodies. It deletes no row and narrows no access. Every
-- challenge that exists today keeps working unchanged - a NULL time_limit_minutes
-- means "no limit", and NULL series_id/round_index means "an ordinary one-off
-- battle", which is what all of them are.
--
-- ROLLBACK, if it is ever needed:
--   ALTER TABLE public.challenges DROP COLUMN IF EXISTS series_id;
--   ALTER TABLE public.challenges DROP COLUMN IF EXISTS round_index;
--   ALTER TABLE public.challenges DROP COLUMN IF EXISTS time_limit_minutes;
--   DROP TABLE IF EXISTS public.challenge_series;
--   DROP FUNCTION IF EXISTS public.challenge_series_resolve(UUID);
--   -- then re-run 20260809120000 to restore the 12-cap function bodies.


-- ═══ 0. PRECONDITIONS, ENFORCED ══════════════════════════════════════════════
--
-- A precondition stated in a comment is not a precondition. Everything below
-- edits objects the social migration created; if it has not run, the failures
-- would be a scatter of "relation does not exist" partway through rather than
-- one legible refusal at the top.

DO $$
BEGIN
  IF to_regclass('public.challenges') IS NULL THEN
    RAISE EXCEPTION
      'public.challenges does not exist. Apply 20260809120000_social_usernames_friends_async_challenges.sql first.';
  END IF;

  IF to_regclass('public.challenge_participants') IS NULL THEN
    RAISE EXCEPTION
      'public.challenge_participants does not exist. Apply 20260809120000 first.';
  END IF;

  IF to_regprocedure('public.challenge_create(text, uuid)') IS NULL
     AND to_regprocedure('public.challenge_create(text, uuid, integer)') IS NULL THEN
    RAISE EXCEPTION
      'public.challenge_create() does not exist in either shape. Apply 20260809120000 first.';
  END IF;

  IF to_regprocedure('public.challenge_begin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.challenge_begin() does not exist. Apply 20260809120000 first.';
  END IF;
END
$$;


-- ═══ 1. THE QUESTION CAP: 12 → 60 ════════════════════════════════════════════
--
-- 60 is not a taste. supabase/functions/studybody/index.ts clamps every
-- generation path at 60 (Math.min(..., 60) on count, mcqCount and essayCount,
-- with a floor of 1), so 60 is the largest set the server will ever actually
-- produce. Allowing more here would let a client ask for a number the generator
-- silently refuses to reach, and then a challenge would be created against a
-- set smaller than both players were told.
--
-- The original 12 was justified by storage - challenge_begin() duplicates the
-- question set for the opponent, so every question costs twice - and that
-- reasoning still holds, it is simply now bounded at 60 instead. The two purge
-- functions at the foot of the social migration
-- (purge_old_challenges, purge_challenge_question_copies) are what keep that
-- bounded over time and are unaffected by this change.

-- Inline CHECKs are auto-named by Postgres. The name below is the one Postgres
-- generates for this column on this table, but it is dropped IF EXISTS so a
-- differently-named copy simply survives and the ADD below is what matters.
ALTER TABLE public.challenges
  DROP CONSTRAINT IF EXISTS challenges_question_count_check;

DO $$
BEGIN
  -- Guarded so a re-run does not fail on the constraint already being there.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.challenges'::regclass
      AND conname  = 'challenges_question_count_check'
  ) THEN
    ALTER TABLE public.challenges
      ADD CONSTRAINT challenges_question_count_check
      CHECK (question_count BETWEEN 1 AND 60);
  END IF;
END
$$;


-- ═══ 2. AN ENFORCEABLE TIME LIMIT ════════════════════════════════════════════
--
-- NULL means no limit, and NULL is what every existing row means. Nothing is
-- backfilled: a challenge sent before this migration was sent without a limit,
-- and inventing one for it retroactively would change a contest already in play.
--
-- 240 minutes is the ceiling for the same reason the client uses it: the largest
-- set (60 questions) at a generous ~45s per question is about 68 minutes, so 240
-- leaves room for a slow reader while still rejecting an obvious typo.

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS time_limit_minutes SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.challenges'::regclass
      AND conname  = 'challenges_time_limit_check'
  ) THEN
    ALTER TABLE public.challenges
      ADD CONSTRAINT challenges_time_limit_check
      CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 240);
  END IF;
END
$$;

COMMENT ON COLUMN public.challenges.time_limit_minutes IS
  'Minutes the host allowed for the set. NULL = no limit. Copied into both '
  'players'' study_sessions.feedback so the two sittings are governed alike.';


-- 2a. challenge_create() gains the limit.
--
-- THE SUBTLE PART, and the reason for the DROP below. Adding a parameter does
-- not replace a function, it OVERLOADS it. If the old two-argument
-- challenge_create(TEXT, UUID) were left in place beside a new three-argument
-- version whose third argument has a DEFAULT, then a two-argument call matches
-- BOTH candidates and Postgres refuses it as ambiguous - at run time, in
-- production. The live website and the live mobile app both call it with two
-- arguments today, so that would break the feature for everyone the moment this
-- file was applied, while looking entirely reasonable in review.
--
-- Dropping the old signature first and giving the new third parameter a DEFAULT
-- means those existing two-argument callers keep working untouched and pick up
-- "no limit", which is exactly what they mean.
DROP FUNCTION IF EXISTS public.challenge_create(TEXT, UUID);

-- Body reproduced verbatim from 20260809120000 except for: the new parameter and
-- its validation, the 12 → 60 guard, the time_limit_minutes column in the
-- INSERT, and the limit added to the challenger's own session feedback. Every
-- other guard - virgin set, MCQ-only, friends-only, no draftAnswers, not already
-- sent, at most 3 open per friend - is unchanged and must stay that way.
CREATE OR REPLACE FUNCTION public.challenge_create(
  p_opponent_username  TEXT,
  p_session_id         UUID,
  p_time_limit_minutes INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      UUID := auth.uid();
  v_them    UUID;
  v_title   TEXT;
  v_count   INT;
  v_nonmcq  INT;
  v_answers INT;
  v_open    INT;
  v_status  TEXT;
  v_id      UUID;
  v_limit   SMALLINT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF public.is_guest_account(v_me) THEN
    RAISE EXCEPTION 'Create a free account to challenge a friend.';
  END IF;

  -- Validated here rather than left to the CHECK so the student gets a sentence
  -- instead of a constraint-violation string.
  IF p_time_limit_minutes IS NOT NULL
     AND (p_time_limit_minutes < 1 OR p_time_limit_minutes > 240) THEN
    RAISE EXCEPTION 'A time limit has to be between 1 and 240 minutes.';
  END IF;
  v_limit := p_time_limit_minutes::SMALLINT;

  SELECT s.user_id INTO v_them FROM public.find_student(p_opponent_username) s;
  IF v_them IS NULL OR v_them = v_me THEN
    RAISE EXCEPTION 'No student found with that handle.';
  END IF;
  IF NOT public.are_friends(v_me, v_them) THEN
    -- Challenges are friends-only. An unsolicited challenge from a stranger is
    -- a notification channel, and a notification channel is a spam channel.
    RAISE EXCEPTION 'You can only challenge students on your friends list.';
  END IF;

  -- The session must be the caller's own, unplayed, and made of MCQs.
  SELECT ss.status INTO v_status
  FROM public.study_sessions ss
  WHERE ss.id = p_session_id AND ss.user_id = v_me;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'That question set could not be found.';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'That set has already been played. Make a fresh one to challenge with.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE q.question_type <> 'mcq')
    INTO v_count, v_nonmcq
  FROM public.study_questions q WHERE q.session_id = p_session_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'That question set is empty.';
  END IF;
  IF v_nonmcq > 0 THEN
    RAISE EXCEPTION 'Challenges use multiple-choice questions only, so both scores are settled the same way.';
  END IF;
  IF v_count > 60 THEN
    -- Bounds the copied set (see challenge_begin) and therefore bounds the whole
    -- feature's storage. 60 is where the studybody edge function clamps
    -- generation, so it is also the largest set that can actually be built.
    RAISE EXCEPTION 'Challenges are up to 60 questions.';
  END IF;

  SELECT count(*) INTO v_answers
  FROM public.study_answers a WHERE a.session_id = p_session_id;
  IF v_answers > 0 THEN
    RAISE EXCEPTION 'That set has already been answered. Make a fresh one to challenge with.';
  END IF;

  -- Answers are only written to study_answers on submit; an abandoned sitting
  -- leaves its work in the session's feedback JSONB as `draftAnswers`. Without
  -- this check a challenger could answer the whole set in Learning mode (which
  -- grades each question as it is picked), walk away, and then send the set they
  -- have already seen the answers to.
  -- jsonb_exists(), not the `?` operator: this file gets pasted into SQL
  -- consoles and driven by drivers that treat a bare `?` as a bind placeholder.
  -- The function form means exactly the same thing and survives all of them.
  IF EXISTS (
    SELECT 1 FROM public.study_sessions ss
    WHERE ss.id = p_session_id AND jsonb_exists(ss.feedback, 'draftAnswers')
  ) THEN
    RAISE EXCEPTION 'That set has already been started. Make a fresh one to challenge with.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.challenges c WHERE c.source_session_id = p_session_id) THEN
    RAISE EXCEPTION 'That set has already been sent as a challenge.';
  END IF;

  -- Bounds spam AND storage in one rule: at most 3 unresolved challenges from
  -- this student to this friend at a time.
  SELECT count(*) INTO v_open
  FROM public.challenges c
  WHERE c.challenger = v_me AND c.opponent = v_them
    AND c.status IN ('pending', 'active');
  IF v_open >= 3 THEN
    RAISE EXCEPTION 'You already have 3 challenges waiting with this friend.';
  END IF;

  SELECT left(coalesce(nullif(btrim(t.title), ''), 'Challenge'), 80) INTO v_title
  FROM public.study_sessions ss
  JOIN public.study_topics t ON t.id = ss.topic_id
  WHERE ss.id = p_session_id;

  INSERT INTO public.challenges
    (challenger, opponent, title, question_count, source_session_id, status,
     time_limit_minutes, expires_at)
  VALUES
    (v_me, v_them, coalesce(v_title, 'Challenge'), v_count, p_session_id, 'pending',
     v_limit,
     -- Seven days. The plan is right that abandonment, not cheating, is what
     -- kills this feature; a deadline plus the sweep below is the difference
     -- between a feature and a graveyard of pending invitations.
     now() + INTERVAL '7 days')
  RETURNING id INTO v_id;

  INSERT INTO public.challenge_participants (challenge_id, user_id, session_id)
  VALUES (v_id, v_me, p_session_id), (v_id, v_them, NULL);

  -- Put the challenger's own sitting on the same footing as the copy the
  -- opponent will get: Exam mode, answered and submitted in one go. Otherwise
  -- the challenger plays in Learning mode, which reveals each answer as it is
  -- picked, and the two are not doing the same thing.
  --
  -- The time limit rides along in the same object, and by the same argument: if
  -- only one side's client knew the limit, the two would not be doing the same
  -- thing either.
  UPDATE public.study_sessions ss
  SET feedback = coalesce(ss.feedback, '{}'::jsonb)
                 || jsonb_build_object('mode', 'exam', 'challenge_id', v_id)
                 || CASE WHEN v_limit IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('time_limit_minutes', v_limit) END
  WHERE ss.id = p_session_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_create(TEXT, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_create(TEXT, UUID, INT) TO authenticated;


-- 2b. challenge_begin() carries the limit onto the opponent's copy.
--
-- This is the statement the whole of section 2 exists for. The opponent's
-- session feedback is built from scratch here, which is precisely why a host's
-- limit has never reached them.
--
-- Signature and return type are unchanged, so CREATE OR REPLACE is safe. Body
-- reproduced verbatim except for the one jsonb_build_object below.
CREATE OR REPLACE FUNCTION public.challenge_begin(p_challenge_id UUID)
RETURNS TABLE (session_id UUID, plan_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
-- The directive above is deliberately the first thing in the body (plpgsql only
-- accepts it there). This function's OUT parameters are named session_id and
-- plan_id, which are also column names on tables it writes to. Every reference
-- below is already table-qualified, but a later edit that forgets to qualify one
-- would fail at RUN time with "column reference is ambiguous" - i.e. in
-- production, not in review. This makes the column win, which is the right
-- answer every time here: all the locals are v_-prefixed and can never clash.
DECLARE
  c          public.challenges%ROWTYPE;
  v_me       UUID := auth.uid();
  v_session  UUID;
  v_plan     UUID;
  v_topic    UUID;
  v_started  TIMESTAMPTZ;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;

  SELECT * INTO c FROM public.challenges WHERE id = p_challenge_id;
  IF c.id IS NULL OR v_me NOT IN (c.challenger, c.opponent) THEN
    RAISE EXCEPTION 'Challenge not found.';
  END IF;
  IF c.status IN ('complete', 'expired', 'declined') THEN
    RAISE EXCEPTION 'That challenge is over.';
  END IF;
  IF now() >= c.expires_at THEN
    PERFORM public.challenge_resolve(c.id);
    RAISE EXCEPTION 'That challenge has expired.';
  END IF;

  SELECT p.session_id, p.started_at INTO v_session, v_started
  FROM public.challenge_participants p
  WHERE p.challenge_id = c.id AND p.user_id = v_me
  FOR UPDATE;

  IF v_session IS NULL THEN
    -- The opponent's copy. Its own plan and topic, so the practice screen's
    -- mastery bookkeeping has somewhere of its own to write and never touches
    -- the challenger's roadmap.
    INSERT INTO public.study_plans
      (user_id, title, course_outline, source_type, source_document_ids, preference_snapshot)
    VALUES
      (v_me, c.title, '', 'generated', '{}'::uuid[],
       -- Marks the plan as a challenge copy so
       -- purge_challenge_question_copies() can find it later without guessing.
       jsonb_build_object('challenge_copy', true, 'challenge_id', c.id))
    RETURNING id INTO v_plan;

    INSERT INTO public.study_topics
      (user_id, plan_id, title, summary, objectives, source_refs, position, status)
    VALUES
      (v_me, v_plan, c.title, 'A challenge set from a friend.',
       '[]'::jsonb, '[]'::jsonb, 0, 'practicing')
    RETURNING id INTO v_topic;

    INSERT INTO public.study_sessions
      (user_id, plan_id, topic_id, question_type, requested_count, total_questions, feedback)
    VALUES
      (v_me, v_plan, v_topic, 'mcq', c.question_count, c.question_count,
       -- 'exam' so the whole set is answered and submitted in one sitting, which
       -- is what makes the single server-stamped finish time meaningful.
       --
       -- The host's time limit is appended when there is one. Absent this, the
       -- opponent's client has no way to learn the limit at all: this object is
       -- the entirety of what it is told about the sitting.
       jsonb_build_object('mode', 'exam', 'challenge_id', c.id)
       || CASE WHEN c.time_limit_minutes IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('time_limit_minutes', c.time_limit_minutes) END)
    RETURNING id INTO v_session;

    INSERT INTO public.study_questions
      (user_id, session_id, plan_id, topic_id, question_type, prompt, options,
       correct_answer, explanation, rubric, difficulty, source_refs, position)
    SELECT
      v_me, v_session, v_plan, v_topic, q.question_type, q.prompt, q.options,
      q.correct_answer, q.explanation, q.rubric, q.difficulty,
      '[]'::jsonb,          -- see the note above: no file names cross accounts
      q.position
    FROM public.study_questions q
    WHERE q.session_id = c.source_session_id
    ORDER BY q.position;
  ELSE
    SELECT ss.plan_id INTO v_plan FROM public.study_sessions ss WHERE ss.id = v_session;
  END IF;

  UPDATE public.challenge_participants p
  SET session_id = v_session,
      -- Stamped ONCE, by the server, on first open. Re-opening does not restart
      -- the clock, so leaving and coming back costs you rather than resetting
      -- your time - the same direction of error as everything else here.
      started_at = coalesce(p.started_at, now())
  WHERE p.challenge_id = c.id AND p.user_id = v_me;

  UPDATE public.challenges SET status = 'active'
  WHERE id = c.id AND status = 'pending';

  RETURN QUERY SELECT v_session, v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_begin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_begin(UUID) TO authenticated;


-- ═══ 3. ROADMAP SERIES ═══════════════════════════════════════════════════════
--
-- A roadmap battle is N ORDINARY CHALLENGES, one per roadmap topic, with a
-- parent row tying them together. That is the whole design, and it is chosen
-- over a bespoke "series match" table because every rule that already governs a
-- challenge - friends-only, MCQ-only, virgin set, server-stamped finish times,
-- the tie-break on duration, expiry, the purges - then governs a round for free
-- and cannot drift out of step with it.
--
-- WHAT THE CLIENT STILL OWES, and why it is not here: creating a series means
-- generating one question set per topic, which is N AI generations and real
-- money. That belongs where the cost is visible and interruptible, not inside a
-- migration. The client inserts the series row, then calls the existing
-- challenge_create() once per round and stamps series_id / round_index.

CREATE TABLE IF NOT EXISTS public.challenge_series (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised onto this row for the same reason challenges denormalises them:
  -- see the SELECT policy below.
  challenger     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  -- The roadmap this was built from. SET NULL rather than CASCADE: deleting a
  -- study plan should not delete the record of a contest that was played over it.
  source_plan_id UUID REFERENCES public.study_plans(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'complete', 'expired')),
  -- NULL on a complete series means a DRAW - the same convention, and the same
  -- renderability requirement, as challenges.winner_user_id. An even split of
  -- rounds is not exotic.
  winner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  CONSTRAINT challenge_series_distinct_players CHECK (challenger <> opponent)
);

CREATE INDEX IF NOT EXISTS challenge_series_challenger_idx
  ON public.challenge_series (challenger, created_at DESC);
CREATE INDEX IF NOT EXISTS challenge_series_opponent_idx
  ON public.challenge_series (opponent, created_at DESC);

ALTER TABLE public.challenge_series ENABLE ROW LEVEL SECURITY;

-- READ THE WARNING ON challenges' OWN POLICY BEFORE EDITING THIS.
--
-- Both player ids live on this row so the policy is a bare membership test with
-- no subquery. A policy here that reached into challenges - whose own policy
-- would then be consulted - is the mutual recursion Postgres refuses at RUN
-- time, i.e. in production rather than in review. The denormalisation is what
-- buys the simple test, and it is not an accident on either table.
DROP POLICY IF EXISTS challenge_series_select ON public.challenge_series;
CREATE POLICY challenge_series_select ON public.challenge_series FOR SELECT
  USING (auth.uid() IN (challenger, opponent));

-- No INSERT / UPDATE / DELETE policies, deliberately. Series rows are written by
-- SECURITY DEFINER functions and by nothing else, exactly as challenges is: a
-- client that could write its own row could name itself the winner.

COMMENT ON TABLE public.challenge_series IS
  'Parent of a roadmap battle: one challenges row per roadmap topic, linked by '
  'challenges.series_id. Winner is whoever takes the most rounds; NULL = draw.';


-- 3a. The link columns. NULL on both means an ordinary one-off battle, which is
--     what every row that exists today is.
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.challenge_series(id) ON DELETE CASCADE;

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS round_index SMALLINT;

DO $$
BEGIN
  -- A round with no series, or a series membership with no position in it, is
  -- meaningless in both directions - and an unordered "series" cannot be shown
  -- to a student as rounds 1..N. Enforced rather than trusted to the client.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.challenges'::regclass
      AND conname  = 'challenges_series_pairing_check'
  ) THEN
    ALTER TABLE public.challenges
      ADD CONSTRAINT challenges_series_pairing_check
      CHECK ((series_id IS NULL) = (round_index IS NULL));
  END IF;
END
$$;

-- Partial: ordinary battles are the overwhelming majority and carry NULL here,
-- so there is no reason to index them.
CREATE INDEX IF NOT EXISTS challenges_series_idx
  ON public.challenges (series_id, round_index)
  WHERE series_id IS NOT NULL;

-- One round per position per series. Without this a retry that half-failed could
-- leave two "round 3"s and the series would score one of them twice.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_series_round_uniq
  ON public.challenges (series_id, round_index)
  WHERE series_id IS NOT NULL;


-- 3b. Resolution. Counts round wins and settles the series.
--
-- Only once EVERY round has finished, in the challenges sense of finished:
-- 'complete' or 'expired'. A series settled while a round is still playable
-- would crown someone who could still be caught.
--
-- Idempotent, like challenge_resolve: calling it on an already-resolved series
-- returns its verdict without rewriting anything.
CREATE OR REPLACE FUNCTION public.challenge_series_resolve(p_series_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s            public.challenge_series%ROWTYPE;
  v_rounds     INT;
  v_unfinished INT;
  v_a_wins     INT;
  v_b_wins     INT;
  v_winner     UUID;
BEGIN
  SELECT * INTO s FROM public.challenge_series WHERE id = p_series_id FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Series not found.';
  END IF;

  IF s.status <> 'active' THEN
    RETURN s.status;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE c.status NOT IN ('complete', 'expired'))
    INTO v_rounds, v_unfinished
  FROM public.challenges c
  WHERE c.series_id = s.id;

  -- A series with no rounds yet is one whose creation was interrupted partway.
  -- Left 'active' rather than resolved: there is nothing to judge, and calling
  -- it a draw would be a verdict on a contest that never happened.
  IF v_rounds = 0 OR v_unfinished > 0 THEN
    RETURN 'active';
  END IF;

  -- Expired rounds count as won by nobody, which is already true of them
  -- individually: challenge_resolve leaves winner_user_id NULL on a draw and on
  -- a round neither player finished.
  SELECT count(*) FILTER (WHERE c.winner_user_id = s.challenger),
         count(*) FILTER (WHERE c.winner_user_id = s.opponent)
    INTO v_a_wins, v_b_wins
  FROM public.challenges c
  WHERE c.series_id = s.id;

  IF v_a_wins > v_b_wins THEN
    v_winner := s.challenger;
  ELSIF v_b_wins > v_a_wins THEN
    v_winner := s.opponent;
  ELSE
    -- NULL = draw. Deliberately no tie-break on total duration: rounds were
    -- played on different days and the per-round tie-break has already been
    -- applied where it means something.
    v_winner := NULL;
  END IF;

  UPDATE public.challenge_series
  SET status = 'complete', winner_user_id = v_winner, resolved_at = now()
  WHERE id = s.id;

  RETURN 'complete';
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_series_resolve(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_series_resolve(UUID) TO authenticated;
