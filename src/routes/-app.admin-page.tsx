import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, BookMarked, Check, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { LoadingDots } from "@/components/loading-dots";
import type { Database } from "@/integrations/supabase/types";

type LibraryDoc = Database["public"]["Tables"]["library_documents"]["Row"];
type MyDoc = {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  page_count: number | null;
  suggested_subject: string | null;
};
type DiscChoice = "medicine" | "law" | "all";

const DISCIPLINE_LABEL: Record<string, string> = { medicine: "Medicine", law: "Law" };
const LIBRARY_APPROVAL_POINTS = 50;

function disciplineText(d: string | null): string {
  if (!d) return "All students";
  return DISCIPLINE_LABEL[d] ?? d;
}

export function AdminPage() {
  const { user, profile } = useAuth();
  const [pending, setPending] = useState<LibraryDoc[]>([]);
  const [approved, setApproved] = useState<LibraryDoc[]>([]);
  const [myDocs, setMyDocs] = useState<MyDoc[]>([]);
  const [discChoice, setDiscChoice] = useState<Record<string, DiscChoice>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isAdmin = profile?.is_admin === true;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [libRes, docRes] = await Promise.all([
        supabase
          .from("library_documents")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("documents")
          .select("id, file_name, file_type, file_size, page_count, suggested_subject")
          .order("created_at", { ascending: false }),
      ]);
      if (libRes.error) throw libRes.error;
      const rows = (libRes.data ?? []) as LibraryDoc[];
      setPending(rows.filter((r) => r.status === "pending"));
      setApproved(rows.filter((r) => r.status === "approved"));

      // Your own uploads that aren't already in the library, so you can add
      // them straight to the shared shelf.
      const alreadyShared = new Set(
        rows.map((r) => r.source_document_id).filter(Boolean) as string[],
      );
      setMyDocs(((docRes.data ?? []) as MyDoc[]).filter((d) => !alreadyShared.has(d.id)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const setStatus = async (doc: LibraryDoc, status: "approved" | "rejected") => {
    if (!user || busyId) return;
    setBusyId(doc.id);
    try {
      const { error } = await supabase
        .from("library_documents")
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq("id", doc.id);
      if (error) throw error;

      // On approval, copy the source document's chunks into the shared library
      // so the book becomes searchable immediately (reuses existing embeddings),
      // and reward the student who submitted it.
      if (status === "approved" && doc.source_document_id) {
        const { data: copied, error: promoteError } = await supabase.rpc(
          "promote_document_to_library",
          { p_library_id: doc.id, p_source_document_id: doc.source_document_id },
        );
        if (promoteError) throw promoteError;
        if (doc.submitted_by) {
          await supabase.rpc("award_library_points", {
            p_user_id: doc.submitted_by,
            p_points: LIBRARY_APPROVAL_POINTS,
          });
        }
        toast.success(`Approved "${doc.title}" — ${copied ?? 0} chunks added to the library.`);
      } else if (status === "approved") {
        toast.success(`Approved "${doc.title}".`);
      } else {
        toast.success(`Rejected "${doc.title}".`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the book");
    } finally {
      setBusyId(null);
    }
  };

  // Admin fast-path: add one of your own uploads straight into the shared
  // library (create -> approve -> ingest) with no review step.
  const addToLibrary = async (doc: MyDoc) => {
    if (!user || busyId) return;
    const choice = discChoice[doc.id] ?? "medicine";
    const discipline = choice === "all" ? null : choice;
    setBusyId(doc.id);
    try {
      const { data: inserted, error: insErr } = await supabase
        .from("library_documents")
        .insert({
          title: doc.file_name,
          file_name: doc.file_name,
          file_type: doc.file_type,
          file_size: doc.file_size,
          page_count: doc.page_count,
          subject: doc.suggested_subject,
          discipline,
          source_document_id: doc.id,
          submitted_by: user.id,
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      const { error: updErr } = await supabase
        .from("library_documents")
        .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq("id", inserted.id);
      if (updErr) throw updErr;

      const { data: copied, error: promErr } = await supabase.rpc(
        "promote_document_to_library",
        { p_library_id: inserted.id, p_source_document_id: doc.id },
      );
      if (promErr) throw promErr;

      if (!copied) {
        toast.warning(
          `Added "${doc.file_name}", but it has no indexed chunks yet — make sure it finished processing in your Library.`,
        );
      } else {
        toast.success(`Added "${doc.file_name}" to the library — ${copied} chunks searchable now.`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to the library");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (doc: LibraryDoc) => {
    if (busyId) return;
    setBusyId(doc.id);
    try {
      const { error } = await supabase.from("library_documents").delete().eq("id", doc.id);
      if (error) throw error;
      toast.success(`Removed "${doc.title}" from the library.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the book");
    } finally {
      setBusyId(null);
    }
  };

  // Gate: non-admins never see the queue (RLS also blocks the data server-side).
  if (profile && !isAdmin) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <BookMarked className="h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold text-foreground">Admins only</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page manages the shared textbook library. Your account doesn&apos;t have admin
          access.
        </p>
        <Link
          to="/app/chat"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-elevated"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chat
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pop">Admin</h2>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Shared library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review books students submit and manage what appears in everyone&apos;s library.
          Approve only material you have the right to share.
        </p>
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingDots size="lg" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Add your own uploads straight to the library */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              Add a textbook
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Your uploads that aren&apos;t in the library yet. Pick who it&apos;s for and add it —
              it goes live for students immediately. (Upload new books in the Library first so
              they get indexed.)
            </p>
            {myDocs.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
                No uploads to add.{" "}
                <Link to="/app/library" className="text-pop underline-offset-2 hover:underline">
                  Upload a textbook
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-3">
                {myDocs.map((doc) => {
                  const choice = discChoice[doc.id] ?? "medicine";
                  return (
                    <div key={doc.id} className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{doc.file_name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[doc.suggested_subject, doc.page_count ? `${doc.page_count} pages` : null]
                              .filter(Boolean)
                              .join(" · ") || "Ready to add"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                            {(["medicine", "law", "all"] as DiscChoice[]).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setDiscChoice((m) => ({ ...m, [doc.id]: d }))}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                                  choice === d
                                    ? "bg-pop/15 text-pop"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => void addToLibrary(doc)}
                            disabled={!!busyId}
                            className="btn-pop inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                          >
                            {busyId === doc.id ? <LoadingDots /> : <Plus className="h-3.5 w-3.5" />}
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Pending submissions */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              Pending review
              <span className="rounded-full bg-pop/12 px-2 py-0.5 text-xs font-medium text-pop">
                {pending.length}
              </span>
            </h3>
            {pending.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing waiting for review.
              </p>
            ) : (
              <div className="space-y-3">
                {pending.map((doc) => (
                  <DocCard key={doc.id} doc={doc} busy={busyId === doc.id}>
                    <button
                      type="button"
                      onClick={() => void setStatus(doc, "approved")}
                      disabled={!!busyId}
                      className="btn-pop inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void setStatus(doc, "rejected")}
                      disabled={!!busyId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </DocCard>
                ))}
              </div>
            )}
          </section>

          {/* Approved library */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              In the library
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {approved.length}
              </span>
            </h3>
            {approved.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
                No books in the shared library yet.
              </p>
            ) : (
              <div className="space-y-3">
                {approved.map((doc) => (
                  <DocCard key={doc.id} doc={doc} busy={busyId === doc.id}>
                    <button
                      type="button"
                      onClick={() => void remove(doc)}
                      disabled={!!busyId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-surface-elevated disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </DocCard>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DocCard({
  doc,
  busy,
  children,
}: {
  doc: LibraryDoc;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{doc.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{doc.file_name}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag>{disciplineText(doc.discipline)}</Tag>
            {doc.subject && <Tag>{doc.subject}</Tag>}
            {doc.track && <Tag>{doc.track}</Tag>}
            {doc.submitted_by && <Tag>Student submission</Tag>}
          </div>
          {doc.rights_note && (
            <p className="mt-2 text-xs text-muted-foreground">Rights: {doc.rights_note}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {busy && <LoadingDots />}
          {children}
        </div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}
