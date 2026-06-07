-- Allow the new "flashcard" practice type alongside the existing question
-- types. Sessions can be flashcard sets; individual study_questions rows store
-- a flashcard as prompt=front, correct_answer=back.

ALTER TABLE public.study_questions
  DROP CONSTRAINT IF EXISTS study_questions_question_type_check;
ALTER TABLE public.study_questions
  ADD CONSTRAINT study_questions_question_type_check
  CHECK (question_type IN ('mcq', 'essay', 'flashcard'));

ALTER TABLE public.study_sessions
  DROP CONSTRAINT IF EXISTS study_sessions_question_type_check;
ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_question_type_check
  CHECK (question_type IN ('mcq', 'essay', 'mixed', 'flashcard'));

ALTER TABLE public.study_preferences
  DROP CONSTRAINT IF EXISTS study_preferences_preferred_question_type_check;
ALTER TABLE public.study_preferences
  ADD CONSTRAINT study_preferences_preferred_question_type_check
  CHECK (preferred_question_type IN ('mcq', 'essay', 'mixed', 'flashcard'));
