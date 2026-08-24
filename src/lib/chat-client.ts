import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/auth-context";
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
  onDelta,
  onMeta,
  onSources,
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
  onDelta: (chunk: string) => void;
  onMeta?: (meta: { model: string; source: string }) => void;
  onSources?: (sources: WebSource[]) => void;
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
