import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/auth-context";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

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
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    onError("Not authenticated");
    return;
  }

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
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
    const { done: streamDone, value } = await reader.read();
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
