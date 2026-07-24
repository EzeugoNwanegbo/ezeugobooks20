// "Continue in another AI": turn the current G&D conversation into one
// self-contained prompt a student can paste into ChatGPT, Gemini, Claude, etc.
// and have that assistant pick up mid-thought instead of starting cold.
//
// The generated text has three parts:
//   1. A short lead-in that frames the situation for the receiving AI.
//   2. The student's study context (discipline, level, goals, imported
//      "who I am" background) so the tone/depth carries over.
//   3. The conversation transcript, followed by a clear ask to continue.

import type { Profile } from "@/lib/auth-context";
import type { ChatMessage } from "@/lib/chat-client";

// Keep the transcript comfortably under the paste limits of the major chat
// UIs. If a long conversation exceeds this, we keep the most recent turns and
// note that earlier context was trimmed.
const MAX_TRANSCRIPT_CHARS = 24_000;

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

  add("Field / course", profile.discipline ?? profile.course);
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
