// G&D — chat persistence. Saves conversations + messages to the same Supabase
// tables the website uses, so a chat started on the phone shows up in web
// history and vice-versa. RLS scopes every row to the signed-in user.

import { supabase } from "./supabase";
import type { WebSource } from "./chat-client";

export type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: string | null;
  sources: WebSource[];
  created_at: string;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: string | null;
  source_refs: unknown;
  created_at: string;
};

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Sign in again to use chat history.");
  return id;
}

// Title from the first user message: first line, trimmed to a sane length.
export function deriveTitle(text: string): string {
  const t = text.trim().split("\n")[0].slice(0, 60).trim();
  return t || "New conversation";
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data as ConversationSummary[]) ?? [];
}

export async function createConversation(title: string): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function saveMessage(args: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  mode?: string | null;
  sources?: WebSource[];
}): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    user_id: userId,
    role: args.role,
    content: args.content,
    mode: args.mode ?? null,
    source_refs: args.sources && args.sources.length ? args.sources : null,
  });
  if (error) throw new Error(error.message);
}

// Bump updated_at so the conversation floats to the top of the recent list.
export async function touchConversation(id: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function loadConversationMessages(id: string): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, mode, source_refs, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as MessageRow[]) ?? []).map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    mode: r.mode,
    sources: Array.isArray(r.source_refs) ? (r.source_refs as WebSource[]) : [],
    created_at: r.created_at,
  }));
}

// Messages cascade-delete via the conversation's FK, so one delete is enough.
export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
