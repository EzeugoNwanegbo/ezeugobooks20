// The copy-paste prompt a student runs inside whatever AI they already study
// with. Its reply is a ready-made "who I am" that G&D imports so answers are
// personalized from day one instead of learning the student from scratch.
// Shared by the in-chat setup card and the Settings > Personalization section.
import { supabase } from "@/integrations/supabase/client";

export const PERSONALIZATION_PROMPT = `Based on everything you know about me from our past conversations, write a concise profile of me for another study assistant. Use short bullet points and cover: my field and level of study, the exams or goals I'm working toward, my strong areas, my weak areas, how I learn best (analogies, examples, step-by-step, visuals?), and anything about my tone or preferences. Address it to the other AI, starting with "This student…".`;

/**
 * The single write path for the imported "who I am" background. Both entry
 * points - the in-chat setup card and the sidebar Personalize panel - go
 * through here, so the column name and the "blank means clear it" rule can't
 * drift between them. Resolves to an error message, or null on success.
 */
export async function savePersonalizationBackground(
  userId: string,
  text: string,
): Promise<string | null> {
  const value = text.trim();
  const { error } = await supabase
    .from("user_profiles")
    .update({ personalization_background: value || null })
    .eq("id", userId);
  return error ? error.message : null;
}
