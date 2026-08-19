// "Continue in another AI": turn the current G&D conversation into one
// self-contained prompt a student can paste into ChatGPT, Gemini, Claude, etc.
// and have that assistant pick up mid-thought instead of starting cold.
//
// The generated text has three parts:
//   1. A short lead-in that frames the situation for the receiving AI.
//   2. The student's study context (course/field, level, goals, imported
//      "who I am" background) so the tone/depth carries over.
//   3. The conversation transcript, followed by a clear ask to continue.
//
// Two flavours, both built from those parts:
//   - buildContinuationPrompt: the whole conversation, "keep going from here".
//   - buildExplainLastAnswerPrompt: just the latest answer (plus the question
//     that produced it), "help me actually understand this".

import type { Profile } from "@/lib/auth-context";
import type { ChatMessage } from "@/lib/chat-client";

// Keep the transcript comfortably under the paste limits of the major chat
// UIs. If a long conversation exceeds this, we keep the most recent turns and
// note that earlier context was trimmed.
const MAX_TRANSCRIPT_CHARS = 24_000;

// A single answer is quoted in full unless it is enormous, in which case the
// end (the part the student just read) is what matters.
const MAX_SINGLE_ANSWER_CHARS = 12_000;

function cleanValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function buildStudentContext(profile: Profile): string {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = cleanValue(value);
    if (text) lines.push(`- ${label}: ${text}`);
  };

  add("Field / course", profile.course);
  add("Level", profile.year);
  add("Institution", profile.university);
  add("Working toward", profile.exam_format);
  add("Weak areas to watch", profile.weak_areas);
  add("Recent topics", profile.recent_topics);

  const background = cleanValue(profile.personalization_background);

  if (lines.length === 0 && !background) return "";

  const parts = ["## About the student"];
  if (lines.length > 0) parts.push(lines.join("\n"));
  if (background) {
    parts.push(`\nBackground the student shared about how they learn:\n${background}`);
  }
  return `${parts.join("\n")}\n\n`;
}

function buildTranscript(messages: ChatMessage[]): string {
  const turns = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => {
      const speaker = m.role === "user" ? "Student" : "Assistant";
      return `**${speaker}:** ${m.content.trim()}`;
    });

  let transcript = turns.join("\n\n");
  let trimmed = false;

  // Drop oldest turns until we fit, so the most recent (most relevant) context
  // always survives.
  while (transcript.length > MAX_TRANSCRIPT_CHARS && turns.length > 1) {
    turns.shift();
    transcript = turns.join("\n\n");
    trimmed = true;
  }

  const prefix = trimmed
    ? "_(Earlier messages were trimmed for length; the most recent exchange is below.)_\n\n"
    : "";
  return `${prefix}${transcript}`;
}

/**
 * Build the full paste-anywhere prompt for continuing this conversation in
 * another AI. Returns null when there is nothing worth exporting yet.
 */
export function buildContinuationPrompt(messages: ChatMessage[], profile: Profile): string | null {
  const hasContent = messages.some((m) => m.content.trim().length > 0);
  if (!hasContent) return null;

  const lastMeaningful = [...messages].reverse().find((m) => m.content.trim().length > 0);
  const endedOnQuestion = lastMeaningful?.role === "user";

  const leadIn =
    "I was working through this with a study assistant and I'd like to continue here. " +
    "Please read the context and the conversation so far, then pick up naturally where it " +
    "left off — same topic, same depth, no need to reintroduce yourself or summarise what " +
    "we already covered unless I ask.";

  const ask = endedOnQuestion
    ? "My last message above is the question I still need answered. Please answer it, then keep helping from there."
    : "That's where we got to. I'll ask my next question from here — please continue helping.";

  return [
    leadIn,
    "",
    buildStudentContext(profile).trimEnd(),
    "",
    "## The conversation so far",
    buildTranscript(messages),
    "",
    "## What I need next",
    ask,
  ]
    .filter((part) => part !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build a paste-anywhere prompt that asks another AI to unpack the most recent
 * G&D answer — for when the student understood the topic but not the
 * explanation. Carries the question that produced it so the other AI has the
 * intent, not just the text. Returns null when there is no answer yet.
 */
export function buildExplainLastAnswerPrompt(
  messages: ChatMessage[],
  profile: Profile,
): string | null {
  const lastAnswerIndex = messages.reduce(
    (found, m, i) => (m.role === "assistant" && m.content.trim().length > 0 ? i : found),
    -1,
  );
  if (lastAnswerIndex === -1) return null;

  let answer = messages[lastAnswerIndex]!.content.trim();
  if (answer.length > MAX_SINGLE_ANSWER_CHARS) {
    answer = `_(Start of the answer was trimmed for length.)_\n\n…${answer.slice(-MAX_SINGLE_ANSWER_CHARS)}`;
  }

  // The question this answer was responding to, if there was one.
  const question = messages
    .slice(0, lastAnswerIndex)
    .reverse()
    .find((m) => m.role === "user" && m.content.trim().length > 0)
    ?.content.trim();

  const leadIn =
    "A study assistant gave me the explanation below and I want to understand it properly. " +
    "Please re-explain it in your own words, in plain language, at the level of the student " +
    "context below. Break it into the key ideas, spell out anything it skipped or assumed I " +
    "already knew, flag anything you think is wrong or oversimplified, and finish with two or " +
    "three questions I should be able to answer if I've actually understood it.";

  return [
    leadIn,
    "",
    buildStudentContext(profile).trimEnd(),
    "",
    ...(question ? ["## What I asked", question, ""] : []),
    "## The answer I got",
    answer,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
