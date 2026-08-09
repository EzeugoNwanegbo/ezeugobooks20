-- ═══════════════════════════════════════════════════════════════════════════
-- SERVER-SIDE MCQ GRADING, STAGE 1 OF 2
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE PROBLEM
-- -----------
-- The practice screen selects study_questions.correct_answer (and .explanation)
-- into the browser so it can grade MCQs on-device. A student who opens devtools
-- can therefore read the key before answering. The comment above
-- challenge_score_session() in 20260809120000 states this as the reason friend
-- challenges award no points: the server can guarantee a score matches the
-- answers submitted, but not that the answers were not looked up first.
--
-- This migration removes the need for the client to ever hold an MCQ key it has
-- not earned:
--
--   * study_session_questions(session)  - the read path. Identical to the
--     current SELECT except that for an MCQ with no submitted answer yet,
--     correct_answer comes back as '' and explanation as NULL.
--   * study_mcq_grade(session, answers) - the write path. Compares the
--     submitted answers against the stored keys HERE, writes study_answers, and
--     returns per-question correctness plus the key and explanation for review.
--
-- Nothing the client sends is trusted: is_correct is never accepted as input,
-- it is decided by this file.
--
-- WHAT THIS MIGRATION DOES *NOT* DO, AND WHY
-- ------------------------------------------
-- It does not revoke the client's ability to SELECT correct_answer directly.
-- The mobile Capacitor app (gandd-mobile/app/(app)/coach.tsx) reads
-- study_questions by session_id, including correct_answer and explanation, and
-- grades on-device exactly as the web app does today. It ships through the app
-- stores, on its own schedule, to a user base that updates when it feels like
-- it. Revoking column access here would break every practice session on every
-- phone until a new build reached every student - a rollout nobody controls.
--
-- So the revoke is a SEPARATE migration, 20260810120100_withhold_mcq_keys.sql,
-- to be applied only after a mobile build that uses these two functions is out.
-- Until then this migration is the *behavioural* fix (the shipped web app stops
-- asking for keys it has not earned, so nothing in its network traffic contains
-- an unanswered question's answer) and not yet the *enforcement* (a student who
-- writes their own PostgREST request can still read the column).
--
-- That distinction matters for one thing in particular: points. Awarding points
-- for a challenge win is only honest once the enforcement half is applied,
-- which is why 20260810120300_award_challenge_win.sql is ordered after
-- 20260810120100 and must not be applied before it.

-- ── The read path ───────────────────────────────────────────────────────────
--
-- Returns the caller's own session's questions. Same columns and same order as
-- the query it replaces, so the client maps it unchanged, plus `answered` so
-- the client never has to infer why a key is missing.
--
-- WITHHELD IS '' RATHER THAN NULL on purpose: correct_answer is NOT NULL on the
-- table and typed `string` throughout the app. Empty string is falsy, matches no
-- option id, and needs no type change in a file that another change is in flight
-- in. `answered` is the field to branch on, not the emptiness of the string.
--
-- Only MCQs are withheld. An essay's correct_answer is its model answer, which
-- Learning mode deliberately offers behind a "Reveal model answer" button and
-- which the AI grader needs sent back to it; a flashcard's correct_answer is
-- the back of the card, i.e. the entire point of the card. Neither is a key that
-- can be compared against, so neither decides a contest or a point.
CREATE OR REPLACE FUNCTION public.study_session_questions(p_session_id UUID)
RETURNS TABLE (
  id             UUID,
  session_id     UUID,
  question_type  TEXT,
  prompt         TEXT,
  options        JSONB,
  correct_answer TEXT,
  explanation    TEXT,
  rubric         JSONB,
  source_refs    JSONB,
  difficulty     TEXT,
  "position"     INT,
  answered       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- CTE named ans_rows, not `answered`: `answered` is one of this function's
  -- output columns, and a name that is both is the kind of ambiguity that
  -- resolves at RUN time rather than at creation - i.e. in production.
  WITH mine AS (
    SELECT ss.id, ss.status
    FROM public.study_sessions ss
    WHERE ss.id = p_session_id AND ss.user_id = auth.uid()
  ),
  ans_rows AS (
    SELECT DISTINCT a.question_id
    FROM public.study_answers a
    WHERE a.session_id = p_session_id
  )
  SELECT
    q.id,
    q.session_id,
    q.question_type,
    q.prompt,
    q.options,
    CASE
      WHEN q.question_type <> 'mcq' THEN q.correct_answer
      WHEN m.status = 'completed' OR ans.question_id IS NOT NULL THEN q.correct_answer
      ELSE ''
    END,
    CASE
      WHEN q.question_type <> 'mcq' THEN q.explanation
      WHEN m.status = 'completed' OR ans.question_id IS NOT NULL THEN q.explanation
      ELSE NULL
    END,
    q.rubric,
    q.source_refs,
    q.difficulty,
    q.position,
    (q.question_type <> 'mcq' OR m.status = 'completed' OR ans.question_id IS NOT NULL)
  FROM mine m
  JOIN public.study_questions q ON q.session_id = m.id
  LEFT JOIN ans_rows ans ON ans.question_id = q.id
  ORDER BY q.position;
$$;

REVOKE ALL ON FUNCTION public.study_session_questions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.study_session_questions(UUID) TO authenticated;

COMMENT ON FUNCTION public.study_session_questions(UUID) IS
  'The practice screen''s question read. Withholds correct_answer ('''') and explanation (NULL) for MCQs the caller has not yet submitted an answer to. Essays and flashcards are returned unchanged.';


-- ── The write path ──────────────────────────────────────────────────────────
--
-- Grade one MCQ (Learning mode, as each option is picked) or the whole set
-- (Exam mode, on submit). p_answers is {question_id: option_id}.
--
-- What it refuses:
--   * a session that is not the caller's own;
--   * a session already marked completed - a finished set is not re-gradable,
--     and allowing it would let a student resubmit until the ledger liked the
--     answer;
--   * question ids that are not MCQs of this session (silently skipped, so a
--     mixed set can send its whole answer map without the caller filtering).
--
-- What it never reads: study_answers.is_correct or .score. Those columns are
-- client-writable and always will be; this function overwrites them from the
-- comparison it performs itself.
--
-- Idempotent by delete-then-insert over the ids being graded, rather than by a
-- unique index on (session_id, question_id). Adding that index would first
-- require de-duplicating whatever double submits have already left behind in
-- production, and challenge_score_session() is already written to tolerate
-- duplicates (DISTINCT ON ... ORDER BY created_at DESC). Delete-then-insert
-- gets idempotence without a data migration.
--
-- Comparison is lower(btrim(..)) on both sides - the same rule
-- challenge_score_session() uses, so a set played in practice and the same set
-- played as a challenge can never disagree about what "correct" meant.
CREATE OR REPLACE FUNCTION public.study_mcq_grade(
  p_session_id UUID,
  p_answers    JSONB
)
RETURNS TABLE (
  question_id    UUID,
  is_correct     BOOLEAN,
  correct_answer TEXT,
  explanation    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
-- Deliberately the first thing in the body (plpgsql only accepts it there).
-- This function's OUT parameters are question_id, is_correct, correct_answer and
-- explanation, which are also column names on the tables it reads and writes.
-- Every reference below is already qualified, but a later edit that forgets one
-- would fail at RUN time with an ambiguity error rather than in review. This
-- makes the column win, which is the right answer every time here: the locals
-- are all v_/p_-prefixed and can never clash. Same directive, same reasoning as
-- challenge_begin() in 20260809120000.
DECLARE
  v_me     UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'No answers were sent.';
  END IF;

  SELECT ss.status INTO v_status
  FROM public.study_sessions ss
  WHERE ss.id = p_session_id AND ss.user_id = v_me;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'That question set could not be found.';
  END IF;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'That set has already been submitted.';
  END IF;

  -- One statement, so `scope` is computed once and the delete, the insert and
  -- the returned rows cannot disagree about what was graded.
  --
  -- Data-modifying CTEs are executed exactly once and always to completion, and
  -- they all see the same snapshot - so `del` cannot remove the rows `ins`
  -- writes, however the planner orders them. That is what makes re-grading a
  -- replace rather than an append without needing a unique index on
  -- (session_id, question_id), which would first require de-duplicating
  -- whatever earlier double submits have already left in production.
  --
  -- The join is q.id::TEXT = lower(key) rather than key::UUID: a key that is not
  -- a uuid then fails to match instead of raising, so one stray entry in the map
  -- cannot fail the whole submit.
  RETURN QUERY
  WITH scope AS (
    SELECT
      q.id       AS question_id,
      btrim(sent.value) AS answer,
      q.correct_answer,
      q.explanation,
      q.position,
      lower(btrim(sent.value)) = lower(btrim(q.correct_answer)) AS correct
    FROM jsonb_each_text(p_answers) AS sent(key, value)
    JOIN public.study_questions q ON q.id::TEXT = lower(btrim(sent.key))
    WHERE q.session_id = p_session_id
      AND q.question_type = 'mcq'
      AND btrim(sent.value) <> ''
  ),
  del AS (
    DELETE FROM public.study_answers a
    WHERE a.session_id = p_session_id
      AND a.question_id IN (SELECT s.question_id FROM scope s)
    RETURNING a.id
  ),
  ins AS (
    INSERT INTO public.study_answers
      (question_id, session_id, user_id, answer, is_correct, score, feedback, missing_points)
    SELECT
      s.question_id, p_session_id, v_me, s.answer,
      s.correct,                                   -- the only place correctness is decided
      CASE WHEN s.correct THEN 1 ELSE 0 END,
      '', '[]'::jsonb
    FROM scope s
    RETURNING study_answers.question_id
  )
  -- `del` and `ins` are not referenced here and do not need to be: a
  -- data-modifying statement in a WITH clause is executed exactly once and
  -- always to completion, whether or not the primary query reads its output.
  SELECT s.question_id, s.correct, s.correct_answer, s.explanation
  FROM scope s
  ORDER BY s.position;
END;
$$;

REVOKE ALL ON FUNCTION public.study_mcq_grade(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.study_mcq_grade(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.study_mcq_grade(UUID, JSONB) IS
  'Grades submitted MCQ answers against study_questions.correct_answer server-side, writes study_answers, and returns correctness plus the key and explanation. Never accepts a client-supplied is_correct.';
