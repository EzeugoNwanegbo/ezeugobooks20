import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth, type Profile } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  streamChat,
  type ChatMessage,
  type ChatMode,
  type DocumentCtx,
  type WebSource,
} from "@/lib/chat-client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Send,
  BookOpen,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  BookText,
  FileText,
  Search,
  Square,
  X,
  ExternalLink,
  Sparkles,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

type ChatSearch = { c?: string };
type MessageSource = "library" | "general" | "interlink" | "visuals";

type DisplayMessage = ChatMessage & {
  source?: MessageSource;
  model?: string;
  webSources?: WebSource[];
};

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

type LibraryDocumentRow = {
  id: string;
  file_name: string;
  folders: { name: string | null } | null;
};

type LibraryDocumentTextRow = LibraryDocumentRow & {
  extracted_text: string | null;
};

type ChunkSearchRow = {
  chunk_index: number;
  content: string;
  document_id: string;
  file_name: string;
  folder: string | null;
  id: string;
  page_end: number | null;
  page_start: number | null;
  rank: number;
};

type ContextDocsResult = {
  docs: DocumentCtx[];
  noLibraryMatch: boolean;
  noMatchScope: "selected" | "library" | null;
};

type LibraryNotice = {
  mode: "selected" | "smart";
  names: string[];
} | null;

type PersistedChatSession = {
  version: 1;
  conversationId: string | null;
  input: string;
  interlink: boolean;
  libraryNotice: LibraryNotice;
  messages: DisplayMessage[];
  mode: ChatMode;
  selectedDocIds: string[];
  updatedAt: number;
  useLibrary: boolean;
  webSearch: boolean;
};

const SUGGESTIONS = [
  "Find exactly where this topic appears",
  "Answer using only my uploaded files",
  "Compare what my PDFs say about this",
  "Extract every relevant point with sources",
];

const VISUAL_SUGGESTIONS = [
  "Visualize how this process works",
  "Turn this topic into a simple animation",
  "Make an animated diagram from my files",
  "Create a visual explainer with scenes",
];

const CHAT_MODES = ["Simplified", "Detailed", "Storytelling", "Visuals"] as const;

const SMART_DOC_LIMIT = 5;
const SNIPPET_WINDOW_CHARS = 3200;
const MAX_SNIPPETS_PER_DOC = 5;
const CHUNK_SEARCH_TIMEOUT_MS = 12_000;
const FALLBACK_DOC_TEXT_TIMEOUT_MS = 12_000;
const CHAT_CANCELLED = "chat-cancelled";
const CHAT_SESSION_STORAGE_PREFIX = "gd-chat-session";
const CHAT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_SESSION_MAX_MESSAGE_CHARS = 300_000;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "can",
  "complete",
  "does",
  "from",
  "have",
  "into",
  "like",
  "that",
  "the",
  "this",
  "want",
  "what",
  "when",
  "where",
  "with",
  "would",
  "your",
]);

const GUEST_PROFILE: Profile = {
  id: "guest",
  name: "Student",
  university: null,
  year: null,
  course: null,
  curriculum: "Use broad course-level exam priorities as the reference frame.",
  exam_format: "MCQ",
  preferred_mode: "Simplified",
  weak_areas: null,
  recent_topics: null,
  onboarded: true,
};

function chatSessionStorageKey(ownerId: string) {
  return `${CHAT_SESSION_STORAGE_PREFIX}:${ownerId}`;
}

function compactMessagesForStorage(messages: DisplayMessage[]): DisplayMessage[] {
  let usedChars = 0;
  const compacted: DisplayMessage[] = [];

  for (const message of [...messages].reverse()) {
    const contentLength = message.content.length;
    if (compacted.length > 0 && usedChars + contentLength > CHAT_SESSION_MAX_MESSAGE_CHARS) {
      break;
    }

    if (contentLength > CHAT_SESSION_MAX_MESSAGE_CHARS) {
      compacted.unshift({
        ...message,
        content: message.content.slice(-CHAT_SESSION_MAX_MESSAGE_CHARS),
      });
      break;
    }

    compacted.unshift(message);
    usedChars += contentLength;
  }

  return compacted;
}

function readChatSession(ownerId: string): PersistedChatSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(chatSessionStorageKey(ownerId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedChatSession>;
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "number") return null;
    if (Date.now() - parsed.updatedAt > CHAT_SESSION_MAX_AGE_MS) return null;

    return {
      version: 1,
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      input: typeof parsed.input === "string" ? parsed.input : "",
      interlink: Boolean(parsed.interlink),
      libraryNotice: parsed.libraryNotice ?? null,
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (message): message is DisplayMessage =>
              message?.role === "user" || message?.role === "assistant",
          )
        : [],
      mode: normalizeChatMode(parsed.mode),
      selectedDocIds: Array.isArray(parsed.selectedDocIds)
        ? parsed.selectedDocIds.filter((id): id is string => typeof id === "string")
        : [],
      updatedAt: parsed.updatedAt,
      useLibrary: parsed.useLibrary ?? true,
      webSearch: Boolean(parsed.webSearch),
    };
  } catch (error) {
    console.warn("restore chat session", error);
    return null;
  }
}

function writeChatSession(ownerId: string, session: PersistedChatSession) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      chatSessionStorageKey(ownerId),
      JSON.stringify({
        ...session,
        messages: compactMessagesForStorage(session.messages),
        updatedAt: Date.now(),
      }),
    );
  } catch (error) {
    console.warn("save chat session", error);
  }
}

function queryTerms(text: string): string[] {
  const seen = new Set<string>();
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    })
    .slice(0, 24);
}

function docScore(doc: DocumentCtx, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = `${doc.file_name} ${doc.folder ?? ""}`.toLowerCase();
  const excerpt = doc.excerpt.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 8;
    const first = excerpt.indexOf(term);
    if (first !== -1) {
      score += 3;
      if (first < 20_000) score += 2;
    }
  }
  return score;
}

function pickSmartDocs(
  docs: DocumentCtx[],
  content: string,
  messages: DisplayMessage[],
): DocumentCtx[] {
  const recentChat = messages
    .slice(-6)
    .map((m) => m.content)
    .join(" ");
  const terms = queryTerms(`${content} ${recentChat}`);
  const ranked = docs
    .map((doc, index) => ({ doc, index, score: docScore(doc, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const matches = ranked.filter((item) => item.score > 0).slice(0, SMART_DOC_LIMIT);
  return (
    matches.length > 0 ? matches : ranked.slice(0, Math.min(SMART_DOC_LIMIT, ranked.length))
  ).map((item) => item.doc);
}

function relevantExcerpt(doc: DocumentCtx, content: string, messages: DisplayMessage[]): string {
  const text = doc.excerpt || "";
  if (text.length <= SNIPPET_WINDOW_CHARS * 2) return text;

  const recentChat = messages
    .slice(-4)
    .map((m) => m.content)
    .join(" ");
  const terms = queryTerms(`${content} ${recentChat}`);
  const lower = text.toLowerCase();
  const candidates: { start: number; end: number; score: number }[] = [];

  for (const term of terms) {
    let index = lower.indexOf(term);
    let seen = 0;
    while (index !== -1 && seen < 8) {
      const start = Math.max(0, index - Math.floor(SNIPPET_WINDOW_CHARS / 2));
      const end = Math.min(text.length, start + SNIPPET_WINDOW_CHARS);
      const window = lower.slice(start, end);
      const score = terms.reduce((total, t) => total + (window.includes(t) ? 1 : 0), 0);
      candidates.push({ start, end, score });
      index = lower.indexOf(term, index + term.length);
      seen += 1;
    }
  }

  if (candidates.length === 0) return text.slice(0, SNIPPET_WINDOW_CHARS * 2);

  const chosen: { start: number; end: number; score: number }[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const overlaps = chosen.some(
      (existing) => candidate.start < existing.end && candidate.end > existing.start,
    );
    if (!overlaps) chosen.push(candidate);
    if (chosen.length >= MAX_SNIPPETS_PER_DOC) break;
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .map((part, index) => {
      const label = `[Relevant excerpt ${index + 1} from ${doc.file_name}]`;
      return `${label}\n${text.slice(part.start, part.end)}`;
    })
    .join("\n\n---\n\n");
}

function docsFromChunkRows(rows: ChunkSearchRow[]): DocumentCtx[] {
  const groups = new Map<
    string,
    {
      id: string;
      file_name: string;
      folder: string | null;
      rows: ChunkSearchRow[];
    }
  >();

  for (const row of rows) {
    const existing = groups.get(row.document_id);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(row.document_id, {
        id: row.document_id,
        file_name: row.file_name,
        folder: row.folder,
        rows: [row],
      });
    }
  }

  return [...groups.values()].map((group) => ({
    id: group.id,
    file_name: group.file_name,
    folder: group.folder,
    excerpt: group.rows
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((row) => {
        const pageLabel =
          row.page_start && row.page_end
            ? row.page_start === row.page_end
              ? `Page ${row.page_start}`
              : `Pages ${row.page_start}-${row.page_end}`
            : `Chunk ${row.chunk_index + 1}`;
        return `[${pageLabel} | relevance ${row.rank}]\n${row.content}`;
      })
      .join("\n\n---\n\n"),
  }));
}

function webSourcesFromJson(value: unknown): WebSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url : "";
      if (!url) return null;
      return {
        title: typeof record.title === "string" ? record.title : "Web source",
        url,
      };
    })
    .filter((source): source is WebSource => Boolean(source));

  return sources.length > 0 ? sources : undefined;
}

function normalizeChatMode(value: unknown): ChatMode {
  return CHAT_MODES.includes(value as ChatMode) ? (value as ChatMode) : "Simplified";
}

function totalMessageContentLength(messages: DisplayMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function remoteMessagesArePrefixOfCached(
  remoteMessages: DisplayMessage[],
  cachedMessages: DisplayMessage[],
): boolean {
  if (remoteMessages.length > cachedMessages.length) return false;

  return remoteMessages.every((remoteMessage, index) => {
    const cachedMessage = cachedMessages[index];
    if (!cachedMessage || remoteMessage.role !== cachedMessage.role) return false;
    return cachedMessage.content.startsWith(remoteMessage.content);
  });
}

function mostCompleteMessages(
  remoteMessages: DisplayMessage[],
  cachedMessages?: DisplayMessage[],
): DisplayMessage[] {
  if (!cachedMessages?.length) return remoteMessages;
  if (!remoteMessages.length) return cachedMessages;
  if (!remoteMessagesArePrefixOfCached(remoteMessages, cachedMessages)) return remoteMessages;

  return totalMessageContentLength(cachedMessages) > totalMessageContentLength(remoteMessages)
    ? cachedMessages
    : remoteMessages;
}

function curriculumPreferenceFromMessage(content: string): string | null {
  const normalized = content.toLowerCase();

  if (
    /\b(no|dont|don't|do not)\b.{0,30}\b(curriculum|syllabus)\b/.test(normalized) ||
    /\b(curriculum|syllabus)\b.{0,30}\b(no|dont|don't|do not|not sure|unknown)\b/.test(
      normalized,
    ) ||
    /\b(use|check|search)\b.{0,18}\bweb\b.{0,30}\b(curriculum|syllabus)\b/.test(normalized) ||
    /\b(i|we)\s+(dont|don't|do not)\s+have\s+(one|it)\b/.test(normalized)
  ) {
    return "No curriculum provided - use web curriculum fallback";
  }

  const explicit = content.match(
    /\b(?:my|our|the)\s+(?:curriculum|syllabus)\s+(?:is|=|:)\s*([^.!?\n]{3,140})/i,
  );

  if (explicit?.[1]) return explicit[1].trim();

  return null;
}

function isWebCurriculumPreference(value?: string | null): boolean {
  if (!value) return false;
  return (
    /\b(no|dont|don't|do not)\b.{0,40}\b(curriculum|syllabus)\b/i.test(value) ||
    /\bweb\b.{0,30}\b(curriculum|syllabus)\b/i.test(value) ||
    /\b(curriculum|syllabus)\b.{0,30}\b(web|fallback|unknown|not sure)\b/i.test(value) ||
    /\b(i|we)\s+(dont|don't|do not)\s+have\s+(one|it)\b/i.test(value)
  );
}

function questionNeedsWebCurriculumGuidance(content: string): boolean {
  return /\b(curriculum|syllabus|study\s*plan|study\s*schedule|learning\s*objectives?|course\s*outline|exam\s*blueprint|key\s*topics?|high\s*yield|what\s+should\s+i\s+study|where\s+should\s+i\s+start)\b/i.test(
    content,
  );
}

function suppressWebCurriculumForSpeed(content: string): string {
  return isWebCurriculumPreference(content)
    ? "Course outline preference: broad exam priorities."
    : content;
}

function looksCasualMessage(content: string): boolean {
  return /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|cool|nice|good|alright)[.!?\s]*$/i.test(
    content.trim(),
  );
}

function explicitlyNeedsLibrary(content: string): boolean {
  return (
    /\b(materials?|pdf|file|document|doc|notes?|library|selected|uploaded|book|chapter|page|quote|complete|finish|continue|based on|according to)\b/i.test(
      content,
    ) ||
    /\b(from|in)\s+(my|the|this|selected|uploaded)\s+(materials?|pdf|file|document|doc|notes?|book|chapter|page)\b/i.test(
      content,
    )
  );
}

function studyMaterialMissMessage(scope: "selected" | "library"): string {
  const target = scope === "selected" ? "the selected file(s)" : "your library";
  return `I couldn't find an exact hit in ${target}. Try a more exact phrase, select the specific PDF/page, or ask me to answer from general knowledge.`;
}

export function ChatPage() {
  const { user, profile: savedProfile, refreshProfile } = useAuth();
  const profile = savedProfile ?? GUEST_PROFILE;
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/chat" }) as ChatSearch;
  const conversationId = search.c;
  const isGuest = !user;

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingConvo, setLoadingConvo] = useState(false);
  const [mode, setMode] = useState<ChatMode>(normalizeChatMode(profile.preferred_mode));
  const [useLibrary, setUseLibrary] = useState(() => Boolean(user));
  const [webSearch, setWebSearch] = useState(false);
  const [interlink, setInterlink] = useState(false);
  const [docs, setDocs] = useState<DocumentCtx[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [libraryNotice, setLibraryNotice] = useState<LibraryNotice>(null);
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const activeSendConversationRef = useRef<string | null>(null);
  const restoredOwnerRef = useRef<string | null>(null);
  const latestSessionRef = useRef<PersistedChatSession | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const previousPersistConversationRef = useRef<string | null>(conversationId ?? null);

  // Load library docs (with folder names)
  useEffect(() => {
    if (!user) {
      setDocsLoaded(false);
      return;
    }

    let active = true;
    setDocsLoaded(false);

    (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, folder_id, folders(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (!active) return;
      if (error) {
        console.warn("load library docs", error);
        toast.error("Couldn't load your study files");
        return;
      }

      setDocs(
        ((data as LibraryDocumentRow[] | null) ?? []).map((d) => ({
          id: d.id,
          file_name: d.file_name,
          folder: d.folders?.name ?? null,
          excerpt: "",
        })),
      );
      setDocsLoaded(true);
    })();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSessionReady(false);
      setUseLibrary(false);
      setDocs([]);
      setConvos([]);
    }
  }, [user]);

  useEffect(() => {
    if (!docsLoaded) return;
    setSelectedDocIds((current) => current.filter((id) => docs.some((doc) => doc.id === id)));
  }, [docs, docsLoaded]);

  const selectedDocs = useMemo(
    () => docs.filter((doc) => selectedDocIds.includes(doc.id)),
    [docs, selectedDocIds],
  );

  const filteredDocs = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((doc) => `${doc.file_name} ${doc.folder ?? ""}`.toLowerCase().includes(q));
  }, [docs, fileSearch]);

  useEffect(() => {
    if (!useLibrary) setLibraryNotice(null);
  }, [useLibrary]);

  useEffect(() => {
    if (!user) return;
    if (restoredOwnerRef.current === user.id) {
      setSessionReady(true);
      return;
    }

    const session = readChatSession(user.id);
    restoredOwnerRef.current = user.id;
    previousPersistConversationRef.current = conversationId ?? null;

    if (session) {
      latestSessionRef.current = session;
      setInput(session.input);
      setInterlink(session.interlink);
      setLibraryNotice(session.libraryNotice);
      setMode(session.mode);
      setSelectedDocIds(session.selectedDocIds);
      setUseLibrary(session.useLibrary);
      setWebSearch(session.webSearch);

      if (!conversationId || session.conversationId === conversationId) {
        setMessages(session.messages);
      }

      if (!conversationId && session.conversationId) {
        navigate({
          to: "/app/chat",
          search: { c: session.conversationId },
          replace: true,
        });
      }
    }

    setSessionReady(true);
  }, [conversationId, navigate, user]);

  useEffect(() => {
    if (!user || !sessionReady) return;

    const currentConversationId = conversationId ?? null;
    if (previousPersistConversationRef.current !== currentConversationId) {
      previousPersistConversationRef.current = currentConversationId;
      return;
    }

    const session: PersistedChatSession = {
      version: 1,
      conversationId: currentConversationId,
      input,
      interlink,
      libraryNotice,
      messages,
      mode,
      selectedDocIds,
      updatedAt: Date.now(),
      useLibrary,
      webSearch,
    };
    latestSessionRef.current = session;

    if (!persistTimerRef.current) {
      persistTimerRef.current = window.setTimeout(
        () => {
          if (latestSessionRef.current) writeChatSession(user.id, latestSessionRef.current);
          persistTimerRef.current = null;
        },
        streaming ? 500 : 80,
      );
    }
  }, [
    conversationId,
    input,
    interlink,
    libraryNotice,
    messages,
    mode,
    selectedDocIds,
    sessionReady,
    streaming,
    useLibrary,
    user,
    webSearch,
  ]);

  useEffect(() => {
    if (!user) return;

    const saveLatestSession = () => {
      if (latestSessionRef.current) writeChatSession(user.id, latestSessionRef.current);
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveLatestSession();
    };

    window.addEventListener("pagehide", saveLatestSession);
    document.addEventListener("visibilitychange", saveWhenHidden);

    return () => {
      saveLatestSession();
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      window.removeEventListener("pagehide", saveLatestSession);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [user]);

  const fetchDocumentExcerpts = async (
    ids: string[],
    content: string,
    signal?: AbortSignal,
  ): Promise<DocumentCtx[]> => {
    if (!user || ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    const timeout = window.setTimeout(() => controller.abort(), FALLBACK_DOC_TEXT_TIMEOUT_MS);
    signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      if (signal?.aborted) throw new Error(CHAT_CANCELLED);
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, extracted_text, folder_id, folders(name)")
        .eq("user_id", user.id)
        .in("id", uniqueIds)
        .abortSignal(controller.signal);

      if (error) {
        console.warn("fallback document text fetch failed", error);
        return [];
      }

      const byId = new Map<string, DocumentCtx>();
      for (const doc of (data as LibraryDocumentTextRow[] | null) ?? []) {
        if (!doc.extracted_text) continue;
        byId.set(doc.id, {
          id: doc.id,
          file_name: doc.file_name,
          folder: doc.folders?.name ?? null,
          excerpt: doc.extracted_text,
        });
      }

      return uniqueIds
        .map((id) => byId.get(id))
        .filter((doc): doc is DocumentCtx => doc !== undefined)
        .map((doc) => ({
          ...doc,
          excerpt: relevantExcerpt(doc, content, messages),
        }));
    } catch (err) {
      if (signal?.aborted) throw new Error(CHAT_CANCELLED);
      console.warn("fallback document text fetch unavailable", err);
      return [];
    } finally {
      signal?.removeEventListener("abort", abortFromCaller);
      window.clearTimeout(timeout);
    }
  };

  // Load conversation list
  const refreshConvos = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    setConvos((data as ConversationRow[]) ?? []);
  };
  useEffect(() => {
    refreshConvos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Load active conversation messages
  useEffect(() => {
    if (!user) return;
    if (!conversationId) {
      if (sessionReady && !latestSessionRef.current?.messages.length) setMessages([]);
      return;
    }
    if (activeSendConversationRef.current === conversationId) return;
    let active = true;
    (async () => {
      setLoadingConvo(true);
      const { data, error } = await supabase
        .from("messages")
        .select("role, content, source_type, model_used, source_refs")
        .eq("conversation_id", conversationId)
        .order("created_at");
      if (!active) return;
      setLoadingConvo(false);
      if (error) {
        toast.error("Couldn't load that chat");
        return;
      }
      const remoteMessages = (data ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        source: (m.source_type as MessageSource | null) ?? undefined,
        model: m.model_used ?? undefined,
        webSources: webSourcesFromJson(m.source_refs),
      }));
      const cachedMessages =
        latestSessionRef.current?.conversationId === conversationId
          ? latestSessionRef.current.messages
          : undefined;

      setMessages(mostCompleteMessages(remoteMessages, cachedMessages));
    })();
    return () => {
      active = false;
    };
  }, [conversationId, sessionReady, user]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  useEffect(() => {
    return () => chatAbortRef.current?.abort();
  }, []);

  const cancelResponse = () => {
    const controller = chatAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
  };

  const ensureConversation = async (firstUserContent: string): Promise<string | null> => {
    if (!user) return "guest";
    if (conversationId) return conversationId;
    const title = firstUserContent.slice(0, 60).trim() || "New conversation";
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    activeSendConversationRef.current = data.id;
    navigate({
      to: "/app/chat",
      search: { c: data.id },
      replace: true,
    });
    refreshConvos();
    return data.id;
  };

  const buildContextDocs = async (
    content: string,
    manuallySelected: boolean,
    signal?: AbortSignal,
  ): Promise<ContextDocsResult> => {
    if (!useLibrary || docs.length === 0) {
      return { docs: [], noLibraryMatch: false, noMatchScope: null };
    }

    if (!manuallySelected && looksCasualMessage(content)) {
      return { docs: [], noLibraryMatch: false, noMatchScope: null };
    }

    const documentIds = manuallySelected ? selectedDocs.map((doc) => doc.id) : null;
    const recentChat = messages
      .slice(-6)
      .map((m) => m.content)
      .join(" ");
    const terms = queryTerms(`${content} ${recentChat}`);

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    const timeout = window.setTimeout(() => controller.abort(), CHUNK_SEARCH_TIMEOUT_MS);
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      if (signal?.aborted) throw new Error(CHAT_CANCELLED);
      const { data, error } = await supabase
        .rpc("search_document_chunks", {
          query_terms: terms,
          match_document_ids: documentIds,
          match_count: manuallySelected ? 24 : 12,
        })
        .abortSignal(controller.signal);

      if (error) {
        console.warn("chunk search failed; falling back to document preview", error);
      } else if (data && data.length > 0) {
        return {
          docs: docsFromChunkRows(data as ChunkSearchRow[]),
          noLibraryMatch: false,
          noMatchScope: null,
        };
      } else if (
        !looksCasualMessage(content) &&
        (explicitlyNeedsLibrary(content) || manuallySelected)
      ) {
        return {
          docs: [],
          noLibraryMatch: true,
          noMatchScope: manuallySelected ? "selected" : "library",
        };
      }
    } catch (err) {
      if (signal?.aborted) throw new Error(CHAT_CANCELLED);
      console.warn("chunk search unavailable; falling back to document preview", err);
    } finally {
      signal?.removeEventListener("abort", abortFromCaller);
      window.clearTimeout(timeout);
    }

    const fallbackDocs = manuallySelected ? selectedDocs : pickSmartDocs(docs, content, messages);
    const fallbackWithText = await fetchDocumentExcerpts(
      fallbackDocs.map((doc) => doc.id),
      content,
      signal,
    );

    return {
      docs: fallbackWithText,
      noLibraryMatch: false,
      noMatchScope: null,
    };
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    const requestStartedAt = performance.now();
    const logTiming = (label: string, extra: Record<string, unknown> = {}) => {
      console.info(`[G&D timing] ${label}`, {
        ms: Math.round(performance.now() - requestStartedAt),
        ...extra,
      });
    };
    setInput("");

    const curriculumPreference = curriculumPreferenceFromMessage(content);
    const shouldFetchWebCurriculum =
      questionNeedsWebCurriculumGuidance(content) ||
      isWebCurriculumPreference(curriculumPreference);
    const profileForRequest = {
      ...profile,
      curriculum: curriculumPreference ?? profile.curriculum,
    };

    if (!shouldFetchWebCurriculum && isWebCurriculumPreference(profileForRequest.curriculum)) {
      profileForRequest.curriculum =
        "Use broad course-level exam priorities as the reference frame.";
    }

    if (user && savedProfile && curriculumPreference) {
      supabase
        .from("user_profiles")
        .update({ curriculum: curriculumPreference })
        .eq("id", savedProfile.id)
        .then(async ({ error }) => {
          if (error) console.warn("save curriculum preference", error);
          else await refreshProfile();
        });
    }

    const next: DisplayMessage[] = [...messages, { role: "user", content }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);
    const requestController = new AbortController();
    chatAbortRef.current = requestController;

    const cid = await ensureConversation(content);
    if (!cid || requestController.signal.aborted) {
      if (requestController.signal.aborted) logTiming("response cancelled");
      setMessages(next);
      setStreaming(false);
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      return;
    }
    activeSendConversationRef.current = cid;
    logTiming("conversation ready", { conversationId: cid });

    const requestMessages = shouldFetchWebCurriculum
      ? next
      : next.map((message) => ({
          ...message,
          content: suppressWebCurriculumForSpeed(message.content),
        }));

    const manuallySelected = selectedDocs.length > 0;
    let contextResult: ContextDocsResult;
    try {
      contextResult = webSearch
        ? { docs: [], noLibraryMatch: false, noMatchScope: null }
        : await buildContextDocs(content, manuallySelected, requestController.signal);
    } catch (err) {
      if (requestController.signal.aborted || (err as Error).message === CHAT_CANCELLED) {
        logTiming("response cancelled");
      } else {
        console.error("prepare library context", err);
        toast.error("Couldn't prepare your library context");
      }
      setMessages((prev) => prev.slice(0, -1));
      setStreaming(false);
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      return;
    }

    if (requestController.signal.aborted) {
      logTiming("response cancelled");
      setMessages((prev) => prev.slice(0, -1));
      setStreaming(false);
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      return;
    }

    const documentsForRequest = contextResult.docs;
    logTiming("library context ready", {
      docs: documentsForRequest.length,
      manuallySelected,
      noLibraryMatch: contextResult.noLibraryMatch,
    });
    const pendingLibraryNotice =
      documentsForRequest.length > 0
        ? {
            mode: manuallySelected ? ("selected" as const) : ("smart" as const),
            names: documentsForRequest.map((doc) => doc.file_name),
          }
        : null;

    setLibraryNotice(null);

    if (user) {
      supabase
        .from("messages")
        .insert({
          conversation_id: cid,
          user_id: user.id,
          role: "user",
          content,
          mode,
        })
        .then(({ error }) => {
          if (error) console.error("save user msg", error);
        });
    }

    if (contextResult.noLibraryMatch && contextResult.noMatchScope) {
      const noMatchText = studyMaterialMissMessage(contextResult.noMatchScope);
      setMessages([
        ...next,
        {
          role: "assistant",
          content: noMatchText,
          source: "library",
          model: "library-search",
        },
      ]);
      setStreaming(false);
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      if (user) {
        supabase
          .from("messages")
          .insert({
            conversation_id: cid,
            user_id: user.id,
            role: "assistant",
            content: noMatchText,
            model_used: "library-search",
            source_type: "library",
            mode,
          })
          .then(({ error }) => {
            if (error) console.error("save assistant miss", error);
          });
        supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", cid)
          .then(({ error }) => {
            if (error) console.error("update conversation after miss", error);
            else refreshConvos();
          });
      }
      return;
    }

    let assistant = "";
    let visibleAssistant = "";
    let metaSource: MessageSource = "general";
    let metaModel = "";
    let webSources: WebSource[] = [];
    let firstDeltaSeen = false;
    let cancelled = false;
    let revealTimer: number | null = null;

    const setAssistantMessage = (contentToShow: string) => {
      setMessages((prev) => {
        const copy = [...prev];
        const assistantMessage: DisplayMessage = {
          role: "assistant",
          content: contentToShow,
          source: metaSource,
          model: metaModel,
          webSources,
        };
        if (copy.length === 0 || copy[copy.length - 1]?.role !== "assistant") {
          copy.push(assistantMessage);
        } else {
          copy[copy.length - 1] = assistantMessage;
        }
        return copy;
      });
    };

    const stopReveal = () => {
      if (!revealTimer) return;
      window.clearInterval(revealTimer);
      revealTimer = null;
    };

    const startReveal = () => {
      if (revealTimer) return;
      revealTimer = window.setInterval(() => {
        const remaining = assistant.length - visibleAssistant.length;

        if (remaining > 0) {
          const step = remaining > 500 ? 30 : remaining > 180 ? 18 : remaining > 70 ? 10 : 6;
          visibleAssistant = assistant.slice(0, visibleAssistant.length + step);
          setAssistantMessage(visibleAssistant);
          return;
        }

        stopReveal();
      }, 12);
    };

    const finishCancelled = () => {
      if (cancelled) return;
      cancelled = true;
      stopReveal();
      logTiming("response cancelled", { chars: assistant.length });
      if (assistant) {
        setAssistantMessage(visibleAssistant || assistant);
      } else {
        setMessages((prev) => prev.slice(0, -1));
      }
    };

    try {
      logTiming("ai request starting", {
        webSearch,
        documentMode:
          documentsForRequest.length === 0 ? "none" : manuallySelected ? "selected" : "smart",
      });
      await streamChat({
        messages: requestMessages,
        profile: profileForRequest,
        mode,
        documents: documentsForRequest.length > 0 ? documentsForRequest : undefined,
        documentMode:
          documentsForRequest.length === 0 ? "none" : manuallySelected ? "selected" : "smart",
        forceWebSearch: webSearch,
        interlink: interlink && documentsForRequest.length > 0,
        signal: requestController.signal,
        onMeta: (m) => {
          metaModel = m.model;
          metaSource = (m.source as MessageSource) || "general";
          logTiming("ai response headers", m);
          if (pendingLibraryNotice && metaSource !== "general") {
            setLibraryNotice(pendingLibraryNotice);
            if (pendingLibraryNotice.mode === "smart") {
              toast("Pinpoint search picked files", {
                description: pendingLibraryNotice.names.slice(0, 2).join(", "),
              });
            }
          } else {
            setLibraryNotice(null);
          }
        },
        onDelta: (chunk) => {
          if (!firstDeltaSeen) {
            firstDeltaSeen = true;
            logTiming("first ai token", { model: metaModel, source: metaSource });
          }
          assistant += chunk;
          startReveal();
        },
        onSources: (sources) => {
          webSources = sources;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = {
              ...last,
              webSources,
            };
            return copy;
          });
        },
        onError: (err) => {
          logTiming("ai error", { error: err });
          stopReveal();
          toast.error(err);
          setMessages((prev) => prev.slice(0, -1));
        },
        onCancel: finishCancelled,
        onDone: async () => {
          if (cancelled || requestController.signal.aborted) return;
          stopReveal();
          visibleAssistant = assistant;
          setAssistantMessage(assistant);
          logTiming("ai stream done", { chars: assistant.length });
          if (assistant && user) {
            await supabase.from("messages").insert({
              conversation_id: cid,
              user_id: user.id,
              role: "assistant",
              content: assistant,
              model_used: metaModel || null,
              source_type: metaSource,
              source_refs: webSources.length > 0 ? webSources : null,
              mode,
            });
            await supabase
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", cid);
            refreshConvos();
          }
          if (user && savedProfile && content.length < 300) {
            const recent = [content, ...(savedProfile.recent_topics || [])].slice(0, 20);
            supabase
              .from("user_profiles")
              .update({ recent_topics: recent })
              .eq("id", savedProfile.id)
              .then();
          }
        },
      });
    } finally {
      stopReveal();
      setStreaming(false);
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      if (activeSendConversationRef.current === cid) activeSendConversationRef.current = null;
    }
  };

  const newChat = () => {
    chatAbortRef.current?.abort();
    activeSendConversationRef.current = null;
    const emptySession: PersistedChatSession = {
      version: 1,
      conversationId: null,
      input: "",
      interlink,
      libraryNotice: null,
      messages: [],
      mode,
      selectedDocIds,
      updatedAt: Date.now(),
      useLibrary,
      webSearch,
    };
    latestSessionRef.current = emptySession;
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (user) writeChatSession(user.id, emptySession);
    navigate({ to: "/app/chat", search: {} });
    setInput("");
    setLibraryNotice(null);
    setMessages([]);
  };

  const deleteConversation = async (id: string) => {
    if (!user) return;
    if (!confirm("Delete this chat?")) return;
    // Delete messages first (no FK cascade in schema)
    await supabase.from("messages").delete().eq("conversation_id", id);
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (id === conversationId) {
      newChat();
    }
    refreshConvos();
  };

  const groupedConvos = useMemo(() => {
    const today: ConversationRow[] = [];
    const week: ConversationRow[] = [];
    const older: ConversationRow[] = [];
    const now = Date.now();
    for (const c of convos) {
      const t = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      const ageDays = (now - t) / (1000 * 60 * 60 * 24);
      if (ageDays < 1) today.push(c);
      else if (ageDays < 7) week.push(c);
      else older.push(c);
    }
    return { today, week, older };
  }, [convos]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background/50 min-w-0">
      {/* Conversations sidebar */}
      <aside className={`hidden xl:flex min-h-0 flex-col border-r border-border bg-background/55 backdrop-blur transition-[width] duration-300 ${sidebarOpen ? "w-64" : "w-16"}`}>
        <div className={`p-3 border-b border-border flex justify-center ${sidebarOpen ? "" : "px-2"}`}>
          <button
            onClick={newChat}
            className={`flex items-center gap-2 rounded-lg bg-gradient-primary text-primary-foreground font-medium shadow-glow hover:opacity-95 transition-all ${
              sidebarOpen ? "w-full px-3 py-2 text-sm" : "h-10 w-10 justify-center p-0"
            }`}
            title="New chat"
          >
            <Plus className="h-4 w-4" />
            {sidebarOpen && <span>New chat</span>}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-4 overflow-x-hidden">
          {convos.length === 0 ? (
            sidebarOpen && (
              <div className="text-xs text-muted-foreground px-3 py-6 text-center">
                {isGuest ? "Guest chats are not saved." : "Your past chats will appear here."}
              </div>
            )
          ) : (
            <>
              <ConvoGroup
                title={sidebarOpen ? "Today" : ""}
                items={groupedConvos.today}
                activeId={conversationId}
                collapsed={!sidebarOpen}
                onPick={(id) => navigate({ to: "/app/chat", search: { c: id } })}
                onDelete={deleteConversation}
              />
              <ConvoGroup
                title={sidebarOpen ? "Last 7 days" : ""}
                items={groupedConvos.week}
                activeId={conversationId}
                collapsed={!sidebarOpen}
                onPick={(id) => navigate({ to: "/app/chat", search: { c: id } })}
                onDelete={deleteConversation}
              />
              <ConvoGroup
                title={sidebarOpen ? "Older" : ""}
                items={groupedConvos.older}
                activeId={conversationId}
                collapsed={!sidebarOpen}
                onPick={(id) => navigate({ to: "/app/chat", search: { c: id } })}
                onDelete={deleteConversation}
              />
            </>
          )}
        </div>
      </aside>

      {/* Main column */}
      <div className="relative flex min-h-0 flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="shrink-0 border-b border-border bg-background/70 px-3 py-2 backdrop-blur sm:px-4 sm:py-2.5 lg:px-6 lg:py-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setSidebarOpen((v) => !v)}
                  className="hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground xl:inline-flex"
                  title={sidebarOpen ? "Hide chats" : "Show chats"}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </button>
                <h1 className="truncate font-display text-lg font-light sm:text-xl">
                  {conversationId
                    ? convos.find((c) => c.id === conversationId)?.title || "Chat"
                    : "New chat"}
                </h1>
                {docs.length > 0 && useLibrary && selectedDocs.length > 0 && (
                  <span
                    className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 ml-2"
                    title={`${selectedDocs.length} study file${selectedDocs.length === 1 ? "" : "s"}`}
                  >
                    <BookOpen className="h-3 w-3" />
                    {selectedDocs.length}
                  </span>
                )}
              </div>
              <button
                onClick={newChat}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:border-primary/40 xl:hidden"
                title="New chat"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
            <div className="chat-header-controls -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] xl:mx-0 xl:gap-2 xl:overflow-visible xl:px-0 xl:pb-0 [&::-webkit-scrollbar]:hidden">
                <>
                  <button
                    onClick={() => setUseLibrary((v) => !v)}
                    title="Toggle file search"
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      useLibrary
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:bg-surface-elevated"
                    }`}
                  >
                    Files {useLibrary ? "on" : "off"}
                  </button>
                  {docs.length > 0 && (
                    <button
                      onClick={() => setInterlink((v) => !v)}
                      disabled={!useLibrary}
                      title="Find connections across subjects/folders"
                      className={`hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 sm:inline-flex ${
                        interlink
                          ? "border-accent/50 bg-accent/15 text-accent"
                          : "border-border text-muted-foreground hover:bg-surface-elevated"
                      }`}
                    >
                      <Network className="h-3.5 w-3.5" />
                      Find connections
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (docs.length === 0) {
                        toast("Your library is empty", {
                          description: "Upload your PDFs or notes to the Library first to study them here.",
                          action: {
                            label: "Go to Library",
                            onClick: () => navigate({ to: "/app/library" }),
                          },
                        });
                        return;
                      }
                      setFilePickerOpen(true);
                    }}
                    disabled={!useLibrary}
                    title="Choose files to search"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground disabled:opacity-40"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Files
                  </button>
                </>
              <div className="chat-mode-selector flex shrink-0 rounded-lg border border-border bg-background p-0.5">
                {CHAT_MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    title={
                      m === "Visuals"
                        ? "Create an animated visual explanation"
                        : m === "Storytelling"
                          ? "Explain as a story"
                          : m === "Detailed"
                            ? "Concepts + deeper detail"
                            : "Plain English with an analogy"
                    }
                    className={`flex min-h-8 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:px-2.5 ${
                      mode === m
                        ? "bg-gradient-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "Storytelling" && <BookText className="h-3 w-3" />}
                    {m === "Visuals" && <Sparkles className="h-3 w-3" />}
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-3 pb-44 pt-5 sm:px-4 sm:pb-40 md:px-8 md:pt-8 lg:pb-36">
            {loadingConvo && messages.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState
                name={profile.name || "there"}
                onPick={(s) => send(s)}
                hasDocs={docs.length > 0 && useLibrary}
                mode={mode}
              />
            ) : (
              <div className="space-y-6">
                {messages.map((m, i) => (
                  <Message
                    key={i}
                    msg={m}
                    isLast={i === messages.length - 1}
                    streaming={streaming && i === messages.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 px-3 pb-2 pt-6 sm:px-4 md:px-8 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto max-w-3xl mx-auto">
            {mode === "Visuals" && (
              <div className="mb-2 rounded-2xl border border-border bg-background/65 px-2.5 py-2 backdrop-blur-[2px] sm:rounded-[28px] sm:px-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    Visuals
                  </span>
                  <span className="min-w-0 flex-1">
                    Add a file for exact details, turn Web on for current topics, or send now for an
                    AI-guided animation.
                  </span>
                  {docs.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setUseLibrary(true);
                        setFilePickerOpen(true);
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-medium text-primary hover:bg-primary/15"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Choose file
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate({ to: "/app/library" })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-medium text-primary hover:bg-primary/15"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Upload file
                    </button>
                  )}
                </div>
              </div>
            )}
            {useLibrary && (
              <div className="mb-2 rounded-2xl border border-border bg-background/60 px-2.5 py-1.5 backdrop-blur-[2px] sm:rounded-[28px] sm:px-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFilePickerOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 sm:px-3"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Add files
                  </button>

                  {selectedDocs.length > 0 ? (
                    selectedDocs.slice(0, 3).map((doc) => (
                      <span
                        key={doc.id}
                        title={doc.file_name}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface/80 px-2 py-1 text-xs text-foreground sm:max-w-[360px]"
                      >
                        <span className="truncate">{doc.file_name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedDocIds((ids) => ids.filter((id) => id !== doc.id))
                          }
                          className="rounded-full text-muted-foreground hover:text-foreground"
                          title="Remove file"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  ) : docs.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Your library is empty.
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Pinpoint search will choose the strongest file matches.
                    </span>
                  )}

                  {selectedDocs.length > 3 && (
                    <span className="text-xs text-muted-foreground">
                      +{selectedDocs.length - 3} more
                    </span>
                  )}

                  {selectedDocs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDocIds([])}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {libraryNotice && (
                  <p className="mt-2 flex max-w-full items-center gap-1.5 overflow-hidden text-[11px] text-primary-glow">
                    <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {libraryNotice.mode === "smart" ? "Pinpoint search: " : "Using: "}
                      {libraryNotice.names.slice(0, 2).join(", ")}
                      {libraryNotice.names.length > 2
                        ? ` +${libraryNotice.names.length - 2} more`
                        : ""}
                    </span>
                  </p>
                )}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-1.5 sm:gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={
                  mode === "Visuals"
                    ? "Describe what to visualize or animate..."
                    : webSearch
                      ? "Ask with web search..."
                      : docs.length > 0 && useLibrary
                        ? "Ask for the exact answer, page, or passage..."
                        : "Ask a question or upload files to search precisely..."
                }
                className="min-h-[44px] max-h-[180px] flex-1 resize-none rounded-2xl border border-input bg-background/70 px-4 py-2.5 text-sm backdrop-blur-[2px] focus:outline-none focus:ring-2 focus:ring-ring sm:rounded-[28px] sm:px-5"
                style={{ height: "auto" }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 200) + "px";
                }}
              />
              <button
                type="button"
                onClick={() => setWebSearch((v) => !v)}
                title={webSearch ? "Web search on" : "Use web search"}
                aria-pressed={webSearch}
                aria-label={webSearch ? "Turn web search off" : "Turn web search on"}
                className={`inline-flex h-[44px] shrink-0 items-center justify-center gap-2 rounded-full border px-3 text-xs font-medium backdrop-blur-[2px] transition-colors sm:px-3.5 ${
                  webSearch
                    ? "border-primary bg-primary text-primary-foreground shadow-glow ring-2 ring-primary/25"
                    : "border-input bg-background/35 text-muted-foreground hover:border-primary/35 hover:bg-surface-elevated hover:text-foreground"
                }`}
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">{webSearch ? "Web on" : "Web"}</span>
              </button>
              {streaming ? (
                <button
                  type="button"
                  onClick={cancelResponse}
                  title="Cancel response"
                  aria-label="Cancel response"
                  className="h-[44px] w-[44px] flex items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive backdrop-blur-[2px] transition-colors hover:bg-destructive/15"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="h-[44px] w-[44px] flex items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow disabled:opacity-40 transition-opacity"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </form>
            <p className="mt-1.5 text-[11px] text-muted-foreground text-center">
              G&D can be wrong. Always verify important work with your teacher, lecturer, or source
              material.
            </p>
          </div>
        </div>
      </div>
      <FilePickerDialog
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        docs={filteredDocs}
        totalDocs={docs.length}
        selectedDocIds={selectedDocIds}
        fileSearch={fileSearch}
        onSearch={setFileSearch}
        onToggle={(docId) =>
          setSelectedDocIds((ids) =>
            ids.includes(docId) ? ids.filter((id) => id !== docId) : [...ids, docId],
          )
        }
        onClear={() => setSelectedDocIds([])}
      />
    </div>
  );
}

function FilePickerDialog({
  open,
  onOpenChange,
  docs,
  totalDocs,
  selectedDocIds,
  fileSearch,
  onSearch,
  onToggle,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docs: DocumentCtx[];
  totalDocs: number;
  selectedDocIds: string[];
  fileSearch: string;
  onSearch: (value: string) => void;
  onToggle: (docId: string) => void;
  onClear: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="luxury-panel flex max-h-[88dvh] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg p-0 sm:max-h-[85vh] sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-5 pb-3 pt-5">
          <DialogTitle>Choose files to search</DialogTitle>
          <DialogDescription>
            Pick the PDFs or notes for this question. Leave this empty to let pinpoint search
            choose.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col space-y-3 px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={fileSearch}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search files..."
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              {selectedDocIds.length > 0 ? selectedDocIds.length : "Pinpoint search"}
            </span>
            {selectedDocIds.length > 0 && (
              <button type="button" onClick={onClear} className="hover:text-foreground">
                Clear selection
              </button>
            )}
          </div>

          <div className="min-h-[220px] flex-1 overflow-y-auto rounded-lg border border-border bg-surface/40">
            {docs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {totalDocs === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3">
                    <p>You haven't added any files to your library yet.</p>
                    <Link
                      to="/app/library"
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground font-medium transition-opacity hover:opacity-90"
                    >
                      Go to Library to add files
                    </Link>
                  </div>
                ) : (
                  "No files match your search."
                )}
              </div>
            ) : (
              docs.map((doc) => {
                const checked = selectedDocIds.includes(doc.id);
                return (
                  <div
                    key={doc.id}
                    onClick={() => onToggle(doc.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onToggle(doc.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={doc.file_name}
                    className={`flex w-full items-center gap-3 border-b border-border/70 px-4 py-3 text-left transition-colors last:border-b-0 ${
                      checked ? "bg-primary/10" : "hover:bg-surface-elevated"
                    }`}
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">{doc.file_name}</span>
                      <span className="block break-words text-xs text-muted-foreground">
                        {doc.folder || "Unfoldered"}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-lg bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow sm:w-auto"
          >
            {selectedDocIds.length > 0 ? "OK, search selected files" : "OK, use pinpoint search"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvoGroup({
  title,
  items,
  activeId,
  collapsed,
  onPick,
  onDelete,
}: {
  title: string;
  items: ConversationRow[];
  activeId?: string;
  collapsed?: boolean;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      {title && !collapsed && (
        <div className="px-3 pb-1 text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
          {title}
        </div>
      )}
      <ul className="space-y-0.5">
        {items.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <div
                className={`group flex items-center rounded-lg cursor-pointer transition-colors ${
                  collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-2"
                } ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-foreground/80 hover:bg-surface-elevated hover:text-foreground"
                }`}
                onClick={() => onPick(c.id)}
                title={collapsed ? c.title || "New conversation" : undefined}
              >
                <MessageSquare
                  className={`h-3.5 w-3.5 flex-shrink-0 ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                />
                {!collapsed && (
                  <>
                    <span className="text-sm truncate flex-1">{c.title || "New conversation"}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-opacity"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState({
  name,
  onPick,
  hasDocs,
  mode,
}: {
  name: string;
  onPick: (s: string) => void;
  hasDocs: boolean;
  mode: ChatMode;
}) {
  const suggestions = mode === "Visuals" ? VISUAL_SUGGESTIONS : SUGGESTIONS;

  return (
    <div className="py-8 text-center sm:py-12">
      <AiMark size="lg" className="mb-5" />
      <h2 className="font-display text-4xl font-light leading-none sm:text-5xl">Ready, {name}</h2>
      <p className="text-muted-foreground mt-1 text-balance max-w-md mx-auto">
        {mode === "Visuals"
          ? "Describe a topic, choose a file, or turn on Web to build an animated visual explanation."
          : hasDocs
            ? "Ask for the exact detail. I will search your files first, show the source, then explain."
            : "Upload files in Library, then ask for the exact answer, page, passage, or comparison you need."}
      </p>
      <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:mt-8 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="luxury-panel rounded-lg p-3 text-left text-sm transition-colors hover:border-primary/25 hover:bg-surface"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function AiMark({
  size = "sm",
  className = "",
  active = false,
}: {
  size?: "sm" | "lg";
  className?: string;
  active?: boolean;
}) {
  const outerSize = size === "lg" ? "h-16 w-16" : "h-10 w-10";
  const dotSize = size === "lg" ? "h-2.5 w-2.5" : "h-2 w-2";

  return (
    <span
      aria-hidden="true"
      className={`${outerSize} ${className} ai-symbiote-mark ${
        active ? "is-active" : ""
      } inline-flex flex-shrink-0 items-center justify-center`}
    >
      <span className={`${dotSize} ai-symbiote-dot`} />
    </span>
  );
}

function SourceBadge({ source }: { source?: MessageSource }) {
  if (source === "visuals") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
        <Sparkles className="h-2.5 w-2.5" />
        Visuals
      </span>
    );
  }
  if (source === "interlink") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
        <Network className="h-2.5 w-2.5" />
        Interlinked
      </span>
    );
  }
  if (source === "library") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
        <BookOpen className="h-2.5 w-2.5" />
        From your files
      </span>
    );
  }
  return null;
}

function WebSourceIcons({ sources }: { sources?: WebSource[] }) {
  if (!sources?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {sources.slice(0, 6).map((source, index) => (
        <a
          key={`${source.url}-${index}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={source.title || source.url}
          aria-label={`Open web source ${index + 1}: ${source.title || source.url}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/45 text-muted-foreground backdrop-blur-[2px] transition-colors hover:border-primary/35 hover:text-primary"
        >
          <span className="text-[11px] font-semibold leading-none">{index + 1}</span>
        </a>
      ))}
    </div>
  );
}

function WebSourceBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
      <ExternalLink className="h-2.5 w-2.5" />
      Web sources · {count}
    </span>
  );
}

function isLikelyHtmlAnimation(value: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]|<style[\s>]|<canvas[\s>]|<svg[\s>]/i.test(value);
}

function splitVisualMessage(content: string): { html: string | null; markdown: string } {
  let html: string | null = null;
  const markdown = content
    .replace(/```(?:html)?[ \t]*\n([\s\S]*?)```/gi, (block, candidate: string) => {
      const trimmed = candidate.trim();
      if (!isLikelyHtmlAnimation(trimmed)) return block;
      html ??= trimmed;
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!html && isLikelyHtmlAnimation(content)) {
    return { html: content.trim(), markdown: "" };
  }

  return { html, markdown };
}

const VISUAL_PREVIEW_BASE_STYLE = `<style id="gd-visual-base-style">
  :root { color-scheme: light; }
  html, body { min-width: 100%; min-height: 100%; background: #ffffff; }
  canvas, svg { max-width: 100%; }
</style>`;

const VISUAL_PREVIEW_CONTROLLER = `<script>
(() => {
  const nativeRaf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(() => callback(Date.now()), 16);
  const nativeCancelRaf = window.cancelAnimationFrame
    ? window.cancelAnimationFrame.bind(window)
    : window.clearTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  let paused = false;
  let rafId = 0;
  const pendingRafs = new Map();

  function runCallback(callback, args) {
    if (typeof callback === "function") {
      callback(...args);
      return;
    }

    if (typeof callback === "string") {
      try {
        new Function(callback)();
      } catch (err) {
        reportVisualError(err);
      }
    }
  }

  window.requestAnimationFrame = (callback) => {
    const id = ++rafId;
    pendingRafs.set(id, callback);
    nativeRaf((time) => {
      const saved = pendingRafs.get(id);
      if (!saved) return;
      if (paused) return;
      pendingRafs.delete(id);
      saved(time);
    });
    return id;
  };

  window.cancelAnimationFrame = (id) => {
    pendingRafs.delete(id);
    try { nativeCancelRaf(id); } catch (_) {}
  };

  window.setInterval = (callback, delay, ...args) =>
    nativeSetInterval(() => {
      if (!paused) runCallback(callback, args);
    }, delay);

  window.setTimeout = (callback, delay, ...args) =>
    nativeSetTimeout(() => {
      if (!paused) runCallback(callback, args);
    }, delay);

  const pauseStyle = document.createElement("style");
  pauseStyle.textContent = "*{animation-play-state:paused!important;}";

  function reportVisualError(error) {
    const message =
      error?.message ||
      error?.reason?.message ||
      (typeof error === "string" ? error : "The generated code threw a runtime error.");
    window.parent?.postMessage({ type: "gd-visual-error", message }, "*");

    nativeSetTimeout(() => {
      if (document.getElementById("gd-visual-error")) return;
      const box = document.createElement("div");
      box.id = "gd-visual-error";
      box.innerHTML =
        '<strong>Animation code error</strong><span>' +
        String(message).replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]) +
        '</span>';
      box.style.cssText =
        "position:fixed;inset:16px;z-index:2147483647;display:grid;place-items:center;gap:8px;text-align:center;border:1px solid #fed7aa;border-radius:16px;background:linear-gradient(135deg,#fff7ed,#ffffff);color:#9a3412;padding:18px;font:14px system-ui,sans-serif;box-shadow:0 18px 50px rgba(15,23,42,.16);";
      const span = box.querySelector("span");
      if (span) span.style.cssText = "display:block;max-width:720px;color:#7c2d12;font-size:12px;line-height:1.45;";
      document.body?.appendChild(box);
    }, 0);
  }

  function resumeRafs() {
    for (const [id, callback] of Array.from(pendingRafs.entries())) {
      nativeRaf((time) => {
        const saved = pendingRafs.get(id);
        if (!saved || paused) return;
        pendingRafs.delete(id);
        callback(time);
      });
    }
  }

  function setPaused(value) {
    paused = value;
    if (paused) {
      document.documentElement.dataset.gdVisualPaused = "true";
      if (!pauseStyle.isConnected) document.head.appendChild(pauseStyle);
      document.querySelectorAll("video,audio").forEach((el) => el.pause?.());
      return;
    }

    delete document.documentElement.dataset.gdVisualPaused;
    pauseStyle.remove();
    document.querySelectorAll("video,audio").forEach((el) => el.play?.().catch?.(() => {}));
    resumeRafs();
  }

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type !== "gd-visual-control") return;
    if (data.action === "pause") setPaused(true);
    if (data.action === "resume") setPaused(false);
  });

  window.addEventListener("error", (event) => reportVisualError(event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => reportVisualError(event.reason));
})();
</script>`;

function buildVisualPreviewDocument(html: string): string {
  const controls = `${VISUAL_PREVIEW_BASE_STYLE}\n${VISUAL_PREVIEW_CONTROLLER}`;
  const trimmed = html.trim();

  if (/<head[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<head([\s\S]*?)>/i, (match) => `${match}\n${controls}`);
  }

  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<html([\s\S]*?)>/i, (match) => `${match}\n<head>${controls}</head>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
${controls}
</head>
<body>
${trimmed}
</body>
</html>`;
}

function VisualPreview({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const previewDocument = useMemo(() => buildVisualPreviewDocument(html), [html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string } | null;
      if (data?.type !== "gd-visual-error") return;
      setRuntimeError(data.message || "The generated animation code failed.");
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const sendControl = (action: "pause" | "resume") => {
    iframeRef.current?.contentWindow?.postMessage({ type: "gd-visual-control", action }, "*");
  };

  const replay = () => {
    setRuntimeError(null);
    setPaused(false);
    setPlayerKey((key) => key + 1);
  };

  const togglePaused = () => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    sendControl(nextPaused ? "pause" : "resume");
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background/45">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Animation preview
        </span>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={replay}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background/55 px-2 text-[11px] text-foreground transition-colors hover:border-primary/35 hover:text-primary"
          >
            <RotateCcw className="h-3 w-3" />
            Replay
          </button>
          <button
            type="button"
            onClick={togglePaused}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background/55 px-2 text-[11px] text-foreground transition-colors hover:border-primary/35 hover:text-primary"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </button>
        </span>
      </div>
      {runtimeError && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          The generated animation code failed before it could run: {runtimeError}. Generate it again
          for a fresh version.
        </div>
      )}
      <iframe
        key={playerKey}
        ref={iframeRef}
        title="Generated animation preview"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={previewDocument}
        onLoad={() => {
          if (paused) sendControl("pause");
        }}
        className="h-[360px] w-full bg-white sm:h-[420px]"
      />
    </div>
  );
}

function Message({ msg, streaming }: { msg: DisplayMessage; isLast: boolean; streaming: boolean }) {
  const visualParts = msg.source === "visuals" ? splitVisualMessage(msg.content) : null;
  const htmlAnimation = !streaming ? visualParts?.html : null;
  const displayContent =
    msg.source === "visuals" && streaming
      ? "Building your animation preview..."
      : visualParts
        ? visualParts.markdown || "Animation preview ready."
        : msg.content;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-lg rounded-br-sm bg-gradient-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-elegant break-words sm:max-w-[85%] sm:px-4">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2 sm:gap-3">
      <AiMark active={streaming} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        {((msg.source && msg.source !== "general") || msg.webSources?.length) && (
          <div className="mb-1.5 flex items-center gap-2">
            {msg.source && msg.source !== "general" && <SourceBadge source={msg.source} />}
            {msg.webSources?.length ? <WebSourceBadge count={msg.webSources.length} /> : null}
          </div>
        )}
        <div
          className={`medai-prose luxury-panel rounded-lg px-3.5 py-3 text-sm sm:px-4 ${
            streaming ? "streaming-caret" : ""
          }`}
        >
          {displayContent ? (
            <ReactMarkdown>{displayContent}</ReactMarkdown>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking...
            </span>
          )}
        </div>
        {htmlAnimation && <VisualPreview html={htmlAnimation} />}
        <WebSourceIcons sources={msg.webSources} />
      </div>
    </div>
  );
}
