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

// ── The in-chat nudge's snooze ───────────────────────────────────────────────
// Dismissing the card used to last until the next reload, which made it read as
// nagging. It is an offer, not a dialog: a student who is not ready today may
// well be next week, so the dismissal is stored as a TIMESTAMP and the card
// re-offers itself once the week is up. Saving a background removes it for good
// - that is the caller's `!profile.personalization_background` check, not this.
//
// Same shape as the feature tour and the announcement (src/lib/feature-tour.ts,
// src/lib/announcement.ts): a versioned localStorage key, try/catch around every
// access, and a blocked-storage fallback that reports "snoozed" so nobody is
// trapped behind a card that reappears on every navigation. Deliberately NOT a
// column on user_profiles for the same reason given there - once per device is
// the right granularity for a nudge, and it needs no migration.
//
// Only the inline chat card consults this. The sidebar's permanent "Personalize"
// row opens the same panel and must always work, so it never calls these.

/** Bump the suffix to re-offer the nudge to everyone; the old key is abandoned. */
const PERSONALIZATION_NUDGE_KEY = "gd_personalization_nudge_dismissed_at_v1";

/** How long a dismissal holds before the card may offer itself again. */
const PERSONALIZATION_NUDGE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function isPersonalizationNudgeSnoozed(): boolean {
  try {
    const raw = window.localStorage.getItem(PERSONALIZATION_NUDGE_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    // A missing/corrupt value must not snooze forever - fall back to showing it.
    if (!Number.isFinite(dismissedAt)) return false;
    const elapsed = Date.now() - dismissedAt;
    // A clock that has moved backwards leaves `elapsed` negative; treat that as
    // "recently dismissed" rather than letting it re-show on every load.
    return elapsed < PERSONALIZATION_NUDGE_SNOOZE_MS;
  } catch {
    return true;
  }
}

export function snoozePersonalizationNudge(): void {
  try {
    window.localStorage.setItem(PERSONALIZATION_NUDGE_KEY, String(Date.now()));
  } catch {
    // Nothing to do - worst case the card offers itself again next session.
  }
}
