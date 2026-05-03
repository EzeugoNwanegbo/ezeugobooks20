import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/auth-context";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const CHAT_START_TIMEOUT_MS = 45_000;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 45_000;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type DocumentCtx = {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
};

export type ChatMode = "Simplified" | "Detailed" | "Storytelling";
export type DocumentMode = "none" | "smart" | "selected";

export type WebSource = {
  title: string;
  url: string;
};

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("stream-idle-timeout"));
    }, CHAT_STREAM_IDLE_TIMEOUT_MS);

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
  onDone: () => void;
  onError: (err: string) => void;
  onCancel?: () => void;
  signal?: AbortSignal;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    onError("Not authenticated");
    return;
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  let startTimedOut = false;
  const timeout = window.setTimeout(() => {
    startTimedOut = true;
    controller.abort();
  }, CHAT_START_TIMEOUT_MS);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  let resp: Response;

  try {
    if (signal?.aborted) {
      onCancel?.();
      return;
    }
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
    } catch {
      /* ignore */
    }
    onError(msg);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await readWithTimeout(reader, signal);
    } catch (err) {
      await reader.cancel().catch(() => {});
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        onCancel?.();
        return;
      }
      onError("The AI stream paused for too long. Try again; if this repeats, check the Edge Function provider logs.");
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
        if (content) onDelta(content);
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
      if (json === "[DONE]") continue;
      try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed.medai_sources)) {
          onSources?.(parsed.medai_sources as WebSource[]);
          continue;
        }
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        /* ignore */
      }
    }
  }

  onDone();
}
