import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, BookMarked, Check, Cookie, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { LoadingDots } from "@/components/loading-dots";
import type { Database } from "@/integrations/supabase/types";
import { adminFindStudents, findStudentsByPrefix, type AdminFoundStudent } from "@/lib/social";
import {
  cookieDailyBaseFor,
  cookieGrantsFor,
  cookieSpentTodayFor,
  cookieStatusFor,
  type CookieStatus,
  createCookieGrant,
  type CookieGrantRow,
} from "@/lib/cookies";

type LibraryDoc = Database["public"]["Tables"]["library_documents"]["Row"];
type MyDoc = {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  page_count: number | null;
  suggested_subject: string | null;
};
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
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Cookies: find a student, see what today has gone on, grant more ────────
  //
  // find_students() (src/lib/social.ts, PART 1 of supabase/APPLY-PENDING.sql)
  // matches only opted-in-discoverable students, or the admin themselves - it
  // was built for the friend-search typeahead, not admin lookup, and reusing
  // it here means an admin cannot find a student who has kept their account
  // undiscoverable. That is a real gap the plan does not address; there is no
  // admin-only search RPC in the reviewed SQL to reach for instead.
  const [cookieQuery, setCookieQuery] = useState("");
  const [cookieResults, setCookieResults] = useState<AdminFoundStudent[]>([]);
  const [cookieSearching, setCookieSearching] = useState(false);
  const [cookieStudent, setCookieStudent] = useState<AdminFoundStudent | null>(null);
  // null distinguishes "not loaded yet" from "loaded, and it is zero" -
  // cookieBase specifically also means "the schema is not there" when null
  // AFTER a load has completed, which gates the grant form off below.
  const [cookieBase, setCookieBase] = useState<number | null>(null);
  const [cookieGrants, setCookieGrants] = useState<CookieGrantRow[] | null>(null);
  const [cookieSpentToday, setCookieSpentToday] = useState<number | null>(null);
  // The server's own breakdown, when cookie_status_for() exists. Null means
  // the fallback below is what is on screen.
  const [cookieStatus, setCookieStatus] = useState<CookieStatus | null>(null);
  const [cookieLoadedOnce, setCookieLoadedOnce] = useState(false);
  const [grantExtra, setGrantExtra] = useState("10");
  const [grantEndsOn, setGrantEndsOn] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);

  const isAdmin = profile?.is_admin === true;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [libRes, docRes] = await Promise.all([
        supabase.from("library_documents").select("*").order("created_at", { ascending: false }),
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
          // The product is free-for-all now — books are no longer split by
          // discipline. The column stays (some older rows still carry a
          // value), but anything added from here on is unmarked.
          discipline: null,
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

      const { data: copied, error: promErr } = await supabase.rpc("promote_document_to_library", {
        p_library_id: inserted.id,
        p_source_document_id: doc.id,
      });
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

  /**
   * Two lookups, tried in order, because they can reach different people.
   *
   * admin_find_students() is the right one: it matches part of a handle or part
   * of a display name and, crucially, does NOT skip students who have turned
   * discoverability off. Those are exactly the students who end up messaging on
   * WhatsApp for more cookies rather than being found by a classmate, so a
   * grant screen that cannot see them fails at the one job it has.
   *
   * findStudentsByPrefix() is the fallback for the window before
   * supabase/migrations/20260824140000_admin_find_students.sql is applied. It
   * finds fewer people - opted-in accounts only, handle prefixes only - but
   * finding some is better than an error, and it is what this screen used
   * before. Both return [] rather than throwing when their function is absent,
   * so the fallback is a plain empty check with nothing to catch.
   */
  const searchCookieStudents = async (value: string) => {
    setCookieQuery(value);
    // Mirrors admin_find_students()' own two-character minimum, only so a
    // shorter query does not cost a round trip to be told nothing.
    if (value.trim().length < 2) {
      setCookieResults([]);
      return;
    }
    setCookieSearching(true);
    try {
      const found = await adminFindStudents(value, 10);
      if (found.length > 0) {
        setCookieResults(found);
        return;
      }
      // The friend search has a three-character floor of its own, so there is
      // nothing to fall back TO below that.
      if (value.trim().length < 3) {
        setCookieResults([]);
        return;
      }
      setCookieResults(
        (await findStudentsByPrefix(value, 10)).map((student) => ({
          user_id: student.user_id,
          username: student.username,
          display_name: student.display_name,
          points: student.points,
          // Anything this search can see is discoverable by definition - that
          // is the filter it applies. Not a guess.
          discoverable: true,
        })),
      );
    } finally {
      setCookieSearching(false);
    }
  };

  const selectCookieStudent = async (student: AdminFoundStudent) => {
    setCookieStudent(student);
    setCookieResults([]);
    setCookieQuery("");
    setCookieBase(null);
    setCookieGrants(null);
    setCookieSpentToday(null);
    setCookieStatus(null);
    setCookieLoadedOnce(false);
    // Grants are always read directly - the admin needs the full history, not
    // just today's total, and cookie_status_for() returns only the total.
    const [status, grants] = await Promise.all([
      cookieStatusFor(student.user_id),
      cookieGrantsFor(student.user_id),
    ]);
    setCookieGrants(grants);
    if (status) {
      // The server did the arithmetic, including the earned ladder, in one
      // read. Nothing here recomputes it.
      setCookieStatus(status);
      setCookieBase(status.earned_base);
      setCookieSpentToday(status.spent_today);
      setCookieLoadedOnce(true);
      return;
    }
    // Fallback for the window before 20260824150000_cookie_ladder.sql is
    // applied: the flat floor plus today's rows, which is what this screen
    // showed before the ladder existed.
    const [base, spent] = await Promise.all([
      cookieDailyBaseFor(),
      cookieSpentTodayFor(student.user_id),
    ]);
    setCookieBase(base);
    setCookieSpentToday(spent);
    setCookieLoadedOnce(true);
  };

  const submitCookieGrant = async () => {
    if (!user || !cookieStudent || grantBusy) return;
    const extra = Math.round(Number(grantExtra));
    if (!Number.isFinite(extra) || extra <= 0) {
      toast.error("Enter how many extra cookies a day.");
      return;
    }
    setGrantBusy(true);
    try {
      const ok = await createCookieGrant({
        userId: cookieStudent.user_id,
        extraPerDay: extra,
        endsOn: grantEndsOn || null,
        note: grantNote,
        grantedBy: user.id,
      });
      if (!ok) {
        toast.error("Could not save the grant - cookies may not be set up in the database yet.");
        return;
      }
      toast.success(`+${extra} cookies a day for ${cookieStudent.display_name}.`);
      setGrantExtra("10");
      setGrantEndsOn("");
      setGrantNote("");
      setCookieGrants(await cookieGrantsFor(cookieStudent.user_id));
    } finally {
      setGrantBusy(false);
    }
  };

  // Today's allowance for the selected student = the flat base
  // (cookie_daily_base(), read live rather than hard-coded) plus every ACTIVE
  // grant's extra_per_day - "active" mirrors cookie_allowance()'s own SQL
  // (starts_on <= today AND (ends_on IS NULL OR ends_on >= today)) so this
  // number can never disagree with what the student's own ring shows.
  // cookieBase stays null (rather than 0) until a load finishes AND finds no
  // schema, which is what tells the form below to hide itself instead of
  // offering a grant that would silently fail to save.
  const todayKey = new Date().toISOString().slice(0, 10);
  const cookieActiveExtra = (cookieGrants ?? [])
    .filter((g) => g.starts_on <= todayKey && (!g.ends_on || g.ends_on >= todayKey))
    .reduce((sum, g) => sum + g.extra_per_day, 0);
  // cookie_status_for() already added the grants server-side, so trust it when
  // it answered. Adding cookieActiveExtra on top of it would double-count.
  const cookieAllowance =
    cookieStatus?.allowance ?? (cookieBase != null ? cookieBase + cookieActiveExtra : null);

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
          Review books students submit and manage what appears in everyone&apos;s library. Approve
          only material you have the right to share.
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
              Your uploads that aren&apos;t in the library yet. Adding one goes live for students
              immediately.
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
                {myDocs.map((doc) => (
                  <div key={doc.id} className="rounded-2xl border border-border bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{doc.file_name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[
                            doc.suggested_subject,
                            doc.page_count ? `${doc.page_count} pages` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Ready to add"}
                        </p>
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
                ))}
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

          {/* Cookies: without this the empty-state dialog's "call or WhatsApp
              us for more" promises something the product cannot deliver - see
              docs/cookies-and-milestones-plan.md. Detected, not assumed: the
              schema this reads and writes is applied by hand, same as
              everything else new here, so a student is shown "not set up yet"
              rather than a form that would silently fail to save. */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Cookie className="h-4 w-4 text-pop" />
              Cookies
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Find a student by handle to see their daily allowance and grant more.
            </p>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={cookieQuery}
                onChange={(e) => void searchCookieStudents(e.target.value)}
                placeholder="Search by handle (3+ characters)"
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
              />
            </div>

            {cookieSearching && (
              <div className="mt-2 flex justify-center">
                <LoadingDots />
              </div>
            )}

            {cookieResults.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {cookieResults.map((student) => (
                  <button
                    key={student.user_id}
                    type="button"
                    onClick={() => void selectCookieStudent(student)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-elevated"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{student.display_name}</span>{" "}
                      <span className="text-muted-foreground">
                        {student.username ? `@${student.username}` : "no handle"}
                      </span>
                      {/* Says why this student had to ask by message rather
                          than being found by a classmate. Only ever shown for
                          rows the admin lookup returned - the friend-search
                          fallback cannot see a hidden account at all. */}
                      {!student.discoverable && (
                        <span className="ml-1.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          hidden
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {student.points.toLocaleString()} pts
                    </span>
                  </button>
                ))}
              </div>
            )}

            {cookieStudent && (
              <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {cookieStudent.display_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cookieStudent.username ? `@${cookieStudent.username}` : "no handle"}
                      {!cookieStudent.discoverable && " · hidden from search"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCookieStudent(null)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>

                {!cookieLoadedOnce ? (
                  <div className="mt-3 flex justify-center">
                    <LoadingDots />
                  </div>
                ) : cookieAllowance == null ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Cookies aren&apos;t set up in the database yet.
                  </p>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Allowance today</p>
                        <p className="font-semibold tabular-nums">{cookieAllowance}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Spent today</p>
                        <p className="font-semibold tabular-nums">{cookieSpentToday ?? "—"}</p>
                      </div>
                    </div>

                    {/* Where the allowance came from. Two students can now
                        differ with no grant between them, so the number on its
                        own is not explicable. */}
                    {cookieStatus && (
                      <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                        {cookieStatus.earned_base} earned over {cookieStatus.active_days}{" "}
                        {cookieStatus.active_days === 1 ? "day" : "days"} of use
                        {cookieStatus.granted_extra > 0 &&
                          ` · +${cookieStatus.granted_extra} granted`}
                      </p>
                    )}

                    {cookieGrants && cookieGrants.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-muted-foreground">Grants</p>
                        {cookieGrants.map((grant) => (
                          <p key={grant.id} className="text-xs text-muted-foreground">
                            +{grant.extra_per_day}/day from {grant.starts_on}
                            {grant.ends_on ? ` to ${grant.ends_on}` : ""}
                            {grant.note ? ` — ${grant.note}` : ""}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 grid gap-2 sm:grid-cols-[6rem_9rem_1fr_auto]">
                      <input
                        type="number"
                        min={1}
                        value={grantExtra}
                        onChange={(e) => setGrantExtra(e.target.value)}
                        placeholder="Extra/day"
                        aria-label="Extra cookies per day"
                        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                      />
                      <input
                        type="date"
                        value={grantEndsOn}
                        onChange={(e) => setGrantEndsOn(e.target.value)}
                        aria-label="Ends on (optional)"
                        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                      />
                      <input
                        value={grantNote}
                        onChange={(e) => setGrantNote(e.target.value)}
                        placeholder="Note (optional)"
                        aria-label="Note"
                        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                      />
                      <button
                        type="button"
                        onClick={() => void submitCookieGrant()}
                        disabled={grantBusy}
                        className="btn-pop inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {grantBusy ? <LoadingDots /> : <Plus className="h-3.5 w-3.5" />}
                        Grant
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      No end date means the grant never expires.
                    </p>
                  </>
                )}
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
