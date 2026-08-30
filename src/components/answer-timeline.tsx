// The pre-answer wait, told as an activity log instead of a spinner.
//
// What this replaces: `AnswerLoader` in the chat page - one advancing word over
// four shimmering skeleton bars. Two things were wrong with it. The skeleton
// drew a fake answer (four bars that never became the four lines they promised),
// and the word was the *only* thing the student learned in a wait that can run
// six seconds on a grounded question. A wait that long is not dead time; the app
// is genuinely reading files the student uploaded, and saying WHICH ones is the
// difference between "it's thinking" and "it's working on my stuff".
//
// So: a rail, one row per piece of work, and - under the row that has them - the
// specific things, in the plate mono face. It is deliberately calm. No spinner,
// no bounce, no colour: brightness alone marks the step in flight, the only
// motion is a row arriving, and the rail extends by one segment as it does.
// Colour was left out on purpose - copper on the active row was tried and it
// pulls the eye to a loader, which is the opposite of what a loader should do.
// If the owner wants it back it is one line: `--foreground` -> `var(--pop)` on
// `.gd-timeline-step.is-active` in styles.css. The ONE exception is failure,
// which is destructive-red, for the same reason `stage-progress.tsx` makes that
// exception: a failure that stays calm is a failure the student does not notice.
//
// Honesty rules this file keeps, the same two `stage-progress.tsx` keeps:
//
// 1. No invented percentage, and no promises. Steps that have not started are
//    NOT drawn. A greyed-out "Writing your answer" sitting there before any
//    writing has happened is a claim about the future, and the student can feel
//    it when the request stalls on the step above it. `pending` is a real status
//    on the wire - the server may well know its whole plan up front - but it
//    renders as nothing.
// 2. Sub-rows carry real values only. Nothing in this file invents a filename, a
//    query or a count. Every detail row came from the caller, which means from
//    the server or from documents the chat page actually retrieved.
//
// THE SHAPE IS A STREAM CONTRACT, NOT A TIMER. `steps` is designed so a server
// can drive it frame by frame: statuses move pending -> active -> done/empty/
// failed, labels and counts are supplied by whoever did the work rather than
// hard-coded here, and sub-rows append one at a time while their step is still
// active. See `AnswerProgressEvent` and `applyAnswerProgress` at the bottom -
// that is the wire format the edge function should emit, and the reducer that
// turns those frames into this prop.
//
// Until that ships there is a scripted fallback (`useAnswerTimelineSteps`) that
// reproduces the old loader's exact wording and its 1500ms advance. It exists
// for one specific window: the owner holds deploys, so this UI will be live
// against the old edge function for a while, and an empty rail is worse than the
// loader we replaced. `useAnswerTimeline` prefers real frames the moment any
// arrive and falls back to the script when none do.
import {
  BookOpen,
  ChevronDown,
  FileText,
  Globe,
  Layers,
  Lightbulb,
  PenLine,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

/** Icons are named for the *work*, not for the glyph. Two reasons: the caller
 *  never imports lucide, and - more importantly - a server can put one of these
 *  strings on the wire. Sending a glyph name (or, worse, an SVG) would make the
 *  edge function own our icon set. Unknown values fall back rather than throw,
 *  because a newer server talking to an older client is a real deployment
 *  state in this repo, not a hypothetical. */
export type AnswerTimelineIcon =
  | "reading"
  | "file"
  | "retrieval"
  | "search"
  | "web"
  | "writing"
  | "thinking";

const ICONS: Record<AnswerTimelineIcon, LucideIcon> = {
  reading: BookOpen,
  file: FileText,
  retrieval: Layers,
  search: Search,
  web: Globe,
  writing: PenLine,
  thinking: Lightbulb,
};

/**
 * Every state a real step can end in.
 *
 * `empty` is the one that earns its place. Retrieval finding nothing is a normal
 * outcome, it happens often on a general question against a thin library, and
 * the timeline must not report it as "done" - that is the specific lie this
 * status exists to prevent. `failed` is for a step that threw.
 */
export type AnswerStepStatus = "pending" | "active" | "done" | "empty" | "failed";

/**
 * One indented sub-row: a quiet prefix plus the specific thing.
 *
 * The split matters. "Read" is our copy and stays in the interface face; the
 * file name is data and goes in the mono chip. Running them together in one
 * string would set a student's filename in the same face as our own words,
 * which is exactly the ambiguity the mono face exists to remove.
 */
export type AnswerTimelineDetail = {
  /** Quiet prefix before the value, e.g. "Read", "Searched web for". */
  label?: string;
  /** The specific thing - a file name, a query. Mono, one line, truncated. */
  value: string;
  icon?: AnswerTimelineIcon;
};

export type AnswerTimelineStep = {
  /** Stable across every frame about this step. The reducer merges on it, and
   *  React keys on it, so a changing id would re-animate finished rows. */
  id: string;
  /** Server-authored. The component never composes this from parts - whoever
   *  did the work owns the wording, including any count inside it
   *  ("Searched 2 books"). A client that assembled the sentence itself would be
   *  doing arithmetic on a partial view of the work. */
  label: string;
  /** Optional: inferred from `id` when the server omits it. */
  icon?: AnswerTimelineIcon;
  status: AnswerStepStatus;
  /** Quiet trailing metric, set in mono next to the label - "18 chunks",
   *  "2 books". Separate from `label` only so it can be dimmer; a server that
   *  would rather put it in the label may. */
  note?: string;
  /** Real values only. Bare strings inherit `detailLabel` / `detailIcon`, so a
   *  caller holding `string[]` of filenames can pass it straight through. */
  details?: ReadonlyArray<string | AnswerTimelineDetail>;
  /** Prefix applied to bare-string details. */
  detailLabel?: string;
  /** Icon applied to bare-string details. */
  detailIcon?: AnswerTimelineIcon;
  /** Why it failed. Shown under the row, and only when status is `failed`. */
  error?: string;
};

/** Falls back by id, then to a neutral glyph. A step is never icon-less. */
function iconFor(step: AnswerTimelineStep): LucideIcon {
  if (step.icon && step.icon in ICONS) return ICONS[step.icon];
  if (step.id in ICONS) return ICONS[step.id as AnswerTimelineIcon];
  return ICONS.thinking;
}

function normalizeDetails(step: AnswerTimelineStep): AnswerTimelineDetail[] {
  if (!step.details?.length) return [];
  return step.details.map((detail) =>
    typeof detail === "string"
      ? { label: step.detailLabel, value: detail, icon: step.detailIcon }
      : {
          label: detail.label ?? step.detailLabel,
          value: detail.value,
          icon: detail.icon ?? step.detailIcon,
        },
  );
}

/**
 * Seconds since this loader mounted, ticking while `running`.
 *
 * Recomputed from a stored timestamp on every tick rather than incremented, so a
 * backgrounded tab - where browsers throttle timers to once a minute - comes
 * back showing the real elapsed time instead of a count that fell behind. The
 * effect ticks once on entry as well as on the interval, which means the moment
 * `running` goes false the final number is exact rather than up to a second old.
 */
function useElapsedSeconds(running: boolean): number {
  const startedAt = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
    tick();
    if (!running) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  return seconds;
}

export function AnswerTimeline({
  steps,
  // Collapsed by default, deliberately.
  //
  // The compact state is what the reference actually shows while work is in
  // flight - the detail is the thing you open afterwards to check the receipts.
  // And the alternative is genuinely worse here: expanded, every new step pushes
  // a fresh block of file names into a column the student is already staring at,
  // so the one screen in the app with nothing else on it becomes the twitchiest.
  // "Collapse when the answer arrives" was considered and does not apply - the
  // chat page unmounts this the instant the first token renders, so the collapse
  // would never be seen. One click opens it, and the chevron says it is there.
  defaultExpanded = false,
  className = "",
}: {
  steps: readonly AnswerTimelineStep[];
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const listId = useId();

  const busy = steps.some((step) => step.status === "active");
  // Pending steps are not promises - see rule 1 up top.
  const visible = steps.filter((step) => step.status !== "pending");
  const hasDetails = visible.some((step) => (step.details?.length ?? 0) > 0);
  const elapsed = useElapsedSeconds(busy);

  if (visible.length === 0) return null;

  // "Working" while it is, "Worked" once it is not - the past tense is a lie
  // while the request is still open, and this line is read during the wait.
  const elapsedText = `${busy ? "Working" : "Worked"} for ${elapsed}s`;

  return (
    // aria-live/aria-busy carried over from the loader this replaces. The elapsed
    // counter is aria-hidden on purpose: a live region that re-reads a number
    // every second is unusable, and the seconds are decoration, not information.
    // What a screen reader gets is one announcement per real step.
    <div className={`gd-timeline ${className}`} aria-live="polite" aria-busy={busy}>
      <div className="gd-timeline-head">
        {hasDetails ? (
          <button
            type="button"
            className="gd-timeline-toggle"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-controls={listId}
            // Named for what the control does. Its visible text is a ticking
            // number, which says nothing about the disclosure it operates.
            aria-label={expanded ? "Hide what G&D is doing" : "Show what G&D is doing"}
          >
            <span className="gd-timeline-elapsed" aria-hidden="true">
              {elapsedText}
            </span>
            <ChevronDown className="gd-timeline-chevron" aria-hidden="true" strokeWidth={2} />
          </button>
        ) : (
          <span className="gd-timeline-elapsed" aria-hidden="true">
            {elapsedText}
          </span>
        )}
      </div>

      <ol className="gd-timeline-steps" id={listId}>
        {visible.map((step) => {
          const Icon = iconFor(step);
          const details = expanded ? normalizeDetails(step) : [];
          return (
            // Stable keys matter more than usual here: a CSS entry animation
            // plays on mount, so a key that changed between renders would make
            // every finished row re-animate each time a new step arrives.
            <li key={step.id} className={`gd-timeline-step is-${step.status}`}>
              <span className="gd-timeline-row">
                <Icon className="gd-timeline-icon" aria-hidden="true" strokeWidth={1.75} />
                <span className="gd-timeline-label">{step.label}</span>
                {step.note && <span className="gd-timeline-note">{step.note}</span>}
              </span>

              {/* Failure lands. It is the one thing here that takes colour, and
                  it says what broke instead of stopping on a calm grey row. */}
              {step.status === "failed" && step.error && (
                <span className="gd-timeline-error">
                  <TriangleAlert
                    className="gd-timeline-icon"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  <span className="gd-timeline-error-text">{step.error}</span>
                </span>
              )}

              {details.length > 0 && (
                <ul className="gd-timeline-subs">
                  {details.map((detail, index) => {
                    const DetailIcon = detail.icon ? ICONS[detail.icon] : ICONS.file;
                    return (
                      // Keyed by value, not by index: sub-rows APPEND while the
                      // step is still active, and an index key would hand a new
                      // row the previous row's DOM node and skip its entry
                      // animation. The index suffix only breaks ties if a server
                      // ever repeats a value.
                      <li key={`${detail.value}:${index}`} className="gd-timeline-sub">
                        <DetailIcon
                          className="gd-timeline-icon"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                        {detail.label && (
                          <span className="gd-timeline-sub-label">{detail.label}</span>
                        )}
                        {/* title= so a truncated file name is still readable on
                            a pointer device without widening the row. */}
                        <span className="gd-timeline-chip" title={detail.value}>
                          {detail.value}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── The wire format ─────────────────────────────────────────────────────────
//
// What the chat edge function should emit, and how it rides the existing stream.
//
// The stream is OpenAI-shaped SSE: `data: {...}` lines, terminated by
// `data: [DONE]`. There is already exactly one precedent for a non-token frame -
// `medai_sources` - and `chat-client.ts` distinguishes it by a TOP-LEVEL KEY on
// the parsed object, before it looks at `choices[0].delta.content`. Progress
// frames follow that precedent exactly:
//
//     data: {"medai_progress":{"type":"step","id":"reading","label":"Reading your material","status":"active"}}
//
// Why the top-level key and not a new SSE `event:` name: the client's reader
// ignores every line that is not `data: `, so an `event:` line would be dropped
// silently. Why not a sentinel inside `delta.content`: it would be concatenated
// into the answer text by any client that does not know about it.
//
// The compatibility property that matters, given the owner holds deploys: an
// OLD client reading a NEW stream is safe. `Array.isArray(parsed.medai_sources)`
// is false, `parsed.choices?.[0]?.delta?.content` is undefined, so the frame
// falls through both branches and is discarded without touching the answer. So
// the edge function can ship before, after, or independently of the client.
//
// Ordering contract for the server:
//   - Emit a step's `step` frame BEFORE any `step_detail` for it. A detail whose
//     step is unknown is dropped, deliberately: inventing a row for a step we
//     have no label for would put an empty line on the rail.
//   - Close a step explicitly. A new step going `active` does NOT auto-finish
//     the previous one, because auto-finishing would quietly mark a step that
//     actually failed as `done`.
//   - Use the ids "reading", "sources", "web", "writing" where they fit. The
//     scripted fallback below uses those same ids, so if the first real frame
//     arrives a beat late the rows merge instead of the whole list re-keying and
//     re-animating.
//   - Flush after each frame. These are worth nothing if they arrive batched
//     with the first token.

export type AnswerProgressEvent =
  /** Creates a step, or updates one that already exists. Every field except
   *  `type`/`id` is optional on an update, so a status change is one small
   *  frame: {"type":"step","id":"reading","status":"done"}. */
  | {
      type: "step";
      id: string;
      label?: string;
      icon?: AnswerTimelineIcon;
      status?: AnswerStepStatus;
      note?: string;
      /** Only meaningful with status "failed". */
      error?: string;
      /** Prefix + icon for bare-string details that follow. Set once, on create. */
      detailLabel?: string;
      detailIcon?: AnswerTimelineIcon;
    }
  /** Appends ONE sub-row to a step that already exists. Sent as the thing is
   *  discovered, so rows arrive one at a time while the step is still active. */
  | {
      type: "step_detail";
      stepId: string;
      /** The specific thing: a file name, a query. Goes in the mono chip. */
      text: string;
      /** Overrides the step's `detailLabel` for this row only. */
      label?: string;
      icon?: AnswerTimelineIcon;
    };

/**
 * Folds one progress frame into the step list. Pure, so the client stream
 * handler is `setSteps((prev) => applyAnswerProgress(prev, event))` and nothing
 * else. Returns the same array reference when a frame changes nothing, so a
 * duplicate frame does not cause a render.
 */
export function applyAnswerProgress(
  steps: readonly AnswerTimelineStep[],
  event: AnswerProgressEvent,
): AnswerTimelineStep[] {
  if (event.type === "step") {
    const index = steps.findIndex((step) => step.id === event.id);
    if (index === -1) {
      return [
        ...steps,
        {
          id: event.id,
          // A create frame with no label would render a blank row, so it gets
          // the id as a last resort rather than an empty line on the rail.
          label: event.label ?? event.id,
          icon: event.icon,
          status: event.status ?? "active",
          note: event.note,
          error: event.error,
          detailLabel: event.detailLabel,
          detailIcon: event.detailIcon,
        },
      ];
    }
    const current = steps[index];
    const merged: AnswerTimelineStep = {
      ...current,
      // Only overwrite what the frame actually carried: an update frame that
      // omits `label` must not blank the label the create frame set.
      label: event.label ?? current.label,
      icon: event.icon ?? current.icon,
      status: event.status ?? current.status,
      note: event.note ?? current.note,
      error: event.error ?? current.error,
      detailLabel: event.detailLabel ?? current.detailLabel,
      detailIcon: event.detailIcon ?? current.detailIcon,
    };
    const next = [...steps];
    next[index] = merged;
    return next;
  }

  const index = steps.findIndex((step) => step.id === event.stepId);
  // Detail for a step we were never told about. Dropped on purpose - see the
  // ordering contract above.
  if (index === -1) return steps as AnswerTimelineStep[];

  const current = steps[index];
  const existing = current.details ?? [];
  // Retries and reconnects can replay a frame. A repeated sub-row is always a
  // duplicate rather than two genuinely identical pieces of work, so drop it.
  const alreadyThere = existing.some((detail) =>
    typeof detail === "string" ? detail === event.text : detail.value === event.text,
  );
  if (alreadyThere) return steps as AnswerTimelineStep[];

  const next = [...steps];
  next[index] = {
    ...current,
    details: [...existing, { label: event.label, value: event.text, icon: event.icon }],
  };
  return next;
}

// ── The scripted fallback ───────────────────────────────────────────────────
//
// Only for the window where this UI is live against an edge function that does
// not emit progress yet. It reproduces the old AnswerLoader's exact wording and
// its exact 1500ms advance, so on the old backend the swap changes how the wait
// LOOKS and not what it claims. Delete this block once every deployed edge
// function streams `medai_progress`.
//
// The one thing it does that the old loader could not: it hangs REAL file names
// under the reading step, when the caller has them. Those are the documents the
// chat page actually retrieved for this question - nothing here is invented.

type PlannedStep = Omit<AnswerTimelineStep, "status">;

const NO_NAMES: readonly string[] = [];
// Four is where a wait log stops being glanceable. The parent row carries the
// true count, so capping the list hides nothing.
const MAX_DETAIL_ROWS = 4;

export function useAnswerTimelineSteps({
  grounded,
  documentNames = NO_NAMES,
  webSearch = false,
  advanceMs = 1500,
}: {
  /** True when the pending answer is grounded in the student's own documents. */
  grounded: boolean;
  /** Real file names retrieved for this question. Rendered as the sub-rows. */
  documentNames?: readonly string[];
  /** True when the student turned the web toggle on for this question. */
  webSearch?: boolean;
  advanceMs?: number;
}): AnswerTimelineStep[] {
  // Callers pass `docs.map((d) => d.file_name)`, a fresh array every render.
  // Keyed on the joined text instead, so `plan` stays referentially stable and
  // the reset effect below does not fire on every parent render - which would
  // pin the timeline on step one forever.
  // NUL as the delimiter, written as an escape so the source file stays plain
  // text: a literal NUL byte makes git, grep and `file` treat this module as
  // binary. Any character a file name can contain would let two different
  // lists key the same - ["ab","c"] and ["a","bc"] collide under an empty or
  // comma delimiter - and a colliding key means the sub-rows keep showing the
  // previous answer's documents.
  const namesKey = documentNames.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- namesKey IS documentNames
  const names = useMemo(() => documentNames.slice(0, MAX_DETAIL_ROWS), [namesKey]);
  const nameCount = documentNames.length;

  const plan = useMemo<PlannedStep[]>(() => {
    const steps: PlannedStep[] = [];

    if (grounded) {
      steps.push({
        // Same ids the server should use, so a late first frame merges into
        // these rows instead of replacing the list.
        id: "reading",
        // Summarise the count in the parent row, the way the reference does
        // ("Ran 3 searches"). One file needs no count; zero means we never
        // learned the names, and the original wording is still true.
        label: nameCount > 1 ? `Reading ${nameCount} of your files` : "Reading your material",
        icon: "reading",
        details: names,
        detailIcon: "file",
        detailLabel: "Read",
      });
      steps.push({ id: "sources", label: "Pulling the strongest sources", icon: "retrieval" });
    } else {
      steps.push({ id: "thinking", label: "Thinking it through", icon: "thinking" });
    }

    // Only when the student actually switched web search on - a real signal off
    // a real toggle, not a step invented to pad the list.
    if (webSearch) steps.push({ id: "web", label: "Searching the web", icon: "web" });

    steps.push({ id: "writing", label: "Writing your answer", icon: "writing" });
    return steps;
  }, [grounded, names, nameCount, webSearch]);

  const [index, setIndex] = useState(0);

  // A new plan (the question changed shape mid-flight) restarts the sequence.
  useEffect(() => {
    setIndex(0);
  }, [plan]);

  useEffect(() => {
    if (index >= plan.length - 1) return;
    const timer = window.setTimeout(
      () => setIndex((current) => Math.min(current + 1, plan.length - 1)),
      advanceMs,
    );
    return () => window.clearTimeout(timer);
  }, [index, plan.length, advanceMs]);

  return useMemo(
    () =>
      plan.map((step, position) => ({
        ...step,
        status: position < index ? "done" : position === index ? "active" : "pending",
      })),
    [plan, index],
  );
}

/**
 * Real frames when there are any, the script when there are none.
 *
 * Deliberately one-way: once a single `medai_progress` frame has landed the
 * server owns the list for the rest of the request. Falling back mid-request
 * because frames went quiet would replace the server's account of the work with
 * a guess, which is the one thing this component is not allowed to do.
 */
export function useAnswerTimeline({
  grounded,
  documentNames,
  webSearch,
  serverSteps,
}: {
  grounded: boolean;
  documentNames?: readonly string[];
  webSearch?: boolean;
  /** Accumulated via `applyAnswerProgress`. Empty until the first frame lands. */
  serverSteps?: readonly AnswerTimelineStep[];
}): readonly AnswerTimelineStep[] {
  // Called unconditionally, as hooks must be. It costs one timer that nobody
  // renders once real frames take over.
  const scripted = useAnswerTimelineSteps({ grounded, documentNames, webSearch });
  return serverSteps && serverSteps.length > 0 ? serverSteps : scripted;
}

/**
 * Drop-in replacement for `AnswerLoader`: same one-prop call shape, plus the
 * real file names when the caller has them and the server's steps when they
 * exist. Keeping the wiring here rather than in the chat page means the call
 * site does not have to change again when the backend starts streaming.
 */
export function AnswerTimelineLoader({
  grounded,
  documentNames,
  webSearch,
  serverSteps,
  className = "",
}: {
  grounded: boolean;
  documentNames?: readonly string[];
  webSearch?: boolean;
  serverSteps?: readonly AnswerTimelineStep[];
  className?: string;
}) {
  const steps = useAnswerTimeline({ grounded, documentNames, webSearch, serverSteps });
  return <AnswerTimeline steps={steps} className={className} />;
}
