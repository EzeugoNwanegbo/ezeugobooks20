import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/auth-context";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const STUDYBODY_URL = `${SUPABASE_URL}/functions/v1/studybody`;
const STUDYBODY_TIMEOUT_MS = 130_000;

export type StudyQuestionType = "mcq" | "essay" | "mixed" | "flashcard";

export type StudyDocument = {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
};

export type GeneratedFlashcard = {
  front: string;
  back: string;
  source_refs?: unknown[];
};

export type StudyRoadmapTopic = {
  title: string;
  summary?: string;
  objectives?: string[];
  source_refs?: unknown[];
  estimated_minutes?: number;
};

export type GeneratedQuestion = {
  type: "mcq" | "essay";
  prompt: string;
  options?: { id: string; text: string }[];
  correct_answer: string;
  explanation?: string;
  rubric?: string[];
  difficulty?: string;
  source_refs?: unknown[];
};

export type StudyReview = {
  grading: {
    score?: number;
    total?: number;
    percentage?: number;
    answers?: {
      question_id?: string;
      is_correct?: boolean;
      score?: number;
      feedback?: string;
      missing_points?: string[];
    }[];
    weak_areas?: string[];
    next_steps?: string[];
  };
  coaching: string;
};

async function callStudyBody<T>(payload: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), STUDYBODY_TIMEOUT_MS);

  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Sign in again before using My Coach.");

    const response = await fetch(STUDYBODY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = "My Coach AI request failed";
      try {
        const json = await response.json();
        message = json.error ?? message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function generateStudyPlan({
  profile,
  planTitle,
  courseOutline,
  documents,
}: {
  profile: Profile;
  planTitle: string;
  courseOutline: string;
  documents: StudyDocument[];
}) {
  return callStudyBody<{
    title: string;
    course_outline: string;
    source_type: "uploaded" | "generated" | "mixed";
    topics: StudyRoadmapTopic[];
  }>({
    action: "generate_plan",
    profile,
    planTitle,
    courseOutline,
    documents,
  });
}

export async function generateStudyQuestions({
  profile,
  topic,
  questionType,
  count,
  mcqCount,
  essayCount,
  documents,
  excludePrompts,
  difficultyHint,
  difficulty,
}: {
  profile: Profile;
  topic: unknown;
  questionType: StudyQuestionType;
  count: number;
  // For the "mixed" type, the caller specifies how many of each kind to make.
  mcqCount?: number;
  essayCount?: number;
  documents: StudyDocument[];
  excludePrompts?: string[];
  difficultyHint?: "easier" | "medium" | "harder";
  // Explicit student-chosen level; overrides the adaptive difficultyHint.
  difficulty?: "easy" | "medium" | "hard";
}) {
  return callStudyBody<{ questions: GeneratedQuestion[] }>({
    action: "generate_questions",
    profile,
    topic,
    questionType,
    count,
    mcqCount,
    essayCount,
    documents,
    excludePrompts,
    difficultyHint,
    difficulty,
  });
}

export async function generateFlashcards({
  profile,
  topic,
  count,
  documents,
  excludeFronts,
}: {
  profile: Profile;
  topic: unknown;
  count: number;
  documents: StudyDocument[];
  excludeFronts?: string[];
}) {
  return callStudyBody<{ flashcards: GeneratedFlashcard[] }>({
    action: "generate_flashcards",
    profile,
    topic,
    count,
    documents,
    excludePrompts: excludeFronts,
  });
}

export async function reviewStudyAnswers({
  profile,
  mode,
  questions,
  answers,
}: {
  profile: Profile;
  mode: "Simplified" | "Detailed" | "Storytelling";
  questions: unknown[];
  answers: Record<string, string>;
}) {
  return callStudyBody<StudyReview>({
    action: "review_answers",
    profile,
    mode,
    questions,
    answers,
  });
}
