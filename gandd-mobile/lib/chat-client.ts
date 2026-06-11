// G&D — chat streaming client for the native app.
//
// Talks to the same `chat` edge function the website uses (DeepSeek retrieval ->
// OpenAI styling, streamed as Server-Sent Events). React Native's built-in fetch
// cannot read a streaming body, so we use Expo's streaming fetch (`expo/fetch`),
// which exposes a standard ReadableStream we can read incrementally for the
// token-by-token effect.

import { fetch as expoFetch } from "expo/fetch";
import { supabase, SUPABASE_ANON_KEY_VALUE, SUPABASE_URL_VALUE } from "./supabase";
import type { Profile } from "./auth";

const CHAT_URL = `${SUPABASE_URL_VALUE}/functions/v1/chat`;
const CHAT_TIMEOUT_MS = 160_000;

export type ChatMode = "Simplified" | "Detailed" | "Storytelling" | "Visuals";
export type ChatTurn = { role: "user" | "assistant"; content: string };
export type WebSource = { title: string; url: string };

export type StreamChatHandlers = {
  messages: ChatTurn[];
  profile: Profile;
  mode: ChatMode;
  onDelta: (chunk: string) => void;
  onSources?: (sources: WebSource[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
};

function parseSseLine(line: string, handlers: Pick<StreamChatHandlers, "onDelta" | "onSources">) {
  let l = line;
  if (l.endsWith("\r")) l = l.slice(0, -1);
  if (!l || l.startsWith(":") || !l.startsWith("data: ")) return false;
  const json = l.slice(6).trim();
  if (json === "[DONE]") return true;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed.medai_sources)) {
      handlers.onSources?.(parsed.medai_sources as WebSource[]);
      return false;
    }
    const content = parsed.choices?.[0]?.delta?.content as string | undefined;
    if (content) handlers.onDelta(content);
  } catch {
    /* ignore malformed keep-alive fragments */
  }
  return false;
}

export async function streamChat({
  messages,
  profile,
  mode,
  onDelta,
  onSources,
  onDone,
  onError,
  signal,
}: StreamChatHandlers): Promise<void> {
  let token: string;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? "";
    if (!token) {
      onError("Please sign in again to use chat.");
      return;
    }
  } catch {
    onError("Please sign in again to use chat.");
    return;
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  try {
    const resp = await expoFetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY_VALUE,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        messages,
        profile,
        mode,
        // "smart" lets the function retrieve from the user's uploaded library
        // when it's relevant, and answer generally otherwise.
        documentMode: "smart",
      }),
    });

    if (!resp.ok) {
      let message = "The AI service couldn't start. Please try again.";
      try {
        const j = await resp.json();
        message = j.error ?? message;
      } catch {
        /* ignore */
      }
      onError(message);
      return;
    }

    const body = resp.body;
    if (!body) {
      // No streaming body available — fall back to a single buffered read.
      const text = await resp.text();
      for (const line of text.split("\n")) parseSseLine(line, { onDelta, onSources });
      onDone();
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedAny = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const isDone = parseSseLine(line, {
          onDelta: (c) => {
            receivedAny = true;
            onDelta(c);
          },
          onSources,
        });
        if (isDone) {
          onDone();
          return;
        }
      }
    }
    // Flush any trailing buffered line.
    if (buffer.trim()) parseSseLine(buffer, { onDelta, onSources });

    if (!receivedAny) {
      onError("The AI stream ended before any answer arrived. Please retry.");
      return;
    }
    onDone();
  } catch (err) {
    if (controller.signal.aborted) {
      // Treated as a cancel/timeout; surface a gentle message.
      onError("The AI took too long to respond. Please try again.");
    } else {
      onError(err instanceof Error ? err.message : "Couldn't reach the AI service.");
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
