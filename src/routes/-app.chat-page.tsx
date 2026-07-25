import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { buildContinuationPrompt } from "@/lib/chat-portability";
import { PERSONALIZATION_PROMPT } from "@/lib/personalization";
import { isNativeApp } from "@/lib/native";
import { lookupTerm, isTermLookupComplete, type TermLookupState } from "@/lib/term-lookup";
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
  ChevronLeft,
  Copy,
  Scissors,
  Pencil,
  Check,
} from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";

// GitHub-flavoured markdown (tables, ~~strikethrough~~, task lists, `---` rules).
// Hoisted to a module constant so every <ReactMarkdown> shares one stable array
// instead of allocating a fresh plugins list on each render.
const REMARK_PLUGINS = [remarkGfm];

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

// A past answer/question pairing kept around after an edit-and-rerun so the
// user can browse back to it. `userContent` is the question that produced
// `content` — flipping versions swaps both bubbles together.
type AnswerVersion = {
  content: string;
  userContent: string;
  source?: MessageSource;
  model?: string;
  webSources?: WebSource[];
};

type DisplayMessage = ChatMessage & {
  source?: MessageSource;
  model?: string;
  webSources?: WebSource[];
  // Present on an assistant message that has been regenerated at least once
  // (via editing the user question above it). `content`/`source`/`model`/
  // `webSources` always mirror `versions[activeVersion]`.
  versions?: AnswerVersion[];
  activeVersion?: number;
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
  canCut: boolean;
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

// "Visuals" (the old animated-video mode) is retired - answers now draw inline
// diagrams automatically when a concept is visual, in every mode. The backend
// Visuals pipeline stays dormant; users just can't pick it any more.
const CHAT_MODES = ["Simplified", "Detailed", "Storytelling"] as const;
const SOURCE_MODES = ["My files only", "Files + general", "General knowledge"] as const;
type SourceMode = (typeof SOURCE_MODES)[number];

// Short labels for the collapsed mobile "bubble" selectors, so a chosen
// option shrinks to a compact pill instead of a full-width segmented bar.
const MODE_SHORT: Record<ChatMode, string> = {
  Simplified: "Simple",
  Detailed: "Detailed",
  Storytelling: "Story",
  Visuals: "Visuals",
};
const SOURCE_SHORT: Record<SourceMode, string> = {
  "My files only": "Files",
  "Files + general": "Files + gen",
  "General knowledge": "General",
};

// Chat surface theme, scoped to the chat subtree (overrides the global +
// discipline tokens for this subtree only, so it wins reliably). A near-black
// #001219 ground; the primary action (send, key terms, empty state) keeps the
// warm coral pop, while individual controls own their own deep jewel tone
// (below) so the settings read as colour-coded without a rainbow.
const CHAT_ACCENT_STYLE = {
  "--background": "#001219",
  "--surface": "#04222e",
  "--surface-elevated": "#062c3b",
  "--border": "rgba(148, 210, 220, 0.12)",
  "--input": "rgba(148, 210, 220, 0.16)",
  "--pop": "#ee6c4d",
  "--pop-2": "#d8542f",
  "--pop-foreground": "#ffffff",
  "--gradient-pop": "linear-gradient(145deg, #f4855f 0%, #d8542f 100%)",
  "--shadow-pop": "0 10px 28px -8px rgba(238, 108, 77, 0.42)",
} as CSSProperties;

// Answer-style slider (Simplified → Detailed → Storytelling): deep blue.
const ACCENT_MODE = {
  "--pop": "#004e89",
  "--pop-foreground": "#ffffff",
  "--gradient-pop": "linear-gradient(145deg, #0a5c9c 0%, #003f70 100%)",
  "--shadow-pop": "0 8px 22px -8px rgba(0, 78, 137, 0.55)",
} as CSSProperties;

// Source slider (My files / Files + general / General knowledge): crimson.
const ACCENT_SOURCE = {
  "--pop": "#800f2f",
  "--pop-foreground": "#ffffff",
  "--gradient-pop": "linear-gradient(145deg, #9c1238 0%, #660b25 100%)",
  "--shadow-pop": "0 8px 22px -8px rgba(128, 15, 47, 0.55)",
} as CSSProperties;

// The general-context toggle on the composer: deep wine. Light-rose foreground
// keeps the label legible on the near-black fill.
const ACCENT_GENERAL = {
  "--pop": "#49111c",
  "--pop-foreground": "#f3c9d0",
  "--gradient-pop": "linear-gradient(145deg, #5c1624 0%, #360d15 100%)",
  "--shadow-pop": "0 8px 22px -8px rgba(73, 17, 28, 0.7)",
} as CSSProperties;

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
  discipline: null,
  study_track: null,
  curriculum: "Use broad course-level exam priorities as the reference frame.",
  personalization_background: null,
  exam_format: "MCQ",
  preferred_mode: "Simplified",
  weak_areas: null,
  recent_topics: null,
  onboarded: true,
  is_admin: false,
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

// Extracted text carries "[Page N]" markers (see extract-pdf / document-chunks).
// A snippet sliced around a keyword rarely starts on one of those markers, so
// find the nearest marker at or before the slice start and return its page
// label. This is what lets the fallback excerpt path still cite a page instead
// of an anonymous "[Relevant excerpt N]".
function pageLabelAtOffset(text: string, offset: number): string | null {
  const marker = /\[Page\s+(\d+)\]/g;
  let page: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    if (match.index > offset) break;
    page = match[1];
  }
  return page ? `Page ${page}` : null;
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
      const page = pageLabelAtOffset(text, part.start);
      const where = page ? `${doc.file_name}, ${page}` : doc.file_name;
      const label = `[Relevant excerpt ${index + 1} from ${where}]`;
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

type LibraryChunkRow = {
  chunk_index: number;
  content: string;
  id: string;
  library_document_id: string;
  page_end: number | null;
  page_start: number | null;
  rank: number;
  title: string;
};

// Shared-library hits reuse the same document grouping as personal files; they
// are tagged with a "Shared library" folder so the source stays visible.
function docsFromLibraryRows(rows: LibraryChunkRow[]): DocumentCtx[] {
  const asChunkRows: ChunkSearchRow[] = rows.map((r) => ({
    chunk_index: r.chunk_index,
    content: r.content,
    document_id: r.library_document_id,
    file_name: r.title,
    folder: "Shared library",
    id: r.id,
    page_end: r.page_end,
    page_start: r.page_start,
    rank: r.rank,
  }));
  return docsFromChunkRows(asChunkRows);
}

function webSourcesFromJson(value: unknown): WebSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url : "";
      if (!url) return null;
      const image = typeof record.image === "string" ? record.image : undefined;
      const source: WebSource = {
        title: typeof record.title === "string" ? record.title : "Web source",
        url,
        ...(image ? { image } : {}),
      };
      return source;
    })
    .filter((source): source is WebSource => Boolean(source));

  return sources.length > 0 ? sources : undefined;
}

function normalizeChatMode(value: unknown): ChatMode {
  // Note: the retired "Visuals" mode is no longer in CHAT_MODES, so an old
  // persisted "Visuals" session falls back to Simplified here.
  return (CHAT_MODES as readonly string[]).includes(value as string)
    ? (value as ChatMode)
    : "Simplified";
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
  // Native Android WebView's Samsung-keyboard composing path breaks typing when
  // autocorrect/spellcheck are on, so those stay off there. In the browser we
  // can safely enable them for a normal typing experience.
  const nativeApp = isNativeApp();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingConvo, setLoadingConvo] = useState(false);
  const [mode, setMode] = useState<ChatMode>(normalizeChatMode(profile.preferred_mode));
  const [useLibrary, setUseLibrary] = useState(() => Boolean(user));
  const [webSearch, setWebSearch] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>(() =>
    user ? "My files only" : "General knowledge",
  );
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
  const [personalizationDismissed, setPersonalizationDismissed] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  // The composer is absolutely positioned and its height varies (mode tabs,
  // library row, multi-line input). Track it so the message list can reserve
  // exactly enough space and never hide the end of the last answer.
  const [composerHeight, setComposerHeight] = useState(0);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [hideComposer, setHideComposer] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // "Continue in another AI" — briefly flips to a checkmark after copying.
  const [handoffCopied, setHandoffCopied] = useState(false);
  // On mobile the style/source selectors collapse to small pills and only
  // expand into their full segmented bar while the user is choosing.
  const [expandedSelector, setExpandedSelector] = useState<null | "style" | "source">(null);
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

  const applySourceMode = (nextMode: SourceMode) => {
    setSourceMode(nextMode);
    if (nextMode === "My files only") {
      setUseLibrary(true);
      setWebSearch(false);
    } else if (nextMode === "Files + general") {
      setUseLibrary(true);
      setWebSearch(true);
    } else {
      setUseLibrary(false);
      setWebSearch(true);
      setSelectedDocIds([]);
      setLibraryNotice(null);
    }
  };

  const savePersonalizationBackground = async (text: string) => {
    if (!user || !savedProfile) return;
    const { error } = await supabase
      .from("user_profiles")
      .update({ personalization_background: text || null })
      .eq("id", savedProfile.id);
    if (error) {
      toast.error("Couldn't save your background — try again.");
      return;
    }
    await refreshProfile();
    toast.success("Saved — G&D now studies with you in mind.");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const speechWindow = window as SpeechWindow;
    setSpeechSupported(
      Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition),
    );
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

  // Build a self-contained prompt from this conversation and copy it, so the
  // student can paste it into any other AI and keep going without starting over.
  const copyContinuationPrompt = async () => {
    const prompt = buildContinuationPrompt(messages, profile);
    if (!prompt) {
      toast("Nothing to carry over yet", {
        description: "Ask something first, then you can continue it in another AI.",
      });
      return;
    }
    try {
      await copyTextToClipboard(prompt);
      setHandoffCopied(true);
      window.setTimeout(() => setHandoffCopied(false), 2200);
      toast.success("Prompt copied", {
        description: "Paste it into ChatGPT, Gemini, or any AI to pick up where you left off.",
      });
    } catch {
      toast.error("Couldn't copy — try again.");
    }
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
      // Search the student's own files and, in smart mode, the shared library
      // (built-in textbooks) scoped to their discipline, then merge both. When
      // the student manually selected specific files we respect that and skip
      // the library.
      const [ownRes, libRes] = await Promise.all([
        supabase
          .rpc("search_document_chunks_hybrid", {
            query_terms: terms,
            query_embedding: queryEmbedding,
            match_document_ids: documentIds,
            // Wider first-pass net so the right material reaches the AI up front.
            match_count: manuallySelected ? 30 : 24,
          })
          .abortSignal(controller.signal),
        manuallySelected
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .rpc("search_library_chunks_hybrid", {
                query_terms: terms,
                query_embedding: queryEmbedding,
                match_discipline: profile.discipline ?? null,
                match_count: 12,
              })
              .abortSignal(controller.signal),
      ]);

      if (ownRes.error) {
        console.warn("chunk search failed; falling back to document preview", ownRes.error);
      }
      const ownDocs =
        ownRes.data && ownRes.data.length > 0
          ? docsFromChunkRows(ownRes.data as ChunkSearchRow[])
          : [];
      const libraryDocs =
        libRes.data && libRes.data.length > 0
          ? docsFromLibraryRows(libRes.data as LibraryChunkRow[])
          : [];
      const merged = [...ownDocs, ...libraryDocs];
      if (merged.length > 0) {
        return { docs: merged, noLibraryMatch: false, noMatchScope: null };
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

  const send = async (
    text?: string,
    opts?: { baseMessages?: DisplayMessage[]; priorVersions?: AnswerVersion[] },
  ) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    // Edit-and-rerun passes an explicitly truncated history (everything before
    // the edited message) rather than relying on `messages` state having
    // already been updated synchronously, plus the answer versions carried
    // forward from before the edit.
    const baseMessages = opts?.baseMessages ?? messages;
    const priorVersions = opts?.priorVersions ?? [];
    // The fallback the assistant bubble reverts to if this rerun fails/cancels
    // before producing any new content - the last-known-good prior answer,
    // instead of just vanishing.
    const fallbackAssistantMessage: DisplayMessage | null =
      priorVersions.length > 0
        ? {
            role: "assistant",
            content: priorVersions[priorVersions.length - 1].content,
            source: priorVersions[priorVersions.length - 1].source,
            model: priorVersions[priorVersions.length - 1].model,
            webSources: priorVersions[priorVersions.length - 1].webSources,
            versions: priorVersions,
            activeVersion: priorVersions.length - 1,
          }
        : null;
    const restorePriorOrDrop = () => {
      setMessages((prev) => {
        if (!fallbackAssistantMessage) return prev.slice(0, -1);
        const copy = [...prev];
        if (copy.length > 0 && copy[copy.length - 1]?.role === "assistant") {
          copy[copy.length - 1] = fallbackAssistantMessage;
          return copy;
        }
        return [...prev, fallbackAssistantMessage];
      });
    };
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

    const next: DisplayMessage[] = [...baseMessages, { role: "user", content }];
    setMessages([
      ...next,
      {
        role: "assistant",
        content: "",
        ...(priorVersions.length > 0
          ? { versions: priorVersions, activeVersion: priorVersions.length }
          : {}),
      },
    ]);
    setStreaming(true);
    const requestController = new AbortController();
    chatAbortRef.current = requestController;

    const cid = await ensureConversation(content);
    if (!cid || requestController.signal.aborted) {
      if (requestController.signal.aborted) logTiming("response cancelled");
      setMessages(fallbackAssistantMessage ? [...next, fallbackAssistantMessage] : next);
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
      restorePriorOrDrop();
      setStreaming(false);
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      return;
    }

    if (requestController.signal.aborted) {
      logTiming("response cancelled");
      restorePriorOrDrop();
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
      const noMatchVersions: AnswerVersion[] =
        priorVersions.length > 0
          ? [
              ...priorVersions,
              { content: noMatchText, userContent: content, source: "library", model: "library-search" },
            ]
          : [];
      setMessages([
        ...next,
        {
          role: "assistant",
          content: noMatchText,
          source: "library",
          model: "library-search",
          ...(noMatchVersions.length > 0
            ? { versions: noMatchVersions, activeVersion: noMatchVersions.length - 1 }
            : {}),
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
          // The freshly-generated version isn't appended to `versions` until
          // it finishes (see onDone) - until then this just carries the prior
          // versions along so the nav row's data stays intact mid-stream.
          ...(priorVersions.length > 0
            ? { versions: priorVersions, activeVersion: priorVersions.length }
            : {}),
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
        restorePriorOrDrop();
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
          restorePriorOrDrop();
        },
        onCancel: finishCancelled,
        onDone: async () => {
          if (cancelled || requestController.signal.aborted) return;
          stopReveal();
          visibleAssistant = assistant;
          setAssistantMessage(assistant);
          if (priorVersions.length > 0) {
            // Finalize versioning: the just-finished answer becomes the newest
            // entry, appended after the versions carried over from the edit.
            const finalVersions: AnswerVersion[] = [
              ...priorVersions,
              { content: assistant, userContent: content, source: metaSource, model: metaModel, webSources },
            ];
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  versions: finalVersions,
                  activeVersion: finalVersions.length - 1,
                };
              }
              return copy;
            });
          }
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

  // ChatGPT-style edit: rewrite a sent question and rerun its answer. The old
  // answer (and its question) is kept as a browsable version rather than
  // being thrown away.
  const editUserMessage = (messageIndex: number, newText: string) => {
    if (streaming) return;
    const trimmed = newText.trim();
    const target = messages[messageIndex];
    if (!trimmed || target?.role !== "user") return;

    const truncated = messages.slice(0, messageIndex);
    const oldAssistant = messages[messageIndex + 1];
    let priorVersions: AnswerVersion[] = [];
    if (oldAssistant?.role === "assistant") {
      priorVersions =
        oldAssistant.versions && oldAssistant.versions.length > 0
          ? oldAssistant.versions
          : [
              {
                content: oldAssistant.content,
                userContent: target.content,
                source: oldAssistant.source,
                model: oldAssistant.model,
                webSources: oldAssistant.webSources,
              },
            ];
    }

    void send(trimmed, { baseMessages: truncated, priorVersions });
  };

  // Flips an assistant answer (and its paired question bubble) to a
  // previously-generated version.
  const setAnswerVersion = (assistantIndex: number, versionIndex: number) => {
    setMessages((prev) => {
      const assistantMsg = prev[assistantIndex];
      const versions = assistantMsg?.versions;
      if (!versions || versionIndex < 0 || versionIndex >= versions.length) return prev;

      const version = versions[versionIndex];
      const copy = [...prev];
      copy[assistantIndex] = {
        ...assistantMsg,
        content: version.content,
        source: version.source,
        model: version.model,
        webSources: version.webSources,
        activeVersion: versionIndex,
      };

      const userIndex = assistantIndex - 1;
      const userMsg = copy[userIndex];
      if (userMsg?.role === "user") {
        copy[userIndex] = { ...userMsg, content: version.userContent };
      }

      return copy;
    });
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
    <div
      className="flex h-full min-h-0 flex-1 overflow-hidden bg-background min-w-0"
      style={CHAT_ACCENT_STYLE}
    >
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
              sidebarOpen
                ? "w-full px-3 py-2.5 text-sm font-medium"
                : "h-10 w-10 justify-center p-0"
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
                  className="gd-press hidden rounded-lg p-1.5 text-muted-foreground/55 transition-colors hover:text-foreground lg:inline-flex"
                  title={sidebarOpen ? "Hide chats" : "Show chats"}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  ) : (
                    <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
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
                <div className="hidden shrink-0 sm:block">
                  <SegmentedControl
                    style={ACCENT_SOURCE}
                    options={SOURCE_MODES}
                    value={sourceMode}
                    onChange={applySourceMode}
                    getLabel={(item) => SOURCE_SHORT[item]}
                    getTitle={(item) => item}
                  />
                </div>
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
                  className="hidden shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-pop/10 hover:text-pop disabled:opacity-40 sm:inline-flex"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </button>
              </>
              <SegmentedControl
                style={ACCENT_MODE}
                className="chat-mode-selector shrink-0"
                options={CHAT_MODES}
                value={mode}
                onChange={setMode}
                getIcon={(m) =>
                  m === "Storytelling" ? (
                    <BookText className="h-3 w-3" />
                  ) : m === "Visuals" ? (
                    <Sparkles className="h-3 w-3" />
                  ) : null
                }
                getTitle={(m) =>
                  m === "Visuals"
                    ? "Create an animated visual explanation"
                    : m === "Storytelling"
                      ? "Explain as a story"
                      : m === "Detailed"
                        ? "Concepts + deeper detail"
                        : "Plain English with an analogy"
                }
              />
              {messages.length > 0 && (
                <button
                  onClick={copyContinuationPrompt}
                  title="Copy a prompt to continue this chat in another AI"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-pop/10 hover:text-pop"
                >
                  {handoffCopied ? (
                    <Check className="h-3.5 w-3.5 text-pop" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  {handoffCopied ? "Copied" : "Continue elsewhere"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollerRef} className="gd-chat-glow min-h-0 flex-1 overflow-y-auto">
          <div
            className="mx-auto max-w-3xl px-3 pt-4 sm:px-4 md:px-8 md:pt-8"
            style={{ paddingBottom: (composerHeight || 150) + 24 }}
          >
            {loadingConvo && messages.length === 0 ? (
              <div className="flex justify-center py-12">
                <LoadingDots size="md" className="text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <>
                {user && !savedProfile?.personalization_background && !personalizationDismissed && (
                  <PersonalizationCard
                    initialBackground={savedProfile?.personalization_background ?? ""}
                    onSave={savePersonalizationBackground}
                    onDismiss={() => setPersonalizationDismissed(true)}
                  />
                )}
                <EmptyState name={profile.name || "there"} onPick={(s) => send(s)} mode={mode} />
              </>
            ) : (
              <div className="space-y-8 sm:space-y-10">
                {messages.map((m, i) => (
                  <div key={i} className="gd-msg-in">
                    <Message
                      msg={m}
                      profile={profile}
                      mode={mode}
                      isLast={i === messages.length - 1}
                      streaming={streaming && i === messages.length - 1}
                      canEdit={!streaming}
                      hasDocuments={selectedDocs.length > 0}
                      onEditUserMessage={(newText) => editUserMessage(i, newText)}
                      onVersionChange={(versionIndex) => setAnswerVersion(i, versionIndex)}
                    />
                  </div>
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
            {/* Mobile: collapsed style/source pills that expand to pick, then
                shrink back to a small bubble showing the selection. */}
            <div className="mb-2 md:hidden">
              {expandedSelector === "style" ? (
                <SegmentedControl
                  style={ACCENT_MODE}
                  className="selector-reveal"
                  options={CHAT_MODES}
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    setExpandedSelector(null);
                  }}
                  getIcon={(m) =>
                    m === "Storytelling" ? (
                      <BookText className="h-3 w-3" />
                    ) : m === "Visuals" ? (
                      <Sparkles className="h-3 w-3" />
                    ) : null
                  }
                />
              ) : expandedSelector === "source" ? (
                <SegmentedControl
                  style={ACCENT_SOURCE}
                  className="selector-reveal"
                  options={SOURCE_MODES}
                  value={sourceMode}
                  getLabel={(item) => SOURCE_SHORT[item]}
                  onChange={(item) => {
                    applySourceMode(item);
                    setExpandedSelector(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedSelector("style")}
                    title={`Answer style: ${mode}`}
                    style={ACCENT_MODE}
                    className="gd-press inline-flex shrink-0 items-center gap-1 rounded-full border border-pop/40 bg-pop/[0.1] px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-pop/20"
                  >
                    {mode === "Storytelling" && <BookText className="h-3 w-3 text-pop" />}
                    {mode === "Visuals" && <Sparkles className="h-3 w-3 text-pop" />}
                    {MODE_SHORT[mode]}
                    <ChevronDown className="h-3 w-3 text-pop" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedSelector("source")}
                    title={`Sources: ${sourceMode}`}
                    style={ACCENT_SOURCE}
                    className="gd-press inline-flex shrink-0 items-center gap-1 rounded-full border border-pop/40 bg-pop/[0.1] px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-pop/20"
                  >
                    <FileText className="h-3 w-3 text-pop" />
                    {SOURCE_SHORT[sourceMode]}
                    <ChevronDown className="h-3 w-3 text-pop" />
                  </button>
                  {useLibrary && (
                    <button
                      type="button"
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
                      title={
                        selectedDocs.length > 0
                          ? selectedDocs.map((doc) => doc.file_name).join(", ")
                          : "Choose files to search"
                      }
                      className="inline-flex min-w-0 shrink items-center gap-1 rounded-full border border-border/70 bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-foreground/[0.04]"
                    >
                      <BookOpen className="h-3 w-3 shrink-0 text-primary" />
                      <span className="max-w-[8rem] truncate">
                        {selectedDocs.length > 0
                          ? `${selectedDocs[0]?.file_name}${selectedDocs.length > 1 ? ` +${selectedDocs.length - 1}` : ""}`
                          : "Add files"}
                      </span>
                      {selectedDocs.length > 0 ? (
                        <X
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDocIds([]);
                          }}
                        />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={copyContinuationPrompt}
                      title="Copy a prompt to continue this chat in another AI"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-pop/25 bg-pop/[0.06] px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-pop/10"
                    >
                      {handoffCopied ? (
                        <Check className="h-3 w-3 text-pop" />
                      ) : (
                        <ExternalLink className="h-3 w-3 text-pop" />
                      )}
                      {handoffCopied ? "Copied" : "Continue elsewhere"}
                    </button>
                  )}
                </div>
              )}
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
              <div className="mb-2 hidden rounded-2xl border border-border/70 bg-background/85 px-3 py-2 md:block">
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
              className="rounded-[1.35rem] border border-border/80 bg-background/95 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur-xl transition-colors focus-within:border-pop/45 focus-within:ring-1 focus-within:ring-pop/25"
            >
              <div className="flex items-end gap-1.5 sm:gap-2">
                {speechSupported && (
                  <button
                    type="button"
                    onClick={toggleVoiceInput}
                    title={listening ? "Stop voice input" : "Use voice input"}
                    aria-pressed={listening}
                    aria-label={listening ? "Stop voice input" : "Start voice input"}
                    className={`gd-press inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border transition-colors ${
                      listening
                        ? "border-transparent bg-pop text-pop-foreground shadow-pop ring-2 ring-pop/30"
                        : "border-border/70 bg-background text-muted-foreground hover:border-pop/40 hover:bg-pop/[0.06] hover:text-pop"
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
                    window.dispatchEvent(
                      new CustomEvent("gd:chat-scroll", { detail: { hide: false } }),
                    );
                  }}
                  onBlur={() => setIsInputFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  autoCapitalize={nativeApp ? "none" : "sentences"}
                  autoCorrect={nativeApp ? "off" : "on"}
                  autoComplete="off"
                  spellCheck={!nativeApp}
                  rows={1}
                  placeholder="Ask for an explanation, source, example, or exam question..."
                  className="min-h-[44px] max-h-[180px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm focus:outline-none sm:px-3"
                  style={{ height: "auto" }}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 200) + "px";
                  }}
                />
                <button
                  type="button"
                  onClick={() => applySourceMode(webSearch ? "My files only" : "Files + general")}
                  title={webSearch ? "General context on" : "Add general context"}
                  aria-pressed={webSearch}
                  aria-label={webSearch ? "Turn general context off" : "Turn general context on"}
                  style={ACCENT_GENERAL}
                  className={`gd-press inline-flex h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors sm:px-3.5 ${
                    webSearch
                      ? "border-transparent bg-pop text-pop-foreground shadow-pop ring-2 ring-pop/40"
                      : "border-border/70 bg-background text-muted-foreground hover:border-pop/60 hover:text-foreground"
                  }`}
                >
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">{webSearch ? "General" : "Context"}</span>
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
                    className="btn-pop h-[44px] w-[44px] flex items-center justify-center rounded-xl"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
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
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/45"
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
  const icons = [Search, BookOpen, Layers, Sparkles];

  return (
    <div className="flex flex-col items-center py-12 text-center sm:py-20">
      <div className="gd-mark-halo mb-6">
        <AiMark size="lg" />
      </div>
      <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-[2.75rem] sm:leading-[1.05]">
        Ready when you are, <span className="gd-name-accent">{name}</span>
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
        Ask anything about your material — I'll cite your files, explain it your way, and sketch a
        quick diagram when it helps.
      </p>
      <div className="mx-auto mt-9 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {suggestions.map((s, i) => {
          const Icon = icons[i % icons.length];
          return (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-surface/50 p-4 text-left text-sm leading-snug text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-pop/40 hover:bg-pop/[0.05] hover:shadow-[0_12px_32px_-20px_rgba(0,0,0,0.45)] active:translate-y-0 active:scale-[0.99]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pop/10 text-pop transition-colors group-hover:bg-pop group-hover:text-pop-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 font-medium">{s}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-pop" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// In-chat callout that teaches the student to bring their "who I am" summary
// from another AI into G&D. Shows why, the how-to steps, a one-tap-copy prompt,
// and a box to paste the reply back — which we save to their profile.
function PersonalizationCard({
  initialBackground,
  onSave,
  onDismiss,
}: {
  initialBackground: string;
  onSave: (text: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(initialBackground);
  const [saving, setSaving] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PERSONALIZATION_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy automatically — select the text and copy it.");
    }
  };

  const save = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(draft.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative mx-auto mb-6 max-w-2xl overflow-hidden rounded-2xl border border-pop/25 bg-pop/[0.04] p-4 text-left sm:p-5">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-1.5 text-pop">
        <Sparkles className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
          Personalize G&amp;D
        </span>
      </div>
      <h3 className="mt-2 text-lg font-semibold tracking-[-0.01em] text-foreground">
        Make G&amp;D understand you from day one
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Already study with another AI? It has learned how you think and where you struggle. Bring
        that over so every G&amp;D answer is tailored to you — no starting from scratch.
      </p>

      <ol className="mt-3 space-y-1.5 text-sm text-foreground">
        <li className="flex gap-2">
          <span className="font-semibold text-pop">1.</span> Copy the prompt below.
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-pop">2.</span> Paste it into the AI you already study
          with (ChatGPT, etc.).
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-pop">3.</span> Copy its reply and paste it in the box.
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-pop">4.</span> Save — and you're personalized.
        </li>
      </ol>

      <div className="mt-3 rounded-xl border border-border/70 bg-background/70 p-3">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
          {PERSONALIZATION_PROMPT}
        </p>
        <button
          type="button"
          onClick={copyPrompt}
          className="btn-pop mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder="Paste what your AI said about you here…"
        className="mt-3 w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!draft.trim() || saving}
          className="btn-pop inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold"
        >
          {saving ? "Saving…" : "Save background"}
        </button>
      </div>
    </div>
  );
}

// Steps shown while an answer is being prepared. They advance on a timer so
// the loader reads as real progress, then hold on "Writing your answer…" until
// the first streamed token replaces the whole loader.
const GROUNDED_LOADER_STEPS = [
  "Reading your material",
  "Pulling the strongest sources",
  "Writing your answer",
];
const GENERAL_LOADER_STEPS = ["Thinking it through", "Writing your answer"];

function AnswerLoader({ grounded }: { grounded: boolean }) {
  const steps = grounded ? GROUNDED_LOADER_STEPS : GENERAL_LOADER_STEPS;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= steps.length - 1) return;
    const timer = window.setTimeout(
      () => setStep((current) => Math.min(current + 1, steps.length - 1)),
      1500,
    );
    return () => window.clearTimeout(timer);
  }, [step, steps.length]);

  return (
    <div className="gd-answer-forming" aria-live="polite" aria-busy="true">
      <span className="gd-forming-status">
        <span className="gd-forming-orb" aria-hidden="true" />
        {/* key={step} re-mounts the word so its rise-in plays on each advance. */}
        <span key={step} className="gd-forming-label">
          {steps[step]}…
        </span>
      </span>
      <div className="gd-skeleton" aria-hidden="true">
        <span className="gd-skeleton-line" style={{ width: "100%" }} />
        <span className="gd-skeleton-line" style={{ width: "92%" }} />
        <span className="gd-skeleton-line" style={{ width: "74%" }} />
        <span className="gd-skeleton-line" style={{ width: "58%" }} />
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

// Animated segmented control: the active option is highlighted by a coloured
// "thumb" that slides between segments (Simplified → Detailed, My files → General)
// rather than snapping. Segments are equal-width so the thumb can be positioned
// purely by index, no measurement needed.
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  getIcon,
  getLabel,
  getTitle,
  className,
  style,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  getIcon?: (option: T) => ReactNode;
  getLabel?: (option: T) => string;
  getTitle?: (option: T) => string;
  className?: string;
  style?: CSSProperties;
}) {
  const count = options.length;
  const activeIndex = Math.max(0, options.indexOf(value));

  return (
    <div
      style={style}
      className={`relative flex rounded-xl border border-border/70 bg-foreground/[0.03] p-0.5 ${className ?? ""}`}
    >
      <span
        aria-hidden
        className="segmented-thumb pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-lg"
        style={{
          width: `calc((100% - 0.25rem) / ${count})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            title={getTitle?.(option)}
            onClick={() => onChange(option)}
            className={`relative z-10 flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-center text-xs font-medium transition-colors sm:px-2.5 ${
              active
                ? "text-pop-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {getIcon?.(option)}
            {getLabel ? getLabel(option) : option}
          </button>
        );
      })}
    </div>
  );
}

function SourceBadge({ source }: { source?: MessageSource }) {
  if (source === "visuals") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-pop/12 text-pop border border-pop/25">
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
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-leaf/12 text-leaf border border-leaf/30">
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

/** Small preview thumbnail for a web source's og:image, falling back to the favicon chip on load failure. */
function SourceThumbnail({ source, index }: { source: WebSource; index: number }) {
  const [failed, setFailed] = useState(false);
  const host = sourceHostname(source.url);
  const label = source.title || host || source.url;

  if (!source.image || failed) {
    return <SourceFavicon source={source} index={index} />;
  }

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={`Open web source ${index + 1}: ${label}`}
      className="group/thumb relative block h-24 w-36 shrink-0 overflow-hidden rounded-xl border border-border bg-foreground/[0.03] transition-colors hover:border-primary/35 sm:h-28 sm:w-44"
    >
      <img
        src={source.image}
        alt={label}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function WebSourceIcons({ sources }: { sources?: WebSource[] }) {
  if (!sources?.length) return null;

  const shown = sources.slice(0, 6);
  const withImages = shown.filter((source) => source.image).slice(0, 3);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {withImages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {withImages.map((source, index) => (
            <SourceThumbnail key={`thumb-${source.url}-${index}`} source={source} index={index} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((source, index) => (
          <SourceFavicon key={`${source.url}-${index}`} source={source} index={index} />
        ))}
      </div>
    </div>
  );
}

function WebSourceBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-pop/12 text-pop border border-pop/25">
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

function cleanAiResponseMarkdown(markdown: string): string {
  return markdown
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(\d)\s*\*\s*(\d)/g, "$1 x $2")
    .replace(/([A-Za-z])\s*\*\s*([A-Za-z])/g, "$1 x $2")
    .replace(/\*/g, "");
}

/**
 * Common capitalized words that START sentences or are otherwise NOT worth a web
 * lookup. Used to suppress false positives from the key-term heuristic below so
 * we don't underline generic openers like "This" or "However".
 */
const KEY_TERM_STOPWORDS = new Set([
  "the",
  "this",
  "that",
  "these",
  "those",
  "there",
  "then",
  "they",
  "their",
  "them",
  "here",
  "however",
  "therefore",
  "because",
  "although",
  "meanwhile",
  "overall",
  "finally",
  "first",
  "second",
  "third",
  "next",
  "note",
  "important",
  "example",
  "for",
  "and",
  "but",
  "with",
  "your",
  "you",
  "our",
  "when",
  "while",
  "what",
  "which",
  "where",
  "how",
  "why",
  "who",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const MAX_KEY_TERMS = 8;

/**
 * Lightweight, client-only heuristic that picks the most "searchable" phrases in
 * a FINISHED assistant answer — the ones worth offering a one-tap web lookup for.
 *
 * WHY heuristic (not NLP): this runs on every rendered answer with zero network
 * cost, so it must be cheap and predictable. We favour precision over recall —
 * better to underline 5 solid proper/technical nouns than 30 noisy ones.
 *
 * Rules:
 *  - Strip code fences, inline code, headings, and markdown links first so we
 *    never surface a term that lives inside them.
 *  - Match capitalized word runs ("Multiple Sclerosis") and ALL-CAPS acronyms
 *    ("MRI", "COPD").
 *  - Drop single capitalized words that merely open a sentence (likely just
 *    grammar, not a proper noun) and anything in KEY_TERM_STOPWORDS.
 *  - Rank multi-word phrases and acronyms first, then by frequency, and cap the
 *    result so an answer never lights up like a Christmas tree.
 *
 * LIMITS (honest): it misses lowercase domain jargon, over-matches ordinary
 * capitalized names (people, places), and is English/Latin-script only. That's
 * an accepted trade-off for a tap-only convenience feature.
 */
function detectKeyTerms(text: string): string[] {
  if (!text) return [];

  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ");

  // Capitalized run (2+ letters/word, up to 4 words) OR a 2-5 char ALL-CAPS acronym.
  const re =
    /\b([A-Z][a-zA-Z]{1,}(?:\s+[A-Z][a-zA-Z]{1,}){0,3}|[A-Z]{2,5})\b/g;

  type Candidate = { term: string; count: number; multiword: boolean };
  const byKey = new Map<string, Candidate>();
  let match: RegExpExecArray | null;

  while ((match = re.exec(cleaned)) !== null) {
    const term = match[1].trim();
    const words = term.split(/\s+/);
    const multiword = words.length > 1;
    const isAcronym = /^[A-Z]{2,5}$/.test(term);

    // A lone capitalized word that opens a sentence is usually just grammar.
    if (!multiword && !isAcronym) {
      const preceding = cleaned.slice(0, match.index).trimEnd();
      const atSentenceStart = preceding === "" || /[.!?:;]$/.test(preceding);
      if (atSentenceStart) continue;
      if (KEY_TERM_STOPWORDS.has(term.toLowerCase())) continue;
      if (term.length < 4) continue; // skip short one-off caps like "Dr" or initials
    }
    if (KEY_TERM_STOPWORDS.has(term.toLowerCase())) continue;

    const key = term.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { term, count: 1, multiword });
  }

  return Array.from(byKey.values())
    .sort((a, b) => {
      if (a.multiword !== b.multiword) return a.multiword ? -1 : 1;
      if (a.count !== b.count) return b.count - a.count;
      return b.term.length - a.term.length;
    })
    .slice(0, MAX_KEY_TERMS)
    .map((candidate) => candidate.term);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single case-sensitive regex that matches any detected term, longest
 * first (so "Multiple Sclerosis" wins over "Multiple"). Returns null when there
 * are no terms so callers can cheaply skip wrapping entirely.
 */
function buildTermRegex(terms: string[]): RegExp | null {
  if (!terms.length) return null;
  const ordered = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`\\b(?:${ordered.join("|")})\\b`, "g");
}

/**
 * Split a raw text node and wrap the FIRST occurrence of each detected term in a
 * dotted-underline lookup button. Only the first hit per term is wrapped (the
 * shared `used` set enforces this across the whole answer) so we stay near the
 * ~8-term cap and keep the answer readable rather than peppered with buttons.
 */
function wrapStringWithTerms(
  text: string,
  termRegex: RegExp,
  used: Set<string>,
  onTermClick: (term: string, anchor: HTMLElement) => void,
): ReactNode {
  termRegex.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = termRegex.exec(text)) !== null) {
    const term = match[0];
    const termKey = term.toLowerCase();
    if (used.has(termKey)) continue; // already underlined this term once
    used.add(termKey);

    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <button
        key={`term-${key++}-${match.index}`}
        type="button"
        // Tap = lookup. We stop the click from bubbling to the container's
        // selection handler; a bare click carries no selection anyway, so the
        // inline-composer path stays untouched and the two features coexist.
        onClick={(event) => {
          event.stopPropagation();
          onTermClick(term, event.currentTarget);
        }}
        className="ai-term-trigger"
        title={`Look up "${term}"`}
      >
        {term}
      </button>,
    );
    last = match.index + term.length;
  }

  if (last === 0) return text; // nothing matched — return the plain string
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Recursively walk react-markdown children, wrapping detected terms in text
 * nodes. Never descends into <a> or <code> (we must not underline terms inside
 * links or code); other inline wrappers like <strong>/<em> are traversed so a
 * bolded term is still tappable.
 */
function wrapTermsInChildren(
  children: ReactNode,
  termRegex: RegExp | null,
  used: Set<string>,
  onTermClick: (term: string, anchor: HTMLElement) => void,
): ReactNode {
  if (!termRegex) return children;

  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return wrapStringWithTerms(child, termRegex, used, onTermClick);
    }
    if (isValidElement(child)) {
      if (child.type === "a" || child.type === "code") return child;
      const grandChildren = (child.props as { children?: ReactNode }).children;
      if (grandChildren == null) return child;
      return cloneElement(
        child,
        undefined,
        wrapTermsInChildren(grandChildren, termRegex, used, onTermClick),
      );
    }
    return child;
  });
}

function nodeToPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (isValidElement(node)) {
    return nodeToPlainText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

// Renders a ```mermaid code block as an inline diagram. Mermaid is heavy, so it
// is dynamically imported only when an answer actually contains a diagram - it
// never touches the initial bundle. Falls back to the raw code on any parse
// error (e.g. while the block is still streaming in), and re-renders when the
// app theme flips so the diagram always matches light/dark.
function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const isLight = document.documentElement.classList.contains("light");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isLight ? "neutral" : "dark",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(
          `gdm-${Math.random().toString(36).slice(2)}`,
          code,
        );
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, themeTick]);

  if (failed) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  if (svg == null) {
    return <div className="gd-mermaid gd-mermaid-loading">Drawing diagram…</div>;
  }
  return <div className="gd-mermaid" role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function selectionHasEditableTarget(range: Range): boolean {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const editable = element?.closest(
    "textarea,input,[contenteditable='true'],[contenteditable='plaintext-only']",
  );
  if (!editable) return false;
  if (editable instanceof HTMLTextAreaElement) return !editable.disabled && !editable.readOnly;
  if (editable instanceof HTMLInputElement) return !editable.disabled && !editable.readOnly;
  if (editable instanceof HTMLElement) return editable.isContentEditable;
  return false;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Clipboard copy failed");
}

function Message({
  msg,
  streaming,
  profile,
  mode,
  canEdit,
  hasDocuments,
  onEditUserMessage,
  onVersionChange,
}: {
  msg: DisplayMessage;
  profile: Profile;
  mode: ChatMode;
  isLast: boolean;
  streaming: boolean;
  canEdit?: boolean;
  // True when the pending answer is grounded in an uploaded/selected document,
  // so the step-by-step "reading material" loader is meaningful. When false the
  // question is general and we show only the clean bouncing-dot loader.
  hasDocuments?: boolean;
  onEditUserMessage?: (newText: string) => void;
  onVersionChange?: (versionIndex: number) => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(msg.content);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [inlineThreads, setInlineThreads] = useState<InlineThread[]>([]);
  const [inlineComposer, setInlineComposer] = useState<InlineComposerState | null>(null);
  const [inlineInput, setInlineInput] = useState("");
  // Key-term web-lookup popover. `termPopover` holds the open term + its screen
  // anchor; `termState` mirrors the lookup's streaming/final state for render.
  const [termPopover, setTermPopover] = useState<{
    term: string;
    top: number;
    left: number;
  } | null>(null);
  const [termState, setTermState] = useState<TermLookupState | null>(null);
  // Per-message cache so re-tapping a term is instant and never re-hits the web.
  const termCacheRef = useRef<Map<string, TermLookupState>>(new Map());
  // Tracks which term is live so a slow stream can't overwrite a newer selection.
  const activeTermRef = useRef<string | null>(null);
  // Lets us cancel an in-flight lookup when the popover closes or the term changes.
  const termAbortRef = useRef<AbortController | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inlineComposerRef = useRef<HTMLFormElement>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const visualParts = msg.source === "visuals" ? splitVisualMessage(msg.content) : null;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const htmlAnimation = !streaming ? visualParts?.html : null;
  const rawContent =
    msg.source === "visuals" && streaming
      ? "Building your animation preview..."
      : visualParts
        ? visualParts.markdown || "Animation preview ready."
        : msg.content;
  const displayContent = rawContent ? cleanAiResponseMarkdown(rawContent.replace(/—/g, " - ")) : "";

  // Only surface tappable key terms once the answer has FINISHED streaming — mid
  // stream the text is still shifting, and firing lookups then would be wasteful.
  const keyTerms = useMemo(
    () => (streaming ? [] : detectKeyTerms(displayContent)),
    [streaming, displayContent],
  );
  // One combined matcher for all detected terms (null when there are none, so the
  // markdown renderers can cheaply skip all term-wrapping work).
  const termRegex = useMemo(() => buildTermRegex(keyTerms), [keyTerms]);

  const closeTermPopover = () => {
    termAbortRef.current?.abort();
    termAbortRef.current = null;
    activeTermRef.current = null;
    setTermPopover(null);
    setTermState(null);
  };

  const handleTermClick = (term: string, anchor: HTMLElement) => {
    // Position the popover just under the tapped term, clamped to the viewport.
    const rect = anchor.getBoundingClientRect();
    const popoverWidth = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, rect.left));
    const top = Math.min(window.innerHeight - 120, rect.bottom + 8);

    // Cancel any lookup still streaming for a previous term.
    termAbortRef.current?.abort();
    activeTermRef.current = term;
    setTermPopover({ term, top, left });

    const cached = termCacheRef.current.get(term);
    if (isTermLookupComplete(cached)) {
      // Instant path — we already have a finished blurb for this term.
      setTermState(cached ?? null);
      return;
    }

    const controller = new AbortController();
    termAbortRef.current = controller;
    lookupTerm({
      term,
      profile,
      signal: controller.signal,
      onUpdate: (state) => {
        // Always keep the cache warm; only paint if this term is still the live one.
        termCacheRef.current.set(term, state);
        if (activeTermRef.current === term) setTermState(state);
      },
    });
  };

  // Dismiss the term popover on outside tap or Esc (touch-friendly + keyboard).
  useEffect(() => {
    if (!termPopover) return;

    const dismissOnOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Element | null;
      // Ignore taps on the popover itself or on another term (which opens its own).
      if (target?.closest(".ai-term-popover")) return;
      if (target?.closest(".ai-term-trigger")) return;
      closeTermPopover();
    };
    const dismissOnEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTermPopover();
    };

    window.addEventListener("mousedown", dismissOnOutside);
    window.addEventListener("touchstart", dismissOnOutside);
    window.addEventListener("keydown", dismissOnEsc);
    return () => {
      window.removeEventListener("mousedown", dismissOnOutside);
      window.removeEventListener("touchstart", dismissOnOutside);
      window.removeEventListener("keydown", dismissOnEsc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termPopover]);

  // Abort any in-flight lookup if the message unmounts.
  useEffect(() => {
    return () => termAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!inlineComposer) return;

    const dismissOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".ai-inline-composer")) return;
      closeInlineComposer();
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
          current.map((thread) => (thread.id === id ? { ...thread, loading: false } : thread)),
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
      selectedRangeRef.current = range.cloneRange();
      setInlineInput("");
      setInlineComposer({ selectedText, top, left, canCut: selectionHasEditableTarget(range) });
    }, 0);
  };

  const closeInlineComposer = () => {
    setInlineComposer(null);
    selectedRangeRef.current = null;
  };

  const clearInlineSelection = () => {
    window.getSelection()?.removeAllRanges();
    selectedRangeRef.current = null;
  };

  const copyInlineSelection = async () => {
    if (!inlineComposer) return;

    try {
      await copyTextToClipboard(inlineComposer.selectedText);
      toast.success("Copied selection");
      closeInlineComposer();
      clearInlineSelection();
    } catch (error) {
      console.error("copy selection", error);
      toast.error("Couldn't copy selection");
    }
  };

  const cutInlineSelection = () => {
    if (!inlineComposer?.canCut || !selectedRangeRef.current) return;

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectedRangeRef.current);
    const cut = document.execCommand("cut");

    if (cut) {
      toast.success("Cut selection");
      closeInlineComposer();
      clearInlineSelection();
    } else {
      toast.error("Couldn't cut selection");
    }
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
    closeInlineComposer();
    setInlineInput("");
    window.getSelection()?.removeAllRanges();
    streamInlineAnswer(id, thread.selectedText, prompt);
  };

  const renderInlineComposerForm = (placement: "inline" | "floating") => {
    if (!inlineComposer) return null;

    return (
      <form
        ref={placement === "floating" ? inlineComposerRef : undefined}
        onSubmit={submitInlinePrompt}
        style={
          placement === "floating"
            ? { top: inlineComposer.top, left: inlineComposer.left }
            : undefined
        }
        className={
          placement === "floating"
            ? "ai-inline-composer fixed z-50 hidden w-[320px] flex-col gap-1.5 rounded-xl border border-border/70 bg-background/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl md:flex"
            : "ai-inline-composer my-3 flex max-h-[42dvh] w-full flex-col gap-1.5 rounded-2xl border border-border/70 bg-background/95 p-2 shadow-[0_12px_34px_rgba(0,0,0,0.14)] backdrop-blur-xl md:hidden"
        }
      >
        <div className="max-h-16 overflow-y-auto border-b border-border/50 px-2 py-1 text-[11px] italic leading-normal text-muted-foreground select-none">
          "{inlineComposer.selectedText.replace(/â€”/g, " - ")}"
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Copy selection"
            aria-label="Copy selection"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void copyInlineSelection()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={
              inlineComposer.canCut ? "Cut selection" : "Cut is only available in editable text"
            }
            aria-label="Cut selection"
            onPointerDown={(event) => event.preventDefault()}
            onClick={cutInlineSelection}
            disabled={!inlineComposer.canCut}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Scissors className="h-3.5 w-3.5" />
          </button>
          <input
            autoFocus={placement === "floating"}
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
            onClick={closeInlineComposer}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    );
  };

  const renderInlineMarkdown = () => {
    if (!displayContent) {
      // A single loader that reads as an answer forming. Grounded questions get
      // material-aware step wording; general questions get a shorter sequence.
      // The steps actually advance (see AnswerLoader), unlike the old static list.
      return <AnswerLoader grounded={Boolean(hasDocuments)} />;
    }

    // Wrap detected key terms in dotted-underline lookup buttons. `termUsed` is
    // shared across every markdown segment of THIS answer so each term is only
    // underlined on its first occurrence (keeps the answer readable, not noisy).
    const termUsed = new Set<string>();
    const termComponents: Components = {
      // A ```mermaid fenced block renders as an inline diagram instead of code.
      pre({ node, children, ...props }) {
        void node;
        const first = Children.toArray(children)[0];
        if (isValidElement(first)) {
          const cls = (first.props as { className?: string }).className ?? "";
          if (/\blanguage-mermaid\b/.test(cls)) {
            const codeText = nodeToPlainText(
              (first.props as { children?: ReactNode }).children,
            ).trim();
            if (codeText) return <MermaidDiagram code={codeText} />;
          }
        }
        return <pre {...props}>{children}</pre>;
      },
      // Every paragraph gets key-term wrapping (a no-op when there are no
      // terms), so this is safe whether or not termRegex is set.
      p({ node, children, ...props }) {
        void node;
        return (
          <p {...props}>{wrapTermsInChildren(children, termRegex, termUsed, handleTermClick)}</p>
        );
      },
      ...(termRegex
        ? {
            li({ node, children, ...props }) {
              void node;
              return (
                <li {...props}>
                  {wrapTermsInChildren(children, termRegex, termUsed, handleTermClick)}
                </li>
              );
            },
            td({ node, children, ...props }) {
              void node;
              return (
                <td {...props}>
                  {wrapTermsInChildren(children, termRegex, termUsed, handleTermClick)}
                </td>
              );
            },
            th({ node, children, ...props }) {
              void node;
              return (
                <th {...props}>
                  {wrapTermsInChildren(children, termRegex, termUsed, handleTermClick)}
                </th>
              );
            },
            blockquote({ node, children, ...props }) {
              void node;
              return (
                <blockquote {...props}>
                  {wrapTermsInChildren(children, termRegex, termUsed, handleTermClick)}
                </blockquote>
              );
            },
          }
        : {}),
    };
    const renderMd = (content: string, key?: string) => (
      <ReactMarkdown key={key} remarkPlugins={REMARK_PLUGINS} components={termComponents}>
        {content}
      </ReactMarkdown>
    );

    if (!inlineThreads.length && !inlineComposer) {
      return renderMd(displayContent);
    }

    const ordered = [
      ...inlineThreads.map((thread, order) => ({
        kind: "thread" as const,
        key: thread.id,
        selectedText: thread.selectedText,
        thread,
        order,
        position: displayContent.indexOf(thread.selectedText),
      })),
      ...(inlineComposer
        ? [
            {
              kind: "composer" as const,
              key: "active-composer",
              selectedText: inlineComposer.selectedText,
              order: inlineThreads.length,
              position: displayContent.indexOf(inlineComposer.selectedText),
            },
          ]
        : []),
    ].sort((a, b) => {
      if (a.position === b.position) return a.order - b.order;
      if (a.position === -1) return 1;
      if (b.position === -1) return -1;
      return a.position - b.position;
    });
    const rendered: ReactNode[] = [];
    const unattached: InlineThread[] = [];
    let cursor = 0;

    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      const { position } = item;
      if (position === -1 || position < cursor) {
        if (item.kind === "thread") unattached.push(item.thread);
        continue;
      }

      if (position > cursor) {
        rendered.push(
          renderMd(displayContent.slice(cursor, position), `before-${item.key}`),
        );
      }

      const anchoredItems = [item];
      while (
        index + 1 < ordered.length &&
        ordered[index + 1].position === position &&
        ordered[index + 1].selectedText === item.selectedText
      ) {
        index += 1;
        anchoredItems.push(ordered[index]);
      }

      rendered.push(
        <mark key={`mark-${item.key}`} className="ai-inline-selection">
          {displayContent.slice(position, position + item.selectedText.length)}
        </mark>,
      );
      anchoredItems.forEach((anchoredItem) => {
        if (anchoredItem.kind === "composer") {
          rendered.push(
            <div key="active-inline-composer">{renderInlineComposerForm("inline")}</div>,
          );
          return;
        }

        const anchoredThread = anchoredItem.thread;
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
              setInlineThreads((current) => current.filter((item) => item.id !== anchoredThread.id))
            }
          />,
        );
      });
      cursor = position + item.selectedText.length;
    }

    if (cursor < displayContent.length) {
      rendered.push(
        renderMd(displayContent.slice(cursor), "after-inline-threads"),
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

    if (inlineComposer && displayContent.indexOf(inlineComposer.selectedText) === -1) {
      rendered.push(
        <div key="unattached-inline-composer">{renderInlineComposerForm("inline")}</div>,
      );
    }

    return rendered;
  };

  if (msg.role === "user") {
    const startEdit = () => {
      if (!canEdit) return;
      setEditDraft(msg.content);
      setIsEditing(true);
    };
    const cancelEdit = () => {
      setIsEditing(false);
      setEditDraft(msg.content);
    };
    const saveEdit = () => {
      const trimmed = editDraft.trim();
      if (!trimmed) return;
      setIsEditing(false);
      if (trimmed !== msg.content) onEditUserMessage?.(trimmed);
    };

    if (isEditing) {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[88%] rounded-2xl rounded-br-md border border-primary/40 bg-background px-3.5 py-2.5 shadow-sm sm:max-w-[85%] sm:px-4">
            <textarea
              ref={editTextareaRef}
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              rows={1}
              className="min-h-[24px] max-h-[240px] w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none"
              style={{ height: "auto" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 240) + "px";
              }}
            />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!editDraft.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Check className="h-3 w-3" />
                Save
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="group/user flex items-start gap-2">
        {canEdit && onEditUserMessage && (
          <button
            type="button"
            onClick={startEdit}
            title="Edit message"
            aria-label="Edit message"
            className="order-2 mt-5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-100 transition-opacity hover:bg-pop/10 hover:text-pop focus-visible:opacity-100 sm:opacity-0 sm:group-hover/user:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="max-w-[760px] flex-1 rounded-2xl border border-border/60 bg-foreground/[0.02] px-4 py-3 text-[15px] leading-relaxed text-foreground break-words">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    // Full-width answer column, ChatGPT-style: no per-response avatar/logo gutter.
    <div className="group">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[-0.01em] text-foreground/80">
            <span
              className="inline-grid h-5 w-5 place-items-center rounded-md shadow-pop"
              style={{ background: "var(--gradient-pop)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            G&amp;D
          </span>
          {msg.source && msg.source !== "general" && <SourceBadge source={msg.source} />}
          {msg.webSources?.length ? <WebSourceBadge count={msg.webSources.length} /> : null}
        </div>
        <div
          ref={contentRef}
          onMouseUp={openInlineComposer}
          onKeyUp={openInlineComposer}
          onTouchEnd={openInlineComposer}
          className="ai-response-document medai-prose text-[16px]"
        >
          {renderInlineMarkdown()}
        </div>
        {termPopover && (
          <div
            className="ai-term-popover fixed z-50 w-[min(320px,calc(100vw-24px))] rounded-xl border border-border/70 bg-background/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl"
            style={{ top: termPopover.top, left: termPopover.left }}
            role="dialog"
            aria-label={`About ${termPopover.term}`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-foreground">{termPopover.term}</span>
              <button
                type="button"
                onClick={closeTermPopover}
                aria-label="Close"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {termState?.error ? (
              <p className="text-[12px] text-muted-foreground">
                Couldn't look that up right now.{" "}
                <a
                  className="text-primary underline"
                  href={`https://www.google.com/search?q=${encodeURIComponent(termPopover.term)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open web search
                </a>
              </p>
            ) : termState?.text ? (
              <p className="text-[12.5px] leading-relaxed text-foreground/90">{termState.text}</p>
            ) : (
              <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                <span className="gd-loading-bar w-24" />
                Searching the web...
              </div>
            )}
            {termState?.sources?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
                {termState.sources.slice(0, 3).map((source, index) => (
                  <a
                    key={`${source.url}-${index}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.05] px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    <span className="max-w-[150px] truncate">{source.title || source.url}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {inlineComposer && (
          <form
            ref={inlineComposerRef}
            onSubmit={submitInlinePrompt}
            style={{ top: inlineComposer.top, left: inlineComposer.left }}
            className="ai-inline-composer fixed z-50 hidden w-[320px] flex-col gap-1.5 rounded-xl border border-border/70 bg-background/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl md:flex"
          >
            <div className="text-[11px] text-muted-foreground px-2 py-1 max-h-16 overflow-y-auto border-b border-border/50 italic select-none leading-normal">
              "{inlineComposer.selectedText.replace(/—/g, " - ")}"
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Copy selection"
                aria-label="Copy selection"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void copyInlineSelection()}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={
                  inlineComposer.canCut ? "Cut selection" : "Cut is only available in editable text"
                }
                aria-label="Cut selection"
                onPointerDown={(event) => event.preventDefault()}
                onClick={cutInlineSelection}
                disabled={!inlineComposer.canCut}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
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
                onClick={closeInlineComposer}
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
        {msg.versions && msg.versions.length > 1 && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => onVersionChange?.(Math.max(0, (msg.activeVersion ?? 0) - 1))}
              disabled={(msg.activeVersion ?? 0) <= 0}
              title="Previous answer"
              aria-label="Previous answer"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums select-none">
              {(msg.activeVersion ?? 0) + 1} / {msg.versions.length}
            </span>
            <button
              type="button"
              onClick={() =>
                onVersionChange?.(
                  Math.min(msg.versions!.length - 1, (msg.activeVersion ?? 0) + 1),
                )
              }
              disabled={(msg.activeVersion ?? 0) >= msg.versions.length - 1}
              title="Next answer"
              aria-label="Next answer"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
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
          <blockquote className="ai-inline-quote">
            {thread.selectedText.replace(/—/g, " - ")}
          </blockquote>
          {thread.error ? (
            <p className="text-sm text-destructive">{thread.error}</p>
          ) : thread.response ? (
            <div className="medai-prose text-sm">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                {thread.response.replace(/—/g, " - ")}
              </ReactMarkdown>
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
