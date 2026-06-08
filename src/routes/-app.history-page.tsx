import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Clock, MessageSquare, Search, Trash2 } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

export function HistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const refresh = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(200);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return convos;
    return convos.filter((c) => (c.title || "New conversation").toLowerCase().includes(q));
  }, [convos, query]);

  const grouped = useMemo(() => {
    const today: ConversationRow[] = [];
    const week: ConversationRow[] = [];
    const older: ConversationRow[] = [];
    const now = Date.now();
    for (const c of filtered) {
      const t = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      const ageDays = (now - t) / (1000 * 60 * 60 * 24);
      if (ageDays < 1) today.push(c);
      else if (ageDays < 7) week.push(c);
      else older.push(c);
    }
    return { today, week, older };
  }, [filtered]);

  const open = (id: string) => navigate({ to: "/app/chat", search: { c: id } });

  const remove = async (id: string) => {
    if (!user) return;
    if (!confirm("Delete this chat?")) return;
    await supabase.from("messages").delete().eq("conversation_id", id);
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConvos((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-3 py-5 sm:px-4 sm:py-8 md:px-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="font-display text-4xl font-light leading-none sm:text-5xl">History</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:mt-1">
            Every conversation you've had with G&D.
          </p>
        </div>

        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations..."
            className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingDots size="md" className="text-primary" />
          </div>
        ) : convos.length === 0 ? (
          <div className="luxury-panel rounded-lg px-6 py-12 text-center">
            <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No conversations yet.</p>
            <button
              type="button"
              onClick={() => navigate({ to: "/app/chat", search: {} })}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              <MessageSquare className="h-4 w-4" />
              Start a Chat
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No conversations match "{query}".
          </p>
        ) : (
          <div className="space-y-6">
            <HistoryGroup title="Today" items={grouped.today} onOpen={open} onDelete={remove} />
            <HistoryGroup
              title="Last 7 days"
              items={grouped.week}
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
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <ul className="luxury-panel divide-y divide-border overflow-hidden rounded-lg">
        {items.map((c) => (
          <li
            key={c.id}
            className="group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-elevated/50 sm:px-4"
          >
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                <MessageSquare className="h-4 w-4 text-primary" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.title || "New conversation"}
                </span>
                {c.updated_at && (
                  <span className="block text-xs text-muted-foreground">
                    {new Date(c.updated_at).toLocaleString()}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(c.id)}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
              title="Delete chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
