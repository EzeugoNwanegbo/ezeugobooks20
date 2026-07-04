import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { takePendingChatDoc } from "@/lib/chat-handoff";
import { embedQuery } from "@/lib/embeddings";
import { getCached, setCached } from "@/lib/data-cache";
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
  Layers,
  Mic,
  Volume2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";

type ChatSearch = { c?: string };
type MessageSource = "library" | "general" | "interlink" | "visuals";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

type DisplayMessage = ChatMessage & {
  source?: MessageSource;
  model?: string;
  webSources?: WebSource[];
};

type InlineThread = {
  id: string;
  selectedText: string;
  prompt: string;
  response: string;
  collapsed: boolean;
  loading: boolean;
  error?: string;
};

type InlineComposerState = {
  selectedText: string;
  top: number;
  left: number;
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

// Not every message is a "search my textbook" request. Greetings, chit-chat,
// and follow-ups about the previous answer should be handled like a normal
// conversation - the chat history is already in context, so there's no need to
// run a fresh document search. We still search whenever the user explicitly
// points at their material (see explicitlyNeedsLibrary) or hand-picks files.
function looksConversational(content: string, messages: DisplayMessage[]): boolean {
  const text = content.trim();
  if (!text) return true;
  if (looksCasualMessage(text)) return true;

  // If the message clearly references study material, treat it as a search.
  if (explicitlyNeedsLibrary(text)) return false;

  const normalized = text.toLowerCase();
  const hasPriorAnswer = messages.some(
    (m) => m.role === "assistant" && m.content.trim().length > 0,
  );

  // Talking to the assistant itself / small talk / opinions.
  const chitChat =
    /\b(how are you|how'?s it going|who are you|what are you|what can you do|what do you do|your name|good (morning|afternoon|evening)|let'?s (chat|talk)|just (chatting|talking|curious|wondering)|what do you think|in your opinion|do you think|can we (chat|talk))\b/i;
  if (chitChat.test(normalized)) return true;

  // Follow-ups that lean on the previous answer rather than new material.
  const followUp =
    /^(and|but|so|then|also|why|why not|how so|how come|really|continue|go on|keep going|more|tell me more|expand|elaborate|explain (that|it|this)|simpler|simplify|shorter|in short|tl;?dr|summari[sz]e|recap|rephrase|reword|repeat that|say that again|what do you mean|i (don'?t|do not) (get|understand)|can you (explain|clarify|rephrase|simplify|shorten))\b/i;
  if (hasPriorAnswer && followUp.test(normalized)) return true;

  // Short pronoun-led follow-ups ("why is that?", "what about it?") that carry
  // no new subject of their own rely on prior context, not a new search.
  if (
    hasPriorAnswer &&
    text.length <= 48 &&
    /\b(it|that|this|those|these|them|they)\b/i.test(normalized) &&
    queryTerms(text).length <= 2
  ) {
    return true;
  }

  return false;
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
  const interlink = false;
  const [docs, setDocs] = useState<DocumentCtx[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [libraryNotice, setLibraryNotice] = useState<LibraryNotice>(null);
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [flashPillDismissed, setFlashPillDismissed] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  // The composer is absolutely positioned and its height varies (mode tabs,
  // library row, multi-line input). Track it so the message list can reserve
  // exactly enough space and never hide the end of the last answer.
  const [composerHeight, setComposerHeight] = useState(0);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [hideComposer, setHideComposer] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const lastScrollY = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptBaseRef = useRef("");
  const chatAbortRef = useRef<AbortController | null>(null);
  const activeSendConversationRef = useRef<string | null>(null);
  const restoredOwnerRef = useRef<string | null>(null);
  const latestSessionRef = useRef<PersistedChatSession | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const previousPersistConversationRef = useRef<string | null>(conversationId ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const speechWindow = window as SpeechWindow;
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

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

  // "Upload, then start chatting": the Library page stages the freshly-uploaded
  // document id. Once the library list has loaded (so the new doc is present
  // and won't be filtered out), attach it as the search context and open a
  // clean conversation focused on that file.
  const pendingDocAppliedRef = useRef(false);
  useEffect(() => {
    if (!user || !docsLoaded || pendingDocAppliedRef.current) return;
    pendingDocAppliedRef.current = true;
    const docId = takePendingChatDoc(user.id);
    if (!docId || !docs.some((doc) => doc.id === docId)) return;
    setUseLibrary(true);
    setSelectedDocIds([docId]);
    setLibraryNotice(null);
    setMessages([]);
    if (conversationId) navigate({ to: "/app/chat", search: {} });
    const attached = docs.find((doc) => doc.id === docId);
    toast(`Attached "${attached?.file_name ?? "your file"}"`, {
      description: "Ask anything about it - answers will cite this file.",
    });
  }, [user, docsLoaded, docs, conversationId, navigate]);

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
      interlink: false,
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
    // Show the cached chat list instantly on revisit, then revalidate.
    const cached = getCached<ConversationRow[]>(`convos:${user.id}`);
    if (cached) setConvos(cached);
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    const rows = (data as ConversationRow[]) ?? [];
    setConvos(rows);
    setCached(`convos:${user.id}`, rows);
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

  // Keep the message list's bottom padding in sync with the composer's actual
  // height (it grows with the mode tabs, library row, and multi-line input).
  useEffect(() => {
    const node = composerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setComposerHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      if (isInputFocused) return;
      const currentScrollY = scroller.scrollTop;
      const diff = currentScrollY - lastScrollY.current;

      // scroll threshold
      if (Math.abs(diff) < 20) return;

      if (diff > 0 && currentScrollY > 150) {
        setHideComposer(true);
        window.dispatchEvent(new CustomEvent("gd:chat-scroll", { detail: { hide: true } }));
      } else {
        setHideComposer(false);
        window.dispatchEvent(new CustomEvent("gd:chat-scroll", { detail: { hide: false } }));
      }
      lastScrollY.current = currentScrollY;
    };

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
    };
  }, [isInputFocused]);

  useEffect(() => {
    if (streaming) {
      setHideComposer(false);
      window.dispatchEvent(new CustomEvent("gd:chat-scroll", { detail: { hide: false } }));
    }
  }, [streaming]);

  useEffect(() => {
    setHideComposer(false);
    window.dispatchEvent(new CustomEvent("gd:chat-scroll", { detail: { hide: false } }));
  }, [conversationId]);

  useEffect(() => {
    return () => chatAbortRef.current?.abort();
  }, []);

  const cancelResponse = () => {
    const controller = chatAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
  };

  const toggleVoiceInput = () => {
    if (!speechSupported || typeof window === "undefined") return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      toast.error("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new Recognition();
    transcriptBaseRef.current = input.trim();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      toast.error(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow the microphone and try again."
          : "Voice input stopped. Try again.",
      );
    };
    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }

      const spoken = `${finalTranscript} ${interimTranscript}`.trim();
      const base = transcriptBaseRef.current;
      setInput([base, spoken].filter(Boolean).join(" ").trimStart());
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
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

    // Only search the library when the message actually calls for study
    // material. Greetings, small talk, and follow-ups about the previous answer
    // are handled conversationally (the chat history is already in context).
    if (!manuallySelected && looksConversational(content, messages)) {
      return { docs: [], noLibraryMatch: false, noMatchScope: null };
    }

    const documentIds = manuallySelected ? selectedDocs.map((doc) => doc.id) : null;
    const recentChat = messages
      .slice(-6)
      .map((m) => m.content)
      .join(" ");
    const terms = queryTerms(`${content} ${recentChat}`);

    // Embed the question so retrieval ranks by meaning, not just shared words.
    // Returns null if the embedding service is down - the hybrid RPC then falls
    // back to keyword-only ranking, so search still works.
    const queryEmbedding = await embedQuery(content);

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    const timeout = window.setTimeout(() => controller.abort(), CHUNK_SEARCH_TIMEOUT_MS);
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      if (signal?.aborted) throw new Error(CHAT_CANCELLED);
      const { data, error } = await supabase
        .rpc("search_document_chunks_hybrid", {
          query_terms: terms,
          query_embedding: queryEmbedding,
          match_document_ids: documentIds,
          // Wider first-pass net so the right material reaches the AI up front.
          match_count: manuallySelected ? 30 : 24,
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

    if (
      fallbackWithText.length === 0 &&
      !looksCasualMessage(content) &&
      (explicitlyNeedsLibrary(content) || manuallySelected)
    ) {
      return {
        docs: [],
        noLibraryMatch: true,
        noMatchScope: manuallySelected ? "selected" : "library",
      };
    }

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
        interlink: false,
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
      interlink: false,
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

  useEffect(() => {
    const handleNewChat = () => newChat();
    window.addEventListener("gd:new-chat", handleNewChat);
    return () => window.removeEventListener("gd:new-chat", handleNewChat);
  });

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
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background min-w-0">
      {/* Conversations sidebar */}
      <aside
        className={`hidden lg:flex min-h-0 flex-col overflow-hidden border-r border-border/70 bg-background transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? "w-72" : "w-16"}`}
      >
        <div
          className={`flex justify-center py-4 transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? "px-3" : "px-2"}`}
        >
          <button
            onClick={newChat}
            className={`flex items-center overflow-hidden rounded-xl border border-border/70 text-foreground transition-all duration-300 hover:border-primary/35 hover:bg-foreground/[0.04] ${
              sidebarOpen ? "w-full px-3 py-2.5 text-sm font-medium" : "h-10 w-10 justify-center p-0"
            }`}
            title="New chat"
          >
            <Plus className="h-4 w-4" />
            <span
              className={`whitespace-nowrap transition-all duration-300 ${
                sidebarOpen
                  ? "ml-2 max-w-24 translate-x-0 opacity-100"
                  : "ml-0 max-w-0 -translate-x-2 opacity-0"
              }`}
            >
              New chat
            </span>
          </button>
        </div>
        <div
          className={`min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pb-4 pt-2 transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            sidebarOpen ? "px-3" : "px-2"
          }`}
        >
          {convos.length === 0 ? (
            sidebarOpen && (
              <div className="px-2 py-6 text-sm leading-relaxed text-muted-foreground">
                {isGuest ? "Guest chats are not saved." : "Your past chats will appear here."}
              </div>
            )
          ) : (
            <>
              <ConvoGroup
                title="Today"
                items={groupedConvos.today}
                activeId={conversationId}
                collapsed={!sidebarOpen}
                onPick={(id) => navigate({ to: "/app/chat", search: { c: id } })}
                onDelete={deleteConversation}
              />
              <ConvoGroup
                title="Last 7 days"
                items={groupedConvos.week}
                activeId={conversationId}
                collapsed={!sidebarOpen}
                onPick={(id) => navigate({ to: "/app/chat", search: { c: id } })}
                onDelete={deleteConversation}
              />
              <ConvoGroup
                title="Older"
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
        <div className="hidden shrink-0 border-b border-border/70 bg-background px-3 py-3 md:block sm:px-4 lg:px-6">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setSidebarOpen((v) => !v)}
                  className="hidden rounded-xl p-2 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground lg:inline-flex"
                  title={sidebarOpen ? "Hide chats" : "Show chats"}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </button>
                <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] sm:text-base">
                  {conversationId
                    ? convos.find((c) => c.id === conversationId)?.title || "Chat"
                    : "New chat"}
                </h1>
              </div>
            </div>
            <div className="chat-header-controls -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] xl:mx-0 xl:overflow-visible xl:px-0 xl:pb-0 [&::-webkit-scrollbar]:hidden">
              <>
                <button
                  onClick={() => setUseLibrary((v) => !v)}
                  title="Toggle file search"
                  className={`hidden shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors sm:inline-flex ${
                    useLibrary
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                  }`}
                >
                  Files {useLibrary ? "on" : "off"}
                </button>
                <button
                  onClick={() => {
                    if (docs.length === 0) {
                      toast("Your library is empty", {
                        description:
                          "Upload your PDFs or notes to the Library first to study them here.",
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
                  className="hidden shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40 sm:inline-flex"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </button>
              </>
              <div className="chat-mode-selector flex shrink-0 rounded-xl border border-border/70 bg-foreground/[0.03] p-0.5">
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
                    className={`flex min-h-8 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors sm:px-2.5 ${
                      mode === m
                        ? "bg-background text-foreground shadow-sm"
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
          <div
            className="mx-auto max-w-3xl px-3 pt-4 sm:px-4 md:px-8 md:pt-8"
            style={{ paddingBottom: (composerHeight || 150) + 24 }}
          >
            {loadingConvo && messages.length === 0 ? (
              <div className="flex justify-center py-12">
                <LoadingDots size="md" className="text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState name={profile.name || "there"} onPick={(s) => send(s)} mode={mode} />
            ) : (
              <div className="space-y-6">
                {messages.map((m, i) => (
                  <Message
                    key={i}
                    msg={m}
                    profile={profile}
                    mode={mode}
                    isLast={i === messages.length - 1}
                    composerOffset={composerHeight || 150}
                    streaming={streaming && i === messages.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div
          ref={composerRef}
          className={`pointer-events-none absolute bottom-0 left-0 right-0 z-10 px-3 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-5 sm:px-4 md:px-8 md:pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
            hideComposer ? "translate-y-[calc(100%+1rem)]" : "translate-y-0"
          }`}
        >
          <div className="pointer-events-auto max-w-3xl mx-auto">
            {messages.some((m) => m.role === "user") && !flashPillDismissed && (
              <div className="mb-2 flex justify-center">
                <div className="inline-flex items-center gap-1 rounded-xl border border-border/70 bg-background px-1 py-1 text-xs shadow-sm">
                  <Link
                    to="/app/studybody"
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Learn with flash cards
                  </Link>
                  <button
                    type="button"
                    onClick={() => setFlashPillDismissed(true)}
                    aria-label="Dismiss"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            <div className="mb-2 flex overflow-x-auto rounded-xl border border-border/70 bg-foreground/[0.03] p-0.5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
              {CHAT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
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
                  className={`flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                    mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {m === "Storytelling" && <BookText className="h-3 w-3" />}
                  {m === "Visuals" && <Sparkles className="h-3 w-3" />}
                  {m}
                </button>
              ))}
            </div>
            {mode === "Visuals" && (
              <div className="mb-2 hidden border-b border-border/60 px-1 pb-2 md:block">
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
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Choose file
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate({ to: "/app/library" })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Upload file
                    </button>
                  )}
                </div>
              </div>
            )}
            {useLibrary && (
              <div className="mb-2 border-b border-border/60 px-1 pb-2">
                <div className="flex flex-nowrap items-center gap-1.5 sm:flex-wrap sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setFilePickerOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Add files
                  </button>

                  {selectedDocs.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setFilePickerOpen(true)}
                      title={selectedDocs.map((doc) => doc.file_name).join(", ")}
                      className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-xl px-2 py-1 text-left text-[11px] text-foreground transition-colors hover:bg-foreground/[0.04] sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs"
                    >
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {selectedDocs[0]?.file_name}
                        {selectedDocs.length > 1 ? ` +${selectedDocs.length - 1}` : ""}
                      </span>
                    </button>
                  ) : docs.length === 0 ? (
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground sm:text-xs">
                      Your library is empty.
                    </span>
                  ) : (
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground sm:text-xs">
                      <span className="sm:hidden">Auto file match</span>
                      <span className="hidden sm:inline">
                        Pinpoint search will choose the strongest file matches.
                      </span>
                    </span>
                  )}

                  {selectedDocs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDocIds([])}
                      className="ml-auto shrink-0 text-[11px] text-muted-foreground hover:text-foreground sm:text-xs"
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
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  title={listening ? "Stop voice input" : "Use voice input"}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop voice input" : "Start voice input"}
                className={`inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    listening
                      ? "border-primary bg-primary text-primary-foreground shadow-glow ring-2 ring-primary/25"
                      : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:bg-foreground/[0.04] hover:text-foreground"
                  }`}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  setIsInputFocused(true);
                  setHideComposer(false);
                  window.dispatchEvent(new CustomEvent("gd:chat-scroll", { detail: { hide: false } }));
                }}
                onBlur={() => setIsInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                // Disable predictive/composing text - the Samsung keyboard's
                // composing path doesn't commit into the Android WebView, so
                // typed text never appears. Plain (non-composing) input works.
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                rows={1}
                placeholder=""
                className="min-h-[44px] max-h-[180px] flex-1 resize-none rounded-2xl border border-border/80 bg-background px-4 py-2.5 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.08)] focus:outline-none focus:ring-2 focus:ring-ring sm:px-5"
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
                className={`inline-flex h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors sm:px-3.5 ${
                  webSearch
                    ? "border-primary bg-primary text-primary-foreground shadow-glow ring-2 ring-primary/25"
                    : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:bg-foreground/[0.04] hover:text-foreground"
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
                  className="h-[44px] w-[44px] flex items-center justify-center rounded-xl border border-destructive/40 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/15"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="h-[44px] w-[44px] flex items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </form>
            <p className="mt-1.5 hidden text-center text-[11px] text-muted-foreground sm:block">
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
      <DialogContent
        // On mobile, letting Radix auto-focus the search input pops the on-screen
        // keyboard the instant the picker opens - it shrinks the viewport and
        // buries the file list (and its scroll area) behind the keyboard. Keep
        // focus off the input so the list opens full-height; the keyboard only
        // appears if the user deliberately taps Search.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="luxury-panel flex max-h-[88dvh] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg p-0 sm:max-h-[85vh] sm:max-w-2xl"
      >
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

          <div className="min-h-[120px] flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface/40 [-webkit-overflow-scrolling:touch]">
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
    <div className="overflow-hidden">
      <div
        className={`px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-all duration-300 ${
          title && !collapsed ? "max-h-6 pb-2 opacity-100" : "max-h-0 pb-0 opacity-0"
        }`}
      >
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <div
                className={`group flex cursor-pointer items-center overflow-hidden rounded-xl transition-all duration-300 ${
                  collapsed ? "justify-center p-2" : "gap-2 px-2 py-2.5"
                } ${
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                }`}
                onClick={() => onPick(c.id)}
                title={collapsed ? c.title || "New conversation" : undefined}
              >
                <MessageSquare
                  className={`h-3.5 w-3.5 flex-shrink-0 ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                />
                <span
                  className={`min-w-0 flex-1 transition-all duration-300 ${
                    collapsed
                      ? "max-w-0 -translate-x-2 opacity-0"
                      : "max-w-[12rem] translate-x-0 opacity-100"
                  }`}
                >
                  <span className="block truncate text-sm font-medium">
                    {c.title || "New conversation"}
                  </span>
                  {c.updated_at && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {new Date(c.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  className={`overflow-hidden rounded-lg text-muted-foreground transition-all duration-300 hover:bg-foreground/[0.05] hover:text-destructive group-hover:opacity-100 ${
                    collapsed
                      ? "pointer-events-none max-w-0 translate-x-2 p-0 opacity-0"
                      : "max-w-8 translate-x-0 p-1 opacity-0"
                  }`}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
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
  mode,
}: {
  name: string;
  onPick: (s: string) => void;
  mode: ChatMode;
}) {
  const suggestions = mode === "Visuals" ? VISUAL_SUGGESTIONS : SUGGESTIONS;

  return (
    <div className="py-10 text-center sm:py-16">
      <AiMark size="lg" className="mb-5" />
      <h2 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-5xl">
        Ready, {name}
      </h2>
      <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group rounded-2xl bg-transparent p-4 text-left text-sm leading-relaxed text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-foreground/[0.03] hover:text-foreground hover:shadow-sm"
          >
            <span className="block font-medium">{s}</span>
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

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Single source chip showing the site's favicon, falling back to its initial. */
function SourceFavicon({ source, index }: { source: WebSource; index: number }) {
  const [failed, setFailed] = useState(false);
  const host = sourceHostname(source.url);
  const initial = (host || source.title || "?").charAt(0).toUpperCase();
  const label = source.title || host || source.url;

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={`Open web source ${index + 1}: ${label}`}
      className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border bg-background/45 text-muted-foreground backdrop-blur-[2px] transition-colors hover:border-primary/35 hover:text-primary"
    >
      {host && !failed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          className="h-4 w-4 rounded-sm"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[11px] font-semibold leading-none">{initial}</span>
      )}
    </a>
  );
}

function WebSourceIcons({ sources }: { sources?: WebSource[] }) {
  if (!sources?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {sources.slice(0, 6).map((source, index) => (
        <SourceFavicon key={`${source.url}-${index}`} source={source} index={index} />
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

function textForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block omitted ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Message({
  msg,
  streaming,
  profile,
  mode,
  composerOffset,
}: {
  msg: DisplayMessage;
  profile: Profile;
  mode: ChatMode;
  isLast: boolean;
  composerOffset: number;
  streaming: boolean;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [inlineThreads, setInlineThreads] = useState<InlineThread[]>([]);
  const [inlineComposer, setInlineComposer] = useState<InlineComposerState | null>(null);
  const [inlineInput, setInlineInput] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const inlineComposerRef = useRef<HTMLFormElement>(null);
  const visualParts = msg.source === "visuals" ? splitVisualMessage(msg.content) : null;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const htmlAnimation = !streaming ? visualParts?.html : null;
  const rawContent =
    msg.source === "visuals" && streaming
      ? "Building your animation preview..."
      : visualParts
        ? visualParts.markdown || "Animation preview ready."
        : msg.content;
  const displayContent = rawContent ? rawContent.replace(/—/g, " - ") : "";

  useEffect(() => {
    if (!inlineComposer) return;

    const dismissOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (inlineComposerRef.current?.contains(event.target as Node)) return;
      setInlineComposer(null);
    };

    window.addEventListener("mousedown", dismissOnOutsideClick);
    window.addEventListener("touchstart", dismissOnOutsideClick);
    return () => {
      window.removeEventListener("mousedown", dismissOnOutsideClick);
      window.removeEventListener("touchstart", dismissOnOutsideClick);
    };
  }, [inlineComposer]);

  const streamInlineAnswer = (id: string, selectedText: string, prompt: string) => {
    setInlineThreads((current) =>
      current.map((thread) =>
        thread.id === id
          ? { ...thread, collapsed: false, error: undefined, loading: true, response: "" }
          : thread,
      ),
    );

    void streamChat({
      messages: [
        { role: "assistant", content: msg.content },
        {
          role: "user",
          content: `I highlighted this passage from your previous answer:\n\n"${selectedText}"\n\nMy question: ${prompt}\n\nAnswer only this inline question. Keep the response focused on the highlighted passage and avoid restarting the full chat.`,
        },
      ],
      profile,
      mode: mode === "Visuals" ? "Detailed" : mode,
      documentMode: "none",
      onDelta: (chunk) => {
        setInlineThreads((current) =>
          current.map((thread) =>
            thread.id === id ? { ...thread, response: thread.response + chunk } : thread,
          ),
        );
      },
      onDone: () => {
        setInlineThreads((current) =>
          current.map((thread) =>
            thread.id === id ? { ...thread, loading: false } : thread,
          ),
        );
      },
      onError: (error) => {
        setInlineThreads((current) =>
          current.map((thread) =>
            thread.id === id ? { ...thread, error, loading: false } : thread,
          ),
        );
      },
      onCancel: () => {
        setInlineThreads((current) =>
          current.map((thread) =>
            thread.id === id
              ? { ...thread, error: "Inline request cancelled.", loading: false }
              : thread,
          ),
        );
      },
    });
  };

  const openInlineComposer = () => {
    if (streaming) return;

    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const selectedText = selection.toString().replace(/\s+/g, " ").trim();
      if (selectedText.length < 2) return;

      const range = selection.getRangeAt(0);
      if (!contentRef.current?.contains(range.commonAncestorContainer)) return;

      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      const composerWidth = 280;
      const top = Math.min(window.innerHeight - 74, rect.bottom + 10);
      const left = Math.max(12, Math.min(window.innerWidth - composerWidth - 12, rect.left));
      setInlineInput("");
      setInlineComposer({ selectedText, top, left });
    }, 0);
  };

  const submitInlinePrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inlineComposer) return;

    const prompt = inlineInput.trim();
    if (!prompt) return;

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const thread: InlineThread = {
      id,
      selectedText: inlineComposer.selectedText,
      prompt,
      response: "",
      collapsed: false,
      loading: true,
    };

    setInlineThreads((current) => [...current, thread]);
    setInlineComposer(null);
    setInlineInput("");
    window.getSelection()?.removeAllRanges();
    streamInlineAnswer(id, thread.selectedText, prompt);
  };

  const renderInlineMarkdown = () => {
    if (!displayContent) {
      return (
        <div className="flex flex-col gap-2 py-0.5" aria-live="polite" aria-busy="true">
          <span className="text-xs font-medium text-muted-foreground">Preparing your answer</span>
          <span className="gd-loading-bar" />
        </div>
      );
    }

    if (!inlineThreads.length) return <ReactMarkdown>{displayContent}</ReactMarkdown>;

    const ordered = inlineThreads
      .map((thread, order) => ({
        thread,
        order,
        position: displayContent.indexOf(thread.selectedText),
      }))
      .sort((a, b) => {
        if (a.position === b.position) return a.order - b.order;
        if (a.position === -1) return 1;
        if (b.position === -1) return -1;
        return a.position - b.position;
      });
    const rendered: ReactNode[] = [];
    const unattached: InlineThread[] = [];
    let cursor = 0;

    for (let index = 0; index < ordered.length; index += 1) {
      const { thread, position } = ordered[index];
      if (position === -1 || position < cursor) {
        unattached.push(thread);
        continue;
      }

      if (position > cursor) {
        rendered.push(
          <ReactMarkdown key={`before-${thread.id}`}>
            {displayContent.slice(cursor, position)}
          </ReactMarkdown>,
        );
      }

      const anchoredThreads = [thread];
      while (
        index + 1 < ordered.length &&
        ordered[index + 1].position === position &&
        ordered[index + 1].thread.selectedText === thread.selectedText
      ) {
        index += 1;
        anchoredThreads.push(ordered[index].thread);
      }

      rendered.push(
        <mark key={`mark-${thread.id}`} className="ai-inline-selection">
          {displayContent.slice(position, position + thread.selectedText.length)}
        </mark>,
      );
      anchoredThreads.forEach((anchoredThread) => {
        rendered.push(
          <InlineThreadView
            key={anchoredThread.id}
            thread={anchoredThread}
            onToggle={() =>
              setInlineThreads((current) =>
                current.map((item) =>
                  item.id === anchoredThread.id ? { ...item, collapsed: !item.collapsed } : item,
                ),
              )
            }
            onRegenerate={() =>
              streamInlineAnswer(
                anchoredThread.id,
                anchoredThread.selectedText,
                anchoredThread.prompt,
              )
            }
            onDelete={() =>
              setInlineThreads((current) =>
                current.filter((item) => item.id !== anchoredThread.id),
              )
            }
          />,
        );
      });
      cursor = position + thread.selectedText.length;
    }

    if (cursor < displayContent.length) {
      rendered.push(
        <ReactMarkdown key="after-inline-threads">{displayContent.slice(cursor)}</ReactMarkdown>,
      );
    }

    if (unattached.length) {
      rendered.push(
        <div key="unattached-inline-threads" className="mt-4 space-y-3">
          {unattached.map((thread) => (
            <InlineThreadView
              key={thread.id}
              thread={thread}
              onToggle={() =>
                setInlineThreads((current) =>
                  current.map((item) =>
                    item.id === thread.id ? { ...item, collapsed: !item.collapsed } : item,
                  ),
                )
              }
              onRegenerate={() => streamInlineAnswer(thread.id, thread.selectedText, thread.prompt)}
              onDelete={() =>
                setInlineThreads((current) => current.filter((item) => item.id !== thread.id))
              }
            />
          ))}
        </div>,
      );
    }

    return rendered;
  };

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm break-words sm:max-w-[85%] sm:px-4">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="group flex gap-2 sm:gap-3">
      <AiMark active={streaming} className="mt-0.5 scale-90 opacity-75" />
      <div className="min-w-0 flex-1">
        {((msg.source && msg.source !== "general") || msg.webSources?.length) && (
          <div className="mb-3 flex items-center gap-2">
            {msg.source && msg.source !== "general" && <SourceBadge source={msg.source} />}
            {msg.webSources?.length ? <WebSourceBadge count={msg.webSources.length} /> : null}
          </div>
        )}
        <div
          ref={contentRef}
          onMouseUp={openInlineComposer}
          onKeyUp={openInlineComposer}
          onTouchEnd={openInlineComposer}
          className="ai-response-document medai-prose text-[15px]"
        >
          {renderInlineMarkdown()}
        </div>
        {inlineComposer && (
          <form
            ref={inlineComposerRef}
            onSubmit={submitInlinePrompt}
            style={
              typeof window !== "undefined" && window.innerWidth >= 768
                ? { top: inlineComposer.top, left: inlineComposer.left }
                : {
                    bottom: `calc(${Math.max(composerOffset, 96)}px + max(0.75rem, env(safe-area-inset-bottom)))`,
                  }
            }
            className="ai-inline-composer fixed z-50 flex max-h-[42dvh] w-[calc(100%-1.5rem)] flex-col gap-1.5 rounded-2xl border border-border/70 bg-background/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl left-3 right-3 md:bottom-auto md:left-auto md:right-auto md:w-[320px] md:translate-y-0 md:rounded-xl"
          >
            <div className="text-[11px] text-muted-foreground px-2 py-1 max-h-16 overflow-y-auto border-b border-border/50 italic select-none leading-normal">
              "{inlineComposer.selectedText.replace(/—/g, " - ")}"
            </div>
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={inlineInput}
                onChange={(event) => setInlineInput(event.target.value)}
                placeholder="Ask about this..."
                className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                title="Send inline question"
                aria-label="Send inline question"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-45"
                disabled={!inlineInput.trim()}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Dismiss"
                aria-label="Dismiss"
                onClick={() => setInlineComposer(null)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        )}
        {displayContent && !streaming && canSpeak && (
          <button
            type="button"
            onClick={() => {
              if (speaking) {
                window.speechSynthesis.cancel();
                setSpeaking(false);
                return;
              }

              const utterance = new SpeechSynthesisUtterance(textForSpeech(displayContent));
              utterance.onend = () => setSpeaking(false);
              utterance.onerror = () => setSpeaking(false);
              window.speechSynthesis.cancel();
              setSpeaking(true);
              window.speechSynthesis.speak(utterance);
            }}
            title={speaking ? "Stop reading" : "Read answer aloud"}
            aria-pressed={speaking}
            className="mt-2 inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Volume2 className="h-3.5 w-3.5" />
            {speaking ? "Stop" : "Listen"}
          </button>
        )}
        {htmlAnimation && <VisualPreview html={htmlAnimation} />}
        <WebSourceIcons sources={msg.webSources} />
      </div>
    </div>
  );
}

function InlineThreadView({
  thread,
  onToggle,
  onRegenerate,
  onDelete,
}: {
  thread: InlineThread;
  onToggle: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="ai-inline-thread my-3" aria-live={thread.loading ? "polite" : "off"}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          title={thread.collapsed ? "Expand inline response" : "Collapse inline response"}
          aria-label={thread.collapsed ? "Expand inline response" : "Collapse inline response"}
          className="inline-flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          {thread.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{thread.prompt.replace(/—/g, " - ")}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRegenerate}
            title="Regenerate inline response"
            aria-label="Regenerate inline response"
            disabled={thread.loading}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete inline response"
            aria-label="Delete inline response"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!thread.collapsed && (
        <div className="pl-3">
          <blockquote className="ai-inline-quote">{thread.selectedText.replace(/—/g, " - ")}</blockquote>
          {thread.error ? (
            <p className="text-sm text-destructive">{thread.error}</p>
          ) : thread.response ? (
            <div className="medai-prose text-sm">
              <ReactMarkdown>{thread.response.replace(/—/g, " - ")}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col gap-2 py-1.5" aria-busy="true">
              <span className="text-xs font-medium text-muted-foreground">Thinking inline</span>
              <span className="gd-loading-bar" />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
