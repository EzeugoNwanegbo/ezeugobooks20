// Friends: who you already know, plus your own handle.
//
// This used to be the whole friends feature in one long scroll — handle
// claiming, search, requests in/out, the friend list, and every open and
// settled battle, all at once. It is now the landing page only: the people
// you already have, and the one thing about you that makes you findable.
// Searching and requests moved to -app.friends-add-page.tsx
// (/app/friends-add); battle tracking moved to
// -app.friends-battles-page.tsx (/app/friends-battles). The three share
// -app.friends-shared.tsx's FriendsPageFrame for the header, the tab strip,
// and the guest/pre-migration gate.
//
// "Challenge" -> Battle Royale (2026-08-13). Tapping Challenge on a friend
// hands off to /app/battle-royale (-app.battle-royale-page.tsx), which builds
// a fresh match (file, scope, count, timer, format) and sends it itself via
// src/lib/social.ts's createChallenge(). This page's job is find-and-see a
// person, plus the button that gets you to Battle Royale with the opponent
// already chosen.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Pencil, Swords, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import {
  USERNAME_PATTERN,
  claimUsername,
  friendList,
  friendRequests,
  removeFriend,
  setDiscoverability,
  type Discoverability,
  type Friend,
  type FriendRequest,
} from "@/lib/social";
import { EmptyState, FriendsPageFrame } from "@/routes/-app.friends-shared";
import { markSeenOnce, useSeenOnce } from "@/lib/seen-once";

// First-visit-only opening line. Shown once per account, the same bargain
// src/lib/feature-tour.ts and LIBRARY_INTRO_SEEN_KEY strike: a visit is the
// signal, not an action, because a visit can never get stuck the way "has
// added a friend" could.
const FRIENDS_INTRO_SEEN_KEY = "gd_friends_intro_seen_v1";

function markFriendsIntroSeen(userId: string): void {
  try {
    window.localStorage.setItem(`${FRIENDS_INTRO_SEEN_KEY}:${userId}`, "1");
    markSeenOnce("friends", userId);
  } catch {
    // Nothing to do - worst case the line introduces itself once more.
  }
}

export function FriendsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // "unknown" until the account's list has been read; nothing renders then.
  // See src/lib/seen-once.ts.
  const showIntro = useSeenOnce("friends", user?.id) === "unseen";
  useEffect(() => {
    if (!user || !showIntro) return;
    markFriendsIntroSeen(user.id);
  }, [user, showIntro]);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const myHandle = profile?.username ?? null;
  // Defaults to "anyone" when the column is absent (flag off) or unset. Harmless
  // either way: with no handle claimed, find_student() returns nothing regardless.
  const myVisibility: Discoverability = profile?.discoverable_by === "nobody" ? "nobody" : "anyone";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [f, r] = await Promise.all([friendList(), friendRequests()]);
      setFriends(f);
      setRequests(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your friends.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const incomingCount = requests.filter((request) => request.direction === "incoming").length;

  const changeVisibility = async (mode: Discoverability) => {
    try {
      await setDiscoverability(mode);
      await refreshProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change that setting.");
    }
  };

  const removeOne = async (id: string) => {
    setBusyId(id);
    try {
      await removeFriend(id);
      toast.success("Removed.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  };

  // Hands off to Battle Royale with the target already chosen, so the setup
  // screen skips straight to "which file" instead of asking who to fight again.
  const openBattle = (friend: Friend) => {
    if (!friend.username) {
      toast.error(`${friend.display_name} hasn't picked a handle yet, so they can't be battled.`);
      return;
    }
    navigate({
      to: "/app/battle-royale",
      search: {
        friendId: friend.user_id,
        friendUsername: friend.username,
        friendName: friend.display_name,
      },
    });
  };

  return (
    <FriendsPageFrame
      active="friends"
      title={showIntro ? "Study with friends" : "Friends"}
      subtitle={
        showIntro ? "Add a classmate by their handle, then challenge them to a set." : undefined
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {incomingCount > 0 && (
            <Link
              to="/app/friends-add"
              className="inline-flex items-center gap-1.5 rounded-full border border-pop/40 bg-pop/10 px-3 py-1.5 text-xs font-semibold text-pop transition-colors hover:bg-pop/15"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {incomingCount} request{incomingCount === 1 ? "" : "s"}
            </Link>
          )}
          <HandleBlock
            handle={myHandle}
            visibility={myVisibility}
            onVisibilityChange={(mode) => void changeVisibility(mode)}
            onSaved={refreshProfile}
          />
        </div>
      }
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : friends.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          text="No friends yet."
          action={
            <Button onClick={() => void navigate({ to: "/app/friends-add" })}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Find people
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {friends.map((friend) => (
            <FriendRow
              key={friend.user_id}
              friend={friend}
              busy={busyId === friend.user_id}
              onBattle={() => openBattle(friend)}
              onRemove={() => void removeOne(friend.user_id)}
            />
          ))}
        </div>
      )}
    </FriendsPageFrame>
  );
}

// Your handle: a claim box before one exists, a plain chip with an edit
// affordance after. No paragraph either way — the format is carried by the
// placeholder, and a rejected handle surfaces its own reason via toast.
function HandleBlock({
  handle,
  visibility,
  onVisibilityChange,
  onSaved,
}: {
  handle: string | null;
  visibility: Discoverability;
  onVisibilityChange: (mode: Discoverability) => void;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const showInput = !handle || editing;

  const save = async () => {
    setSaving(true);
    try {
      const value = await claimUsername(draft);
      await onSaved();
      setEditing(false);
      setDraft("");
      toast.success(`Your handle is @${value}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that handle.");
    } finally {
      setSaving(false);
    }
  };

  if (showInput) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value.toLowerCase())}
          placeholder="pick_a_handle"
          maxLength={20}
          className="h-9 w-40 font-mono text-sm"
          aria-label={handle ? "Change your handle" : "Choose your handle"}
          autoFocus={editing}
        />
        <Button
          type="submit"
          size="sm"
          disabled={saving || !USERNAME_PATTERN.test(draft.trim().toLowerCase())}
          className="shrink-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : handle ? "Save" : "Claim"}
        </Button>
        {handle && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft("");
            }}
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Cancel</span>
          </Button>
        )}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded-full border border-pop/40 bg-pop/10 px-3 py-1.5 font-mono text-sm text-pop">
        @{handle}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        aria-label="Change your handle"
        title="Change your handle"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onVisibilityChange(visibility === "anyone" ? "nobody" : "anyone")}
        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        aria-label={
          visibility === "anyone" ? "Findable by handle — hide me" : "Hidden — make me findable"
        }
        title={visibility === "anyone" ? "Findable by handle" : "Hidden from search"}
      >
        {visibility === "anyone" ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function FriendRow({
  friend,
  busy,
  onBattle,
  onRemove,
}: {
  friend: Friend;
  busy: boolean;
  onBattle: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]">
          {friend.display_name}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {friend.username ? `@${friend.username} · ` : ""}
          {friend.points.toLocaleString()} pts · {friend.current_streak}d
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="secondary" onClick={onBattle}>
          <Swords className="mr-1.5 h-3.5 w-3.5" />
          Challenge
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
          <UserMinus className="h-3.5 w-3.5" />
          <span className="sr-only">Remove friend</span>
        </Button>
      </div>
    </div>
  );
}
