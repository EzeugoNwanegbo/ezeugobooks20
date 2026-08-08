// The state behind "Race the clock": the preset/custom choice, its validation,
// and the two questions a caller needs answered — what do I store, and is this
// choice startable? Kept out of the component file so both screens can share it
// without pulling the picker's markup in.
import { useEffect, useMemo, useState } from "react";
import {
  MAX_TIMER_MINUTES,
  MIN_TIMER_MINUTES,
  parseTimerMinutes,
  speedBonusMaxSeconds,
  timerPresetSeconds,
} from "@/lib/timed-challenge";

export type TimerChoice = {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  /** null while the student is on a preset; the raw typed text once on Custom. */
  customText: string | null;
  setCustomText: (value: string | null) => void;
  presetSeconds: number;
  setPresetSeconds: (value: number) => void;
  presetOptions: number[];
  /** The chosen budget in SECONDS, or 0 when nothing valid is chosen. */
  seconds: number;
  /** Why `seconds` is 0 while on Custom, for display under the input. */
  error: string | null;
  /** True when the choice is too generous to earn the +5 speed bonus. */
  overBonusLimit: boolean;
  /** The longest bonus-earning budget for this set, in seconds. */
  bonusMaxSeconds: number;
};

/**
 * Owns the whole timer choice for one screen. Called unconditionally at the top
 * of the component — the *rendering* of the picker can be conditional (essay-only
 * and flashcard sets have no elapsed clock), the hook never is.
 */
export function useTimerChoice(questionCount: number): TimerChoice {
  const [enabled, setEnabled] = useState(false);
  const [customText, setCustomText] = useState<string | null>(null);
  const [presetSeconds, setPresetSeconds] = useState(0);

  const safeCount = Math.max(1, Math.round(questionCount || 1));
  const presetOptions = useMemo(() => timerPresetSeconds(safeCount), [safeCount]);
  const bonusMaxSeconds = useMemo(() => speedBonusMaxSeconds(safeCount), [safeCount]);

  // Changing the size of the set re-prices the presets. Keep the student's
  // choice when it is still on offer, otherwise fall back to the suggested pace.
  // A typed time is theirs and is never re-priced underneath them.
  useEffect(() => {
    setPresetSeconds((current) =>
      presetOptions.includes(current) ? current : (presetOptions[1] ?? presetOptions[0] ?? 0),
    );
  }, [presetOptions]);

  const parsed = customText === null ? null : parseTimerMinutes(customText);
  const seconds = parsed ? (parsed.ok ? parsed.seconds : 0) : presetSeconds;
  const error = parsed && !parsed.ok ? parsed.error : null;

  return {
    enabled,
    setEnabled,
    customText,
    setCustomText,
    presetSeconds,
    setPresetSeconds,
    presetOptions,
    seconds,
    error,
    overBonusLimit: seconds > 0 && seconds > bonusMaxSeconds,
    bonusMaxSeconds,
  };
}

/** The seconds to persist for this choice: 0 (i.e. untimed) unless opted in. */
export function chosenTimerSeconds(choice: TimerChoice): number {
  return choice.enabled && choice.seconds > 0 ? choice.seconds : 0;
}

/**
 * The blocking message when the student turned the timer on but left it in an
 * unusable state, or null when the choice is fine. Callers refuse to start on a
 * non-null result rather than quietly building an untimed set out of a choice
 * the student believed they had made.
 */
export function timerChoiceBlocker(choice: TimerChoice): string | null {
  if (!choice.enabled) return null;
  if (choice.seconds > 0) return null;
  return (
    choice.error ?? `Pick a time between ${MIN_TIMER_MINUTES} and ${MAX_TIMER_MINUTES} minutes.`
  );
}
