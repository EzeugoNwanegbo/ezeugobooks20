// "Race the clock" — the opt-in timer, shared by the two screens that can start
// a question set (PQ → Go straight in, and the roadmap practice config) so
// the two can never drift apart.
//
// Still optional, and still off by default. Off means the caller writes no timer
// key at all, which is byte-for-byte the untimed behaviour that existed before
// any of this: no clock, no countdown, no timer awards.
//
// The presets stay exactly as they were and remain the fast path. "Custom" sits
// beside them for the student who knows their own exam length.
import { Timer } from "lucide-react";
import { MAX_TIMER_MINUTES } from "@/lib/timed-challenge";
import type { TimerChoice } from "@/lib/use-timer-choice";

const OPTION_CLASS =
  "rounded-xl border px-2 py-2 text-sm font-medium tabular-nums transition-colors";
const OPTION_ON = "border-pop/50 bg-pop/10 text-pop";
const OPTION_OFF = "border-border hover:border-pop/30 hover:bg-foreground/[0.02]";

export function TimerPicker({ choice }: { choice: TimerChoice }) {
  const onPreset = choice.customText === null;
  return (
    <div className="rounded-xl border border-border p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={choice.enabled}
          onChange={(event) => choice.setEnabled(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--pop)]"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Timer className="h-3.5 w-3.5 text-pop" />
            Race the clock
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
            Optional. Finish inside the time for a bonus. Running out costs the bonus and nothing
            else — the set stays open.
          </span>
        </span>
      </label>

      {choice.enabled && (
        <>
          {/* Presets first: still the default, still one tap. */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {choice.presetOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  choice.setCustomText(null);
                  choice.setPresetSeconds(option);
                }}
                className={`${OPTION_CLASS} ${
                  onPreset && choice.presetSeconds === option ? OPTION_ON : OPTION_OFF
                }`}
              >
                {Math.round(option / 60)} min
              </button>
            ))}
            <button
              type="button"
              onClick={() => choice.setCustomText(choice.customText ?? "")}
              className={`${OPTION_CLASS} ${!onPreset ? OPTION_ON : OPTION_OFF}`}
            >
              Custom
            </button>
          </div>

          {!onPreset && (
            <div className="mt-2 space-y-1.5">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Your own time, in minutes
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_TIMER_MINUTES}
                  step={1}
                  value={choice.customText ?? ""}
                  onChange={(event) => choice.setCustomText(event.target.value)}
                  placeholder={`Minutes (1-${MAX_TIMER_MINUTES})`}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                />
              </label>
              {choice.error ? (
                <p className="text-[11px] leading-relaxed text-destructive">{choice.error}</p>
              ) : choice.overBonusLimit ? (
                // Stated up front rather than discovered afterwards: a budget
                // this generous still runs, it just is not a race any more.
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  That is longer than {Math.round(choice.bonusMaxSeconds / 60)} min, the most
                  generous time we would call a race for this many questions. The set still runs on
                  your clock — you just will not earn the speed bonus.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Up to {MAX_TIMER_MINUTES} minutes. Half minutes are fine.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
