import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, BookOpen, FileText, Link2, Sparkles, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { LoadingDots } from "@/components/loading-dots";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────

type Doc = {
  id: string;
  file_name: string;
  file_size: number | null;
  page_count: number | null;
  extract_status: string | null;
  created_at: string;
};

type SynthCluster = {
  title: string;
  match?: number;
  description?: string;
};

type SynthResult = {
  coreTheme?: string;
  nodes?: { label: string }[];
  interlinkCount?: number;
  clusters?: SynthCluster[];
  strongestLink?: { title: string; description?: string };
  themeOrigin?: { title: string; source?: string };
  surprise?: { title: string; description?: string };
};

const MAX_DOCS = 10;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CONNECT_URL = `${SUPABASE_URL}/functions/v1/connect-dots`;

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBytes(b: number | null) {
  if (!b) return "";
  const mb = b / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "ready") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
        Ready
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="rounded-full bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Processing
      </span>
    );
  }
  return (
    <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-500">
      {status === "rejected" ? "Too large" : "Failed"}
    </span>
  );
}

// ── Radial concept graph ───────────────────────────────────────────────────

function ConceptGraph({ nodes, coreTheme, interlinkCount }: { nodes: { label: string }[]; coreTheme?: string; interlinkCount?: number }) {
  const shown = nodes.slice(0, 6);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 rounded-full bg-surface-elevated px-3 py-1">
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="max-w-[160px] truncate font-mono text-[10px] text-muted-foreground">
            {coreTheme ? `Theme: ${coreTheme}` : "Synthesis"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {shown.length} Nodes · {interlinkCount ?? shown.length} Interlinks
        </span>
      </div>

      {/* Radial layout: nodes positioned around a circle via CSS transform */}
      <div className="relative mx-auto h-[280px] w-full max-w-[340px]">
        {shown.map((node, i) => {
          const angle = (i / Math.max(shown.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const r = 108;
          const cx = 50 + (Math.cos(angle) * r / 1.7);
          const cy = 50 + (Math.sin(angle) * r / 2.8);
          return (
            <div
              key={`${node.label}-${i}`}
              className="absolute flex h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-elevated p-1.5 text-center"
              style={{ left: `${cx}%`, top: `${cy}%` }}
            >
              <span className="line-clamp-2 text-[10px] leading-[1.3] text-muted-foreground">{node.label}</span>
            </div>
          );
        })}
        {/* Core node */}
        <div className="absolute left-1/2 top-1/2 flex h-[108px] w-[108px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-primary p-3 text-center">
          <span className="mb-0.5 font-mono text-[8px] uppercase tracking-widest text-primary-foreground/60">
            Core
          </span>
          <span className="line-clamp-2 text-sm font-semibold leading-tight text-primary-foreground">
            {coreTheme ?? "Synthesis"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function LinksPage() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [synthesizing, setSynthesizing] = useState(false);
  const [synth, setSynth] = useState<SynthResult | null>(null);
  // Track which doc IDs were used for the last synthesis so we know when to invalidate.
  const synthDocIds = useRef<string[]>([]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, file_size, page_count, extract_status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load your documents");
    } else {
      setDocs((data as Doc[]) ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const toggleDoc = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_DOCS) {
          toast.error(`You can select up to ${MAX_DOCS} documents`);
          return prev;
        }
        next.add(id);
      }
      // Invalidate synthesis if selection changes.
      setSynth(null);
      return next;
    });
  };

  const handleSynthesize = useCallback(
    async (force = false) => {
      if (selected.size === 0) return;
      const docIds = [...selected];
      setSynthesizing(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Please sign in again.");

        const resp = await fetch(CONNECT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ docIds, force }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || body.error) {
          throw new Error(body.error ?? "Synthesis failed. Please try again.");
        }
        synthDocIds.current = docIds;
        setSynth((body.result ?? {}) as SynthResult);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Synthesis failed. Please try again.");
      } finally {
        setSynthesizing(false);
      }
    },
    [selected],
  );

  const selectedArr = useMemo(() => [...selected], [selected]);
  const nodes = (synth?.nodes ?? []).slice(0, 6);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">

        {/* Header */}
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Academic Engine · Concept Interlinks
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold text-foreground sm:text-3xl">
          Cross-Document Synthesis
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Select up to {MAX_DOCS} documents and G&amp;D's AI connects the dots — surfacing shared
          themes that run across separate sources.
        </p>

        {/* Document selector */}
        <div className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your Library
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {selectedArr.length} / {MAX_DOCS} selected
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <LoadingDots />
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No documents yet.</p>
              <Link
                to="/app/library"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Upload to Library →
              </Link>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {docs.map((doc) => {
                const isSelected = selected.has(doc.id);
                const disabled = doc.extract_status === "rejected" || doc.extract_status === "error";
                return (
                  <button
                    key={doc.id}
                    onClick={() => !disabled && toggleDoc(doc.id)}
                    disabled={disabled}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? "border-primary/40 bg-primary/8 ring-1 ring-primary/20"
                        : disabled
                          ? "cursor-not-allowed border-border bg-surface-lowest opacity-50"
                          : "border-border bg-surface-lowest hover:border-primary/25 hover:bg-surface-elevated"
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        isSelected ? "border-primary bg-primary" : "border-border bg-transparent"
                      }`}
                    >
                      {isSelected && (
                        <svg className="h-2.5 w-2.5 text-primary-foreground" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-medium text-foreground">
                          {doc.file_name}
                        </span>
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={doc.extract_status} />
                        {doc.page_count ? (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {doc.page_count} pg
                          </span>
                        ) : null}
                        {fmtBytes(doc.file_size) ? (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {fmtBytes(doc.file_size)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Synthesize CTA */}
        {selectedArr.length > 0 && (
          <button
            onClick={() => handleSynthesize(Boolean(synth))}
            disabled={synthesizing}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {synthesizing ? (
              <>
                <LoadingDots />
                <span>Connecting the dots…</span>
              </>
            ) : synth ? (
              <>
                <Sparkles className="h-4 w-4" />
                Re-synthesize
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Connect the dots ({selectedArr.length})
              </>
            )}
          </button>
        )}

        {/* ── Synthesis results ── */}
        {synth ? (
          <div className="mt-6 flex flex-col gap-4">

            {/* Concept graph */}
            {nodes.length > 0 && (
              <ConceptGraph nodes={nodes} coreTheme={synth.coreTheme} interlinkCount={synth.interlinkCount} />
            )}

            {/* Strongest link */}
            {synth.strongestLink ? (
              <div className="rounded-xl bg-primary p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-primary-foreground/60">
                    Strongest Link
                  </span>
                  <Link2 className="h-4 w-4 text-primary-foreground/70" />
                </div>
                <p className="text-lg font-semibold text-primary-foreground">
                  {synth.strongestLink.title}
                </p>
                {synth.strongestLink.description ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-primary-foreground/75">
                    {synth.strongestLink.description}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Theme origin */}
            {synth.themeOrigin ? (
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Theme Origin
                  </span>
                  <Zap className="h-4 w-4 text-muted-foreground/50" />
                </div>
                <p className="text-lg font-semibold text-foreground">{synth.themeOrigin.title}</p>
                {synth.themeOrigin.source ? (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{synth.themeOrigin.source}</p>
                ) : null}
              </div>
            ) : null}

            {/* Surprise connection */}
            {synth.surprise ? (
              <div className="rounded-xl border border-primary/25 bg-surface p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-primary">
                    Unexpected Link
                  </span>
                  <Sparkles className="h-4 w-4 text-primary/70" />
                </div>
                <p className="text-lg font-semibold text-foreground">{synth.surprise.title}</p>
                {synth.surprise.description ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {synth.surprise.description}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Linked theme clusters */}
            {synth.clusters && synth.clusters.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Linked Theme Clusters
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                    {synth.clusters.length} Found
                  </span>
                </div>
                {synth.clusters.map((cluster, i) => (
                  <div key={`${cluster.title}-${i}`} className="flex gap-3 rounded-xl border border-border bg-surface p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Activity className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{cluster.title}</span>
                        {typeof cluster.match === "number" ? (
                          <span className="shrink-0 font-mono text-[10px] text-primary">
                            {cluster.match.toFixed(2)} match
                          </span>
                        ) : null}
                      </div>
                      {cluster.description ? (
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {cluster.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </>
            ) : null}

          </div>
        ) : null}

      </div>
    </div>
  );
}
