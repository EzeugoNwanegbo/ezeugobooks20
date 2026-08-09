-- ═══════════════════════════════════════════════════════════════════════════
-- SERVER-SIDE MCQ GRADING, STAGE 2 OF 2 - THE ENFORCEMENT
-- ═══════════════════════════════════════════════════════════════════════════
--
--                        ⚠  DO NOT APPLY THIS YET  ⚠
--
-- Applying this file makes study_questions.correct_answer and .explanation
-- unreadable by any client, so the ONLY way to see either is
-- public.study_session_questions() (which withholds unearned MCQ keys) and
-- public.study_mcq_grade() (which hands the key back at the moment the answer
-- is submitted). Both are created by 20260810120000_mcq_server_grading.sql,
-- which must be applied first.
--
-- APPLY THIS ONLY WHEN ALL THREE ARE TRUE:
--   1. 20260810120000_mcq_server_grading.sql is applied.
--   2. The web app has shipped with MCQ_GRADING_APPLIED = true in
--      src/lib/mcq-grading.ts, so the browser reads questions through the
--      function rather than the table.
--   3. A mobile build that does the same has reached students.
--      gandd-mobile/app/(app)/coach.tsx currently does:
--
--          .from("study_questions")
--          .select("id, session_id, question_type, prompt, options,
--                   correct_answer, explanation, rubric, source_refs,
--                   difficulty, position")
--
--      in TWO places (the resume path and the fresh-set path), and grades on
--      device by comparing answers[q.id] to q.correct_answer. Both selects fail
--      outright the moment this file is applied - not degrade, fail - and the
--      practice screen on every phone that has not updated goes with them.
--      Mobile ships through the app stores on its own schedule; that rollout is
--      not something this repo controls.
--
--      The mobile change is the same one made on web: replace both selects with
--      supabase.rpc("study_session_questions", { p_session_id }), and replace
--      the on-device comparison with
--      supabase.rpc("study_mcq_grade", { p_session_id, p_answers }), taking
--      is_correct / correct_answer / explanation from what it returns.
--
-- ORDERING WITH POINTS: 20260810120300_award_challenge_win.sql must be applied
-- AFTER this file. A challenge win is only worth points once the key genuinely
-- cannot be read ahead of the answer; before that, awarding for a win pays for
-- a lookup.

-- Column-level revoke has to be done as "revoke the table privilege, then grant
-- back the columns that stay". A table-level SELECT grant beats any column-level
-- revoke in Postgres, so REVOKE SELECT (correct_answer) alone would do nothing
-- at all while looking like it had worked.
--
-- INSERT / UPDATE / DELETE are deliberately untouched: the client still writes
-- these rows when it generates a question set, and writing a key it chose is not
-- a way to learn a key it did not.
REVOKE SELECT ON public.study_questions FROM authenticated, anon;

GRANT SELECT (
  id,
  session_id,
  plan_id,
  topic_id,
  user_id,
  question_type,
  prompt,
  options,
  rubric,
  difficulty,
  source_refs,
  position,
  created_at
) ON public.study_questions TO authenticated;

COMMENT ON COLUMN public.study_questions.correct_answer IS
  'The key. Not readable by authenticated/anon - reach it through study_session_questions() (withheld for unanswered MCQs) or study_mcq_grade() (returned on submit). See 20260810120100_withhold_mcq_keys.sql.';

-- ── Rollback, if a mobile build turns out to be further away than thought ────
--
--   GRANT SELECT ON public.study_questions TO authenticated;
--
-- That restores the previous behaviour exactly, and costs nothing on the web
-- side: study_session_questions() and study_mcq_grade() keep working, because
-- they are SECURITY DEFINER and never depended on the caller's grants.
