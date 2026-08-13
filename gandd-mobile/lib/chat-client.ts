// G&D — chat streaming client for the native app.
//
// Talks to the same `chat` edge function the website uses (DeepSeek retrieval ->
// OpenAI styling, streamed as Server-Sent Events). React Native's built-in fetch
// cannot read a streaming body, so we use Expo's streaming fetch (`expo/fetch`),
// which exposes a standard ReadableStream we can read incrementally for the
// token-by-token effect.

import { fetch as expoFetch } from "expo/fetch";
import { supabase, SUPABASE_ANON_KEY_VALUE, SUPABASE_URL_VALUE } from "./supabase";
import { embedQuery } from "./embeddings";
import { db, termsFrom } from "./studybody-data";
import type { Profile } from "./auth";

const CHAT_URL = `${SUPABASE_URL_VALUE}/functions/v1/chat`;
const CHAT_TIMEOUT_MS = 160_000;

// Mirrors the website's ChatMode. "Detailed+" is the long, expensive answer
// (deep model tier plus a full set of notes) and is capped per day by the chat
// screen; "Visuals" is retired from the picker but stays in the union so an old
// persisted session that still names it keeps parsing.
export type ChatMode = "Simplified" | "Detailed" | "Detailed+" | "Storytelling" | "Visuals";
export type ChatTurn = { role: "user" | "assistant"; content: string };
// `image` is the source's og:image when the server found one — used to render a
// preview thumbnail, falling back to a favicon chip when absent.
export type WebSource = { title: string; url: string; image?: string };

// A grounded excerpt the chat function styles its answer from. The function does
// no retrieval itself — it answers from the documents the client passes here, so
// this is what makes mobile chat cite the user's actual material (web parity).
export type ChatDocument = {
  id: string;
  file_name: string;
  folder: string | null;
  excerpt: string;
};
export type DocumentMode = "none" | "smart" | "selected";

type ChunkRow = {
  document_id: string;
  file_name: string;
  folder: string | null;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
};

function chunkLabel(c: {
  page_start: number | null;
  page_end: number | null;
  chunk_index: number;
}): string {
  return c.page_start || c.page_end
    ? `[Page ${c.page_start ?? "?"}${c.page_end && c.page_end !== c.page_start ? `-${c.page_end}` : ""}]`
    : `[Chunk ${c.chunk_index + 1}]`;
}

// Greetings / thanks / one-word replies shouldn't trigger a library search — it
// just adds latency and risks dragging in irrelevant excerpts. Mirrors the web's
// looksCasualMessage guard.
const CASUAL =
  /^(hi|hey|hello|yo|sup|thanks|thank you|thx|ok|okay|cool|nice|great|got it|lol|yes|no|yep|nope|sure)\b/i;
export function looksCasualMessage(text: string): boolean {
  const t = text.trim();
  return t.length <= 3 || (t.length < 40 && CASUAL.test(t));
}

/**
 * Hybrid (embedding + keyword) retrieval over the user's document_chunks, grouped
 * per document into excerpts the chat function can ground on. Pass selected doc
 * ids to scope to attached files; pass [] to search the whole library. Fails soft
 * to [] so chat still answers (un-grounded) if retrieval is unavailable.
 */
export async function retrieveChatContext(
  query: string,
  selectedDocIds: string[],
  recentText = "",
): Promise<ChatDocument[]> {
  const manuallySelected = selectedDocIds.length > 0;
  try {
    const queryEmbedding = await embedQuery(query);
    const { data } = await db.rpc("search_document_chunks_hybrid", {
      query_terms: termsFrom(`${query} ${recentText}`),
      query_embedding: queryEmbedding,
      // null = whole library (RLS scopes it to this user); ids = attached files.
      match_document_ids: manuallySelected ? selectedDocIds : null,
      match_count: manuallySelected ? 30 : 24,
    });
    const chunks = (data as ChunkRow[]) ?? [];
    if (!chunks.length) return [];
    const grouped = new Map<string, ChatDocument>();
    for (const chunk of chunks) {
      const text = `${chunkLabel(chunk)}\n${chunk.content}`;
      const existing = grouped.get(chunk.document_id);
      if (existing) {
        existing.excerpt = `${existing.excerpt}\n\n${text}`.slice(0, 24000);
      } else {
        grouped.set(chunk.document_id, {
          id: chunk.document_id,
          file_name: chunk.file_name,
          folder: chunk.folder,
          excerpt: text,
        });
      }
    }
    return [...grouped.values()];
  } catch (err) {
    console.warn("chat retrieval failed; answering without grounding", err);
    return [];
  }
}

export type StreamChatHandlers = {
  messages: ChatTurn[];
  profile: Profile;
  mode: ChatMode;
  documents?: ChatDocument[];
  documentMode?: DocumentMode;
  // Force the backend down its web-search route (used by the term-lookup popover
  // so a tapped key term gets a fresh, web-grounded blurb).
  forceWebSearch?: boolean;
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
  documents = [],
  documentMode = "none",
  forceWebSearch = false,
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
        // The function grounds its answer on these client-retrieved excerpts.
        // "selected" = attached files, "smart" = whole-library match, "none" =
        // general answer (no excerpts found / casual message).
        documents,
        documentMode,
        forceWebSearch,
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
