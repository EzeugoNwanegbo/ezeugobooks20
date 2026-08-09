-- ═══════════════════════════════════════════════════════════════════════════
-- POINTS FOR A CHALLENGE WIN
-- ═══════════════════════════════════════════════════════════════════════════
--
--            APPLY ONLY AFTER, AND IN THIS ORDER:
--              1. 20260810120000_mcq_server_grading.sql
--              2. 20260810120100_withhold_mcq_keys.sql   <- the enforcement
--              3. 20260810120200_point_events_ledger.sql
--
-- Step 2 is not optional and not merely "nice to have first". Until the key is
-- genuinely unreadable ahead of the answer, a challenge win is worth whatever a
-- devtools console is worth, and paying points for it is paying for a lookup.
-- The comment above challenge_score_session() in 20260809120000 says exactly
-- this, and it is the stated reason EVENT_POINTS.pvp_win has been wired to
-- nothing since it was defined.
--
-- WHAT MAKES THIS AWARD HONEST
--   * The result is not reported by anybody. challenge_resolve() reads
--     challenge_participants.score, which challenge_finish_participant() wrote
--     from challenge_score_session(), which recounts from study_answers against
--     study_questions.correct_answer and never reads the client-written
--     is_correct or score columns.
--   * The award is written by award_points(), into a table with no client write
--     policy of any kind.
--   * The unique index on (user_id, source_kind, source_id) means one challenge
--     pays at most once, ever. That matters here rather than in theory:
--     challenge_resolve() is explicitly idempotent and BOTH players' clients
--     call challenge_sync_mine() on opening the friends page.
--   * The loser and a draw pay nothing. There is no participation award, so
--     there is nothing to farm by losing on purpose.


-- ── The daily cap ───────────────────────────────────────────────────────────
--
-- 40 points a day, i.e. two wins. Chosen to sit with the others in
-- DAILY_POINT_CAPS rather than to be defensible on its own:
--
--   coach_session_completed   45  = 3 finished sets
--   coach_timed_challenge     30  = 3 timed sets
--   coach_beat_timer          15  = 3 beats
--   pvp_win                   40  = 2 wins
--
-- Two is the right number rather than three because a win is worth 20 - the
-- second most valuable single award in the system after a roadmap - and because
-- the farm this cap exists to stop is specific and easy: a student and a friend
-- trading wins all night. Uncapped, that pair mints 20 points per set for as
-- long as they can stay awake, on questions they are not reading. Capped at two,
-- the trade is worth 40 points a day each, which is less than one honest
-- practice set, so it stops being a strategy and becomes a slower way to study.
--
-- What it does NOT do is stop them playing: the sixth challenge of the day still
-- runs, still resolves, still shows a win. It pays nothing, exactly like the
-- sixth practice set of the day.
--
-- Three other limits already stack under this one, which is why 40 is enough
-- rather than merely a number: challenge_create() refuses more than 3 unresolved
-- challenges between the same pair, refuses any set that has been answered, and
-- every challenge costs one AI question-generation call.
CREATE OR REPLACE FUNCTION public.award_challenge_win(p_challenge_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge_id;

  -- Only a settled challenge with an actual winner pays. NULL winner_user_id on
  -- a complete challenge is a draw, and a draw is a result, not a win.
  IF c.id IS NULL OR c.status <> 'complete' OR c.winner_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- A guest cannot be in a challenge (challenge_create refuses them), but the
  -- check is cheap and this is the function that turns a result into a number.
  IF public.is_guest_account(c.winner_user_id) THEN
    RETURN 0;
  END IF;

  RETURN public.award_points(
    c.winner_user_id,
    'pvp_win',
    20,                    -- EVENT_POINTS.pvp_win
    'challenge',
    c.id,
    40                     -- DAILY_POINT_CAPS.pvp_win
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_challenge_win(UUID) FROM PUBLIC, anon, authenticated;


-- ── challenge_resolve, with the award ───────────────────────────────────────
--
-- Byte-for-byte the function from 20260809120000 apart from the single PERFORM
-- added after the row is marked complete. It is reproduced in full rather than
-- patched because CREATE OR REPLACE is the only way to change a function body,
-- and a diff of the two is the honest way to review what changed.
--
-- The award is deliberately AFTER the UPDATE that settles the challenge, so a
-- failure in the points path can never leave a contest unresolved. It is inside
-- the same transaction, so it cannot pay for a challenge that then fails to
-- settle either.
CREATE OR REPLACE FUNCTION public.challenge_resolve(p_challenge_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            public.challenges%ROWTYPE;
  v_done       INT;
  v_total      INT;
  v_winner     UUID;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN 'missing';
  END IF;
  IF c.status IN ('complete', 'expired', 'declined') THEN
    RETURN c.status;      -- already settled; never re-decide a finished contest
  END IF;

  SELECT count(*) FILTER (WHERE p.finished_at IS NOT NULL), count(*)
    INTO v_done, v_total
  FROM public.challenge_participants p
  WHERE p.challenge_id = c.id;

  IF v_done < v_total THEN
    IF now() < c.expires_at THEN
      RETURN c.status;    -- still waiting on somebody, and there is still time
    END IF;
    -- Deadline passed with someone unplayed. Expire it with NO winner. Awarding
    -- the win to whoever showed up would make "challenge someone who is busy"
    -- a strategy, and there is nothing to award anyway.
    UPDATE public.challenges
    SET status = 'expired', resolved_at = now()
    WHERE id = c.id;
    RETURN 'expired';
  END IF;

  SELECT p.user_id INTO v_winner
  FROM public.challenge_participants p
  WHERE p.challenge_id = c.id
  ORDER BY p.score DESC NULLS LAST, p.duration_ms ASC NULLS LAST
  LIMIT 1;

  -- A draw is a real outcome, not a failure to pick: identical score AND
  -- identical duration_ms. duration_ms is milliseconds of server time, so this
  -- is vanishingly rare in practice - but "vanishingly rare" is exactly the
  -- branch that ships broken, so it is written and the UI renders it.
  IF (
    SELECT count(DISTINCT (p.score, p.duration_ms))
    FROM public.challenge_participants p
    WHERE p.challenge_id = c.id
  ) = 1 THEN
    v_winner := NULL;
  END IF;

  UPDATE public.challenges
  SET status = 'complete', winner_user_id = v_winner, resolved_at = now()
  WHERE id = c.id;

  -- ADDED BY 20260810120300. Pays the winner, once ever, capped daily. Returns
  -- 0 for a draw, for an already-paid challenge and for a used-up cap; none of
  -- those is an error and none of them changes the outcome of the contest.
  PERFORM public.award_challenge_win(c.id);

  RETURN 'complete';
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_resolve(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_resolve(UUID) TO authenticated;

COMMENT ON FUNCTION public.award_challenge_win(UUID) IS
  'Pays EVENT_POINTS.pvp_win (20) to the winner of a settled challenge, capped at 40/day, once per challenge ever. Derives the winner from stored answers via challenge_resolve; never from anything a client reports.';
