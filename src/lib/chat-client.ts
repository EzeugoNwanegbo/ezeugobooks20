import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/auth-context";
// The progress wire format is DEFINED by the timeline component, not here: it
// owns the schema, the reducer that folds these frames into rows, and the
// ordering contract the edge function follows. Importing the type rather than
// restating it means a change there is a type error here instead of a silent
// mismatch. `import type` is erased at build, so this adds no runtime edge
// between a lib module and a component.
import type { AnswerProgressEvent } from "@/components/answer-timeline";
import {
  costFor,
  reportCookieSpend,
  reportCookiesSettled,
  reportOutOfCookies,
} from "@/lib/cookies";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const CHAT_START_TIMEOUT_MS = 120_000;
const DOCUMENT_CHAT_START_TIMEOUT_MS = 160_000;
const WEB_CHAT_START_TIMEOUT_MS = 95_000;
const VISUAL_CHAT_START_TIMEOUT_MS = 300_000;
const LENGTH_LIMIT_NOTE =
  '\n\nNote: The AI hit its response length limit before finishing. Ask "continue" and it can pick up from here.';
const INCOMPLETE_STREAM_NOTE =
  '\n\nNote: The connection closed before the AI sent its final completion marker, so this answer may be incomplete. Ask "continue" or retry the question.';

// ── Single-hop document answers: the opt-in switch ──────────────────────────
//
// The chat edge function can answer a document-grounded question in one
// streamed call instead of a blocking research draft followed by a styling
// rewrite - 8 to 25 seconds of blank screen, removed. It ships OFF: that one
// deployed function serves this site AND the native mobile app, there is no
// staging copy of it, and the owner wants the same question run both ways
// against the real thing before students meet the new shape.
//
// So the switch is per request, and it can be thrown without a rebuild:
//
//     window.__gdSingleHop = true          // this tab, until reload
//     localStorage.gd_single_hop = "1"     // this browser, until cleared
//
// An explicit `singleHop` argument beats both. When nothing is set the flag is
// left OUT of the request body entirely, so an unflagged request is byte for
// byte the request that shipped.
const SINGLE_HOP_STORAGE_KEY = "gd_single_hop";

function singleHopOverride(): boolean | undefined {
  if (typeof window === "undefined") return undefined;

  const live = (window as unknown as { __gdSingleHop?: unknown }).__gdSingleHop;
  if (typeof live === "boolean") return live;

  try {
    const stored = window.localStorage.getItem(SINGLE_HOP_STORAGE_KEY);
    if (stored === "1" || stored === "true") return true;
    if (stored === "0" || stored === "false") return false;
  } catch {
    // Private mode, or storage blocked by policy. A missing test flag is never
    // worth throwing over.
  }

  return undefined;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type DocumentCtx = {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
};

// "Detailed+" is the study-notes mode: a fully structured, headed, PDF-ready
// write-up. "Visuals" is retired (see CHAT_MODES in the chat page) but stays in
// the union so old saved messages/preferences still type-check.
export type ChatMode = "Simplified" | "Detailed" | "Detailed+" | "Storytelling" | "Visuals";
export type DocumentMode = "none" | "smart" | "selected";

export type WebSource = {
  title: string;
  url: string;
  image?: string;
};

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
}

export async function streamChat({
  messages,
  profile,
  mode,
  documents,
  documentMode,
  forceWebSearch,
  interlink,
  singleHop,
  onDelta,
  onMeta,
  onSources,
  onProgress,
  onDone,
  onError,
  onCancel,
  signal,
}: {
  messages: ChatMessage[];
  profile: Profile;
  mode: ChatMode;
  documents?: DocumentCtx[];
  documentMode?: DocumentMode;
  forceWebSearch?: boolean;
  interlink?: boolean;
  /** Force the one-call document route on or off for this request. Unset means
   *  "whatever the console/localStorage override says", which is normally off. */
  singleHop?: boolean;
  onDelta: (chunk: string) => void;
  onMeta?: (meta: { model: string; source: string }) => void;
  onSources?: (sources: WebSource[]) => void;
  /** One frame of the server's account of the wait. Fold each into the timeline
   *  with `applyAnswerProgress` - the reducer is pure and dedupes replays, so
   *  the handler is a single setState. Never fires against an edge function
   *  that predates progress frames; the caller keeps its scripted fallback for
   *  exactly that case. */
  onProgress?: (event: AnswerProgressEvent) => void;
  onDone: () => void | Promise<void>;
  onError: (err: string) => void;
  onCancel?: () => void;
  signal?: AbortSignal;
}) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    onError("Chat is not configured. Add the Supabase environment variables in hosting.");
    return;
  }

  let token = SUPABASE_PUBLISHABLE_KEY;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData.session?.access_token ?? SUPABASE_PUBLISHABLE_KEY;
  } catch {
    token = SUPABASE_PUBLISHABLE_KEY;
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  let startTimedOut = false;
  const startTimeoutMs =
    mode === "Visuals"
      ? VISUAL_CHAT_START_TIMEOUT_MS
      : forceWebSearch
        ? WEB_CHAT_START_TIMEOUT_MS
        : documents?.length
          ? DOCUMENT_CHAT_START_TIMEOUT_MS
          : CHAT_START_TIMEOUT_MS;
  const timeout = window.setTimeout(() => {
    startTimedOut = true;
    controller.abort();
  }, startTimeoutMs);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  let resp: Response;

  try {
    if (signal?.aborted) {
      onCancel?.();
      return;
    }
    // Optimistic: the actual charge happens server-side, inside the Edge
    // Function, before it calls DeepSeek - by the time this request is even
    // sent it is about to be charged (or refused). Moving the ring now rather
    // than waiting the full round trip is the whole point of "optimistic" per
    // src/lib/cookies.ts; reportCookiesSettled() below reconciles once the
    // real number is known either way.
    reportCookieSpend(costFor("chat"));
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        messages,
        profile,
        mode,
        documents,
        documentMode,
        forceWebSearch,
        interlink,
        // JSON.stringify drops undefined keys, so an unflagged request carries
        // no trace of this at all.
        singleHop: (singleHop ?? singleHopOverride()) === true ? true : undefined,
      }),
    });
  } catch (err) {
    reportCookiesSettled();
    if (signal?.aborted) {
      onCancel?.();
      return;
    }
    onError(
      startTimedOut || (err instanceof DOMException && err.name === "AbortError")
        ? "The AI service took too long to respond. This is usually hosting/provider latency; try again or test locally."
        : "Couldn't reach the AI service. Check your connection or hosting logs.",
    );
    return;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
    window.clearTimeout(timeout);
  }

  onMeta?.({
    model: resp.headers.get("X-Medai-Model") ?? "",
    source: resp.headers.get("X-Medai-Source") ?? "general",
  });

  if (!resp.ok || !resp.body) {
    let msg = "Failed to start chat";
    try {
      const j = await resp.json();
      msg = j.error ?? msg;
      if (resp.status === 402 && j.error === "out_of_cookies") {
        reportOutOfCookies({ remaining: j.remaining, allowance: j.allowance });
      }
    } catch {
      /* ignore */
    }
    reportCookiesSettled();
    onError(msg);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  let sawDoneMarker = false;
  // Set only by a `medai_error` frame - a failure the server could not report
  // as an HTTP status because it had already opened the stream. See the handler
  // for it below.
  let streamError: string | null = null;
  let finishReason: string | null = null;
  let receivedContent = false;

  while (!done) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await readWithAbort(reader, signal);
    } catch (err) {
      await reader.cancel().catch(() => {});
      // The charge already happened server-side before this response started
      // streaming (a 200 got this far) - a client-side read failure after that
      // is not something the server refunds, so this only reconciles the ring
      // with what was actually spent rather than reporting a fresh spend.
      reportCookiesSettled();
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        onCancel?.();
        return;
      }
      onError(
        "The AI stream ended unexpectedly. Try again; if this repeats, check the Edge Function provider logs.",
      );
      return;
    }

    const { done: streamDone, value } = chunk;
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") {
        sawDoneMarker = true;
        done = true;
        break;
      }
      try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed.medai_sources)) {
          onSources?.(parsed.medai_sources as WebSource[]);
          continue;
        }
        // A top-level key, tested BEFORE the delta - the same shape
        // medai_sources has had since it shipped, and the reason an old client
        // can read a new stream safely: it is not an array under
        // medai_sources, it carries no choices[0].delta.content, so it falls
        // through both branches and is discarded without touching the answer.
        if (parsed.medai_progress && typeof parsed.medai_progress === "object") {
          onProgress?.(parsed.medai_progress as AnswerProgressEvent);
          continue;
        }
        // A failure the server hit AFTER committing a 200. It opens the stream
        // early now, to narrate the slow work behind it, which costs it the
        // ability to answer with an HTTP error - so the error comes down the
        // stream instead, in place of an answer, and the stream closes with no
        // [DONE]. A client that does not know this frame still reports the
        // failure, via the "ended before any response arrived" path below.
        if (typeof parsed.medai_error === "string" && parsed.medai_error) {
          streamError = parsed.medai_error;
          done = true;
          break;
        }
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        const parsedFinishReason = parsed.choices?.[0]?.finish_reason as string | null | undefined;
        if (parsedFinishReason) finishReason = parsedFinishReason;
        if (content) {
          receivedContent = true;
          onDelta(content);
        }
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
  // Flush trailing
  if (buffer.trim()) {
    for (let raw of buffer.split("\n")) {
      if (!raw || raw.startsWith(":")) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (!raw.startsWith("data: ")) continue;
      const json = raw.slice(6).trim();
      if (json === "[DONE]") {
        sawDoneMarker = true;
        continue;
      }
      try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed.medai_sources)) {
          onSources?.(parsed.medai_sources as WebSource[]);
          continue;
        }
        // A top-level key, tested BEFORE the delta - the same shape
        // medai_sources has had since it shipped, and the reason an old client
        // can read a new stream safely: it is not an array under
        // medai_sources, it carries no choices[0].delta.content, so it falls
        // through both branches and is discarded without touching the answer.
        if (parsed.medai_progress && typeof parsed.medai_progress === "object") {
          onProgress?.(parsed.medai_progress as AnswerProgressEvent);
          continue;
        }
        // A failure the server hit AFTER committing a 200. It opens the stream
        // early now, to narrate the slow work behind it, which costs it the
        // ability to answer with an HTTP error - so the error comes down the
        // stream instead, in place of an answer, and the stream closes with no
        // [DONE]. A client that does not know this frame still reports the
        // failure, via the "ended before any response arrived" path below.
        if (typeof parsed.medai_error === "string" && parsed.medai_error) {
          streamError = parsed.medai_error;
          done = true;
          break;
        }
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        const parsedFinishReason = parsed.choices?.[0]?.finish_reason as string | null | undefined;
        if (parsedFinishReason) finishReason = parsedFinishReason;
        if (content) {
          receivedContent = true;
          onDelta(content);
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (streamError) {
    await reader.cancel().catch(() => {});
    // The charge happened server-side before the stream opened, and the edge
    // function refunds it on this path itself; this only reconciles the ring.
    reportCookiesSettled();
    onError(streamError);
    return;
  }

  if (finishReason === "length") {
    onDelta(LENGTH_LIMIT_NOTE);
  } else if (!sawDoneMarker && !finishReason) {
    if (!receivedContent) {
      reportCookiesSettled();
      onError("The AI stream ended before any response arrived. Please retry.");
      return;
    }
    onDelta(INCOMPLETE_STREAM_NOTE);
  }

  reportCookiesSettled();
  await onDone();
}
