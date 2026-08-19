// Find a student by handle, and answer the requests that follow.
//
// Split out of the old all-in-one friends page: this is the "grow your list"
// screen, separate from "look at who I already have" (-app.friends-page.tsx)
// and "track a battle" (-app.friends-battles-page.tsx). It fetches its own
// friend list and requests — a light pair of calls, nothing this page does
// touches challenges at all.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  USERNAME_PATTERN,
  findStudent,
  findStudentsByPrefix,
  friendList,
  friendRequests,
  normalizeHandle,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  type FoundStudent,
  type Friend,
  type FriendRequest,
} from "@/lib/social";
import { FriendsPageFrame, Row, SectionTitle } from "@/routes/-app.friends-shared";

export function FriendsAddPage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [found, setFound] = useState<FoundStudent | null>(null);
  // Handle-prefix hits. Empty until 20260815120000_friend_search_prefix.sql is
  // applied — findStudentsByPrefix() detects the missing function and returns []
  // rather than throwing — so the exact lookup below carries the search until
  // then, and starts sharing it the moment the SQL lands.
  const [suggestions, setSuggestions] = useState<FoundStudent[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [f, r] = await Promise.all([friendList(), friendRequests()]);
      setFriends(f);
      setRequests(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const incoming = useMemo(
    () => requests.filter((request) => request.direction === "incoming"),
    [requests],
  );
  const outgoing = useMemo(
    () => requests.filter((request) => request.direction === "outgoing"),
    [requests],
  );

  // What the box is actually asking for. Two forms, because they answer two
  // different questions: the handle (@ and spaces forgiven) is what the server
  // is asked for, and the raw text is what the on-device matching below reads,
  // since a display name has spaces in it and a handle never does.
  const handleNeedle = normalizeHandle(query);
  const rawNeedle = query.trim().toLowerCase().replace(/^@+/, "");
  const needleReady = USERNAME_PATTERN.test(handleNeedle);

  // Search as you type. 250ms after the last keystroke is under the point
  // where a list stops feeling like it is responding to you. Every stale run
  // is dropped by `active`, so a slow request for "ada" can never overwrite
  // the results for "ada_l".
  useEffect(() => {
    if (!needleReady) {
      setFound(null);
      setSuggestions([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [exact, list] = await Promise.all([
            findStudent(handleNeedle),
            findStudentsByPrefix(handleNeedle),
          ]);
          if (!active) return;
          setFound(exact);
          setSuggestions(list);
        } catch {
          if (!active) return;
          setFound(null);
          setSuggestions([]);
        } finally {
          if (active) {
            setSearching(false);
            setSearched(true);
          }
        }
      })();
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [handleNeedle, needleReady]);

  // People already in your list, matched on the device against what has been
  // typed so far — searching for somebody you have already added is the
  // single most common thing this box is asked to do.
  const localMatches = useMemo(() => {
    if (rawNeedle.length < 2) return [];
    const hits: Array<{ user: Friend | FriendRequest; tag: string }> = [];
    const matches = (username: string | null, name: string) =>
      (username ?? "").includes(handleNeedle) || name.toLowerCase().includes(rawNeedle);
    for (const friend of friends) {
      if (matches(friend.username, friend.display_name)) hits.push({ user: friend, tag: "Friend" });
    }
    for (const request of requests) {
      if (!matches(request.username, request.display_name)) continue;
      hits.push({
        user: request,
        tag: request.direction === "incoming" ? "Asked you" : "Request sent",
      });
    }
    return hits.slice(0, 5);
  }, [rawNeedle, handleNeedle, friends, requests]);

  const results = useMemo(() => {
    // Prefix hits when the server returned any, the exact hit otherwise. This
    // used to branch on a hand-flipped constant; reading the DATA instead means
    // the page is simply correct before and after the migration lands, with
    // nothing to remember to flip.
    const base = suggestions.length > 0 ? suggestions : found ? [found] : [];
    const shown = new Set(localMatches.map((hit) => hit.user.user_id));
    return base.filter((student) => !shown.has(student.user_id));
  }, [suggestions, found, localMatches]);

  const act = async (id: string, work: () => Promise<unknown>, done?: string) => {
    setBusyId(id);
    try {
      await work();
      if (done) toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <FriendsPageFrame active="add" title="Add friends">
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="type a handle"
            maxLength={21}
            className="pl-9 pr-9 font-mono"
            aria-label="Search by handle"
            autoFocus
          />
          {searching && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {localMatches.length > 0 && (
          <div className="mt-4">
            <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Already in your list
            </p>
            <div className="space-y-2">
              {localMatches.map((hit) => (
                <Row
                  key={hit.user.user_id}
                  title={hit.user.display_name}
                  subtitle={hit.user.username ? `@${hit.user.username}` : ""}
                  action={<span className="text-xs text-muted-foreground">{hit.tag}</span>}
                />
              ))}
            </div>
          </div>
        )}

        {needleReady && searched && !searching && (
          <div className="mt-4">
            {results.length === 0 ? (
              localMatches.length > 0 ? null : (
                <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Nobody found with that handle.
                </p>
              )
            ) : (
              <div className="space-y-2">
                {results.map((student) => (
                  <Row
                    key={student.user_id}
                    title={student.display_name}
                    subtitle={`@${student.username} · ${student.points.toLocaleString()} pts`}
                    action={
                      student.relationship === "self" ? (
                        <span className="text-xs text-muted-foreground">That&apos;s you</span>
                      ) : student.relationship === "friends" ? (
                        <span className="text-xs text-leaf">Already friends</span>
                      ) : student.relationship === "pending_out" ? (
                        <span className="text-xs text-muted-foreground">Request sent</span>
                      ) : student.relationship === "pending_in" ? (
                        <span className="text-xs text-muted-foreground">They asked you</span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busyId === student.user_id}
                          onClick={() =>
                            void act(
                              student.user_id,
                              () => sendFriendRequest(student.username),
                              "Request sent.",
                            )
                          }
                        >
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                          Add
                        </Button>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {!loading && (incoming.length > 0 || outgoing.length > 0) && (
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <SectionTitle icon={<UserPlus className="h-4 w-4" />} title="Requests" />
          <div className="mt-3 space-y-2">
            {incoming.map((request) => (
              <Row
                key={request.user_id}
                title={request.display_name}
                subtitle={request.username ? `@${request.username}` : "wants to be friends"}
                action={
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={busyId === request.user_id}
                      onClick={() =>
                        void act(
                          request.user_id,
                          () => respondToFriendRequest(request.user_id, true),
                          "You're friends.",
                        )
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span className="sr-only">Accept</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === request.user_id}
                      onClick={() =>
                        void act(request.user_id, () =>
                          respondToFriendRequest(request.user_id, false),
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Decline</span>
                    </Button>
                  </div>
                }
              />
            ))}
            {outgoing.map((request) => (
              <Row
                key={request.user_id}
                title={request.display_name}
                subtitle={request.username ? `@${request.username}` : ""}
                action={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Waiting</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === request.user_id}
                      onClick={() => void act(request.user_id, () => removeFriend(request.user_id))}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Cancel request</span>
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        </section>
      )}
    </FriendsPageFrame>
  );
}
