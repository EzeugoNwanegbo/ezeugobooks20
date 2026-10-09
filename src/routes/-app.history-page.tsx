import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRight, Clock, MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import "@/study-pages.css";
import { LoadingDots } from "@/components/loading-dots";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

// The sidebar already shows a "Recent" list (capped, titles only, no search -
// see SIDEBAR_CONVO_LIMIT in -app-shell.tsx). This page earns its keep by
// being the other two things: the *full* archive, and searchable by what was
// actually said, not just the title.
const HISTORY_LOAD_LIMIT = 1000;

// How long after the last keystroke we search message content server-side.
// Title filtering is instant (it just filters what's already loaded); this
// is the part that needs a network round trip.
const CONTENT_SEARCH_DEBOUNCE_MS = 300;

export function HistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // Conversation ids whose message content (not title) matched the current
  // search - the thing the sidebar's list has no way to do at all.
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set());

  const refresh = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(HISTORY_LOAD_LIMIT);
    if (error) {
      console.warn("load history", error);
      toast.error("Couldn't load your chat history");
    }
    setConvos((data as ConversationRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Search what was actually said, not just the conversation title.
  useEffect(() => {
    const q = query.trim();
    if (!user || q.length < 2) {
      setContentMatches(new Set());
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("user_id", user.id)
        .ilike("content", `%${q}%`)
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.warn("search message content", error);
        return;
      }
      setContentMatches(new Set((data ?? []).map((m) => m.conversation_id)));
    }, CONTENT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return convos;
    return convos.filter(
      (c) => (c.title || "New conversation").toLowerCase().includes(q) || contentMatches.has(c.id),
    );
  }, [convos, query, contentMatches]);

  const grouped = useMemo(() => {
    const today: ConversationRow[] = [];
    const yesterday: ConversationRow[] = [];
    const thisWeek: ConversationRow[] = [];
    const thisMonth: ConversationRow[] = [];
    const older: ConversationRow[] = [];
    const now = Date.now();
    for (const c of filtered) {
      const t = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      const ageDays = (now - t) / (1000 * 60 * 60 * 24);
      if (ageDays < 1) today.push(c);
      else if (ageDays < 2) yesterday.push(c);
      else if (ageDays < 7) thisWeek.push(c);
      else if (ageDays < 30) thisMonth.push(c);
      else older.push(c);
    }
    return { today, yesterday, thisWeek, thisMonth, older };
  }, [filtered]);

  const open = (id: string) => navigate({ to: "/app/chat", search: { c: id } });

  const remove = async (id: string) => {
    if (!user) return;
    if (!window.confirm("Delete this chat?")) return;
    await supabase.from("messages").delete().eq("conversation_id", id);
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConvos((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="gd-content-page gd-study-page min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          eyebrow="Your workspace"
          title="Conversations"
          subtitle="Keep a good explanation close. Find a previous chat and pick up where you left off."
          className="mb-6 sm:mb-8"
          actions={
            <button
              type="button"
              onClick={() => navigate({ to: "/app/chat", search: {} })}
              className="btn-pop inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" />
              New conversation
            </button>
          }
        />

        {convos.length > 0 && (
          <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Search conversations and messages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles and messages…"
                className="h-12 w-full rounded-xl border border-input bg-surface pl-10 pr-10 text-sm outline-none transition-colors focus:border-pop focus:ring-2 focus:ring-pop/20"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {query.trim() ? `${filtered.length} of ${convos.length}` : convos.length}{" "}
              {convos.length === 1 ? "conversation" : "conversations"}
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingDots size="md" className="text-primary" />
          </div>
        ) : convos.length === 0 ? (
          <div className="gd-study-empty">
            <span className="gd-study-empty-icon">
              <MessageSquare className="h-6 w-6" />
            </span>
            <h2 className="font-display text-2xl">Every question has a place.</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {user?.is_anonymous
                ? "Create an account to save your conversations and revisit explanations later."
                : "Your chats will be saved here, ready to revisit when you need an explanation again."}
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/app/chat", search: {} })}
              className="btn-pop mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
            >
              <MessageSquare className="h-4 w-4" />
              Ask your first question
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="gd-study-empty">
            <span className="gd-study-empty-icon">
              <Search className="h-6 w-6" />
            </span>
            <h2 className="text-base font-semibold">No conversations found</h2>
            <p className="mt-2 max-w-sm break-words text-sm text-muted-foreground">
              Try another word or clear “{query}” to see your full archive.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-5 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-surface-elevated"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <HistoryGroup title="Today" items={grouped.today} onOpen={open} onDelete={remove} />
            <HistoryGroup
              title="Yesterday"
              items={grouped.yesterday}
              onOpen={open}
              onDelete={remove}
            />
            <HistoryGroup
              title="This week"
              items={grouped.thisWeek}
              onOpen={open}
              onDelete={remove}
            />
            <HistoryGroup
              title="This month"
              items={grouped.thisMonth}
              onOpen={open}
              onDelete={remove}
            />
            <HistoryGroup title="Older" items={grouped.older} onOpen={open} onDelete={remove} />
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryGroup({
  title,
  items,
  onOpen,
  onDelete,
}: {
  title: string;
  items: ConversationRow[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        <Clock className="h-3.5 w-3.5 text-pop" />
        {title}
        <span className="ml-auto font-normal tabular-nums tracking-normal">{items.length}</span>
      </h2>
      <ul className="gd-history-list divide-y divide-border overflow-hidden">
        {items.map((c) => (
          <li
            key={c.id}
            className="gd-history-row group flex items-center gap-2 px-3 py-3 transition-colors hover:bg-surface-elevated/50 sm:gap-3 sm:px-5"
          >
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-pop/15 bg-pop/8">
                <MessageSquare className="h-4 w-4 text-pop" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.title || "New conversation"}
                </span>
                {c.updated_at && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {new Date(c.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    {" · "}
                    {new Date(c.updated_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </span>
              <ArrowRight className="gd-history-arrow hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(c.id)}
              className="shrink-0 rounded-lg p-2.5 text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              title="Delete chat"
              aria-label={`Delete ${c.title || "conversation"}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
