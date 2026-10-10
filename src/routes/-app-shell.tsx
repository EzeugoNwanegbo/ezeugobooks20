import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronLeft,
  ChevronUp,
  Clock,
  ClipboardList,
  Heart,
  ListChecks,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Swords,
  TimerReset,
  Trophy,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { PersonalizationPanel } from "@/components/personalization-panel";
import { savePersonalizationBackground } from "@/lib/personalization";
import { ThemePicker, ThemeToggle } from "@/components/theme-toggle";
import { AppShellSkeleton } from "@/components/app-skeletons";
import { FeatureTour } from "@/components/feature-tour";
import { hasSeenTour } from "@/lib/feature-tour";
import { primeSeenOnce } from "@/lib/seen-once";
import { RankUpCelebration } from "@/components/rank-up-celebration";
import { UploadBonusUnlockCelebration } from "@/components/upload-bonus-unlock-celebration";
import { CookieRing } from "@/components/cookie-ring";
import { CookieEmptyDialog } from "@/components/cookie-empty-dialog";
import { RankBadge, RankLadderBar } from "@/components/rank-badge";
import { rankProgress, type AcademicRank } from "@/lib/ranks";
import { allowanceFrom } from "@/lib/allowances";
import { useCookies, onCookieDialogRequested, onOutOfCookies } from "@/lib/cookies";
import { takeRankCelebration } from "@/lib/progression-moments";
import { useAuth } from "@/lib/auth-context";
import { isGuestUser } from "@/lib/guest-session";
import { socialEnabled } from "@/lib/social";
import { rememberRoute } from "@/lib/last-route";
import {
  emptyGamificationStats,
  loadGamificationStats,
  recordGamificationEvent,
  type GamificationStats,
} from "@/lib/gamification";
import { getCached, setCached } from "@/lib/data-cache";
import { supabase } from "@/integrations/supabase/client";
import "./app-shell.css";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

// The signed-in shell opens on a narrow icon rail (Gemini-style): the logo mark
// expands it, the chevron in the expanded header collapses it again, and the
// student's explicit choice is remembered across reloads.
const SIDEBAR_STORAGE_KEY = "gd-sidebar-collapsed";

/** Read on mount (lazy useState initialiser) so the rail paints once, no flash. */
function readStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    // Private mode / blocked storage - fall through to the collapsed default.
  }
  return true;
}

/** How many past chats are fetched for the sidebar. Matches what the chat page
 *  used to load for its own (now removed) sidebar - this is the app's single
 *  chat history, so it is the full list, scrolled rather than capped. */
const SIDEBAR_CONVO_LIMIT = 100;

/** The chat page fires this after it creates, retitles or touches a
 *  conversation. Pathname alone cannot catch it: starting a new chat only
 *  changes the `?c=` search param, so without the event a brand-new
 *  conversation would not appear in the sidebar until the next navigation. */
const CONVOS_CHANGED_EVENT = "gd:conversations-changed";

export function AppShell() {
  return <AppLayout />;
}

function AppLayout() {
  const { user, profile, loading, authError, refreshProfile, signOut, deleteAccount } = useAuth();
  const isGuest = isGuestUser(user);
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ strict: false }) as { c?: string };
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Feeds both the mobile drawer's grouped history and the "Recent" list in the
  // expanded desktop sidebar - one query, two surfaces.
  const [recentConvos, setRecentConvos] = useState<ConversationRow[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [hideMobileTopbar, setHideMobileTopbar] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // The "who I am" import lives here rather than only inside a chat: it is
  // profile-shaped, so it must stay reachable from every page and after it has
  // already been filled in (the in-chat card disappears once it is set).
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [gamification, setGamification] = useState<GamificationStats>(emptyGamificationStats);
  // The one progression moment the shell still owns. A rank-up is rare and
  // worth interrupting for; it decides whether it may run at all in
  // src/lib/progression-moments.ts. The old centred streak card that opened on
  // top of the app is gone - the streak now reads as an inline moment on the
  // chat page, which does not stand between a student and what they came for.
  const [rankUp, setRankUp] = useState<AcademicRank | null>(null);
  // The other progression moment the shell owns: five active days unlocking
  // EARNED_DAY_UPLOAD_BONUS. Holds the new daily total to show, or null for
  // "nothing to celebrate right now". See the "gd:upload-bonus-unlocked"
  // listener below for why this is not derived from `gamification` directly.
  const [uploadBonusUnlockTotal, setUploadBonusUnlockTotal] = useState<number | null>(null);
  // The empty-state dialog. Opened either by a 402 anywhere in the app
  // (chat/studybody/last-minute, or a refused Battle Royale charge - all
  // reach here through reportOutOfCookies()) or by tapping the ring itself at
  // any level; null means closed. See cookie-empty-dialog.tsx for why the
  // same dialog serves both.
  const [cookieDialog, setCookieDialog] = useState<{
    remaining: number | null;
    allowance: number | null;
  } | null>(null);
  // The tail of the sidebar nav - the things a student touches once a term -
  // stays folded away until asked for. See the nav block below.
  const [navMoreOpen, setNavMoreOpen] = useState(false);

  useEffect(() => {
    const handleChatScroll = (e: Event) => {
      const customEvent = e as CustomEvent<{ hide: boolean }>;
      setHideMobileTopbar(customEvent.detail.hide);
    };

    window.addEventListener("gd:chat-scroll", handleChatScroll);
    return () => {
      window.removeEventListener("gd:chat-scroll", handleChatScroll);
    };
  }, []);

  useEffect(() => {
    setHideMobileTopbar(false);
  }, [location.pathname]);

  // First run: once the profile is in (so onboarding is behind them and the
  // shell has actually rendered its nav), offer the guided tour - once per
  // account, for good. The flag is banked by FeatureTour the moment it opens
  // rather than when it is finished, so abandoning it half-way (reload, tab
  // closed, sign-out) still counts; see src/lib/feature-tour.ts. The Guide
  // button in the footer is the only way back in.
  useEffect(() => {
    if (loading || !profile || hasSeenTour(user?.id)) return;
    let active = true;
    let timer = 0;
    // Ask the ACCOUNT before offering it. hasSeenTour() above reads only this
    // browser's cache, which is empty on a new device or after a cleared cache
    // even for a student who was toured months ago. primeSeenOnce() fills that
    // cache from user_profiles.seen_intros, so the check below is the one that
    // decides. It resolves inside the 900ms beat this already waited.
    void primeSeenOnce(user?.id).then(() => {
      if (!active || hasSeenTour(user?.id)) return;
      timer = window.setTimeout(() => setTourOpen(true), 900);
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loading, profile, user?.id]);

  // Touch-gesture trackers (declared up here so the Hook order is stable across
  // the early returns below).
  const contentTouchRef = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const drawerTouchRef = useRef<{ x: number; y: number } | null>(null);
  const mobileDrawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileMenuOpen || tourOpen || cookieDialog || personalizeOpen || showDeleteDialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = mobileDrawerRef.current;
    const focusableElements = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]') ??
          [],
      ).filter((element) => element.getClientRects().length > 0);
    const frame = window.requestAnimationFrame(() => focusableElements()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [mobileMenuOpen, tourOpen, cookieDialog, personalizeOpen, showDeleteDialog]);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth", replace: true });
    else if (profile && !profile.onboarded) navigate({ to: "/onboarding", replace: true });
    // Bare /app has no child route - the shell renders with an empty Outlet
    // ("incomplete chat page"). Land such visits on the chat screen.
    else if (location.pathname === "/app" || location.pathname === "/app/") {
      navigate({ to: "/app/chat", replace: true });
    }
  }, [loading, user, profile, navigate, location.pathname]);

  useEffect(() => {
    if (!user) {
      setGamification(emptyGamificationStats());
      return;
    }
    const stats = location.pathname.startsWith("/app/chat")
      ? recordGamificationEvent(user.id, "chat_entered", { oncePerDay: true })
      : loadGamificationStats(user.id);
    setGamification(stats);
    const onGamification = () => setGamification(loadGamificationStats(user.id));
    window.addEventListener("gd:gamification", onGamification);
    return () => window.removeEventListener("gd:gamification", onGamification);
  }, [user, location.pathname]);

  // Rank-up. Driven by the point total rather than by a "you just earned" event
  // so it also catches a crossing that happened in another tab; takeRankCelebration
  // consumes the rank as it hands it over, so re-running this is harmless and it
  // can only ever fire once per rank per device.
  useEffect(() => {
    if (!user) return;
    const earned = takeRankCelebration(gamification.points);
    if (earned) setRankUp(earned);
  }, [user, gamification.points]);

  // Five-active-days unlock. Unlike rank-up this is an EVENT listener rather
  // than something re-derived from `gamification.activeDays` on every render:
  // the "has this already been shown" flag lives inside GamificationStats
  // itself (see uploadBonusUnlockShown in gamification.ts) and is already true
  // by the time this component's own state has re-rendered with the crossing,
  // so there is no "before vs after" left to compare against here - only
  // recordGamificationEvent() knows the instant it happens, and it dispatches
  // this event from exactly that instant. A fresh read (not the possibly-stale
  // `gamification` closure) supplies the numbers the card shows.
  useEffect(() => {
    if (!user) return;
    const onUnlock = () => {
      const fresh = loadGamificationStats(user.id);
      setUploadBonusUnlockTotal(allowanceFrom(fresh.points, 0, fresh.activeDays).total);
    };
    window.addEventListener("gd:upload-bonus-unlocked", onUnlock);
    return () => window.removeEventListener("gd:upload-bonus-unlocked", onUnlock);
  }, [user]);

  // The cookie meter. "unavailable" (schema not applied yet, or no user) means
  // the ring below simply does not render - see useCookies()'s own contract.
  const cookies = useCookies(user?.id);

  // Raised from anywhere in the app on a 402, via reportOutOfCookies() in
  // src/lib/cookies.ts - chat/studybody/last-minute all call it, and so does
  // battle-royale-client.ts on a refused client-side charge.
  useEffect(() => {
    return onOutOfCookies((info) => {
      setMobileMenuOpen(false);
      setCookieDialog({ remaining: info.remaining ?? null, allowance: info.allowance ?? null });
    });
  }, []);

  // The same dialog, opened by a ring that is NOT in this component: PageHeader
  // renders one at the top of every screen that has a header, and it has no way
  // to reach openCookieDialog() below. It sends no numbers - they are read here
  // from the live balance, so a header ring and the sidebar ring always open
  // the dialog saying the same thing.
  useEffect(() => {
    return onCookieDialogRequested(() => {
      setMobileMenuOpen(false);
      setCookieDialog(
        cookies.status === "ready"
          ? { remaining: cookies.balance.remaining, allowance: cookies.balance.allowance }
          : { remaining: null, allowance: null },
      );
    });
  }, [cookies]);

  // The one conversation query in the app. It feeds the desktop sidebar's
  // grouped history and the mobile drawer's; the chat page no longer keeps a
  // list of its own. Stale-while-revalidate off the shared `convos:<user>` key
  // so the list paints instantly when moving between pages.
  const loadConvos = useCallback(async () => {
    if (!user) {
      setRecentConvos([]);
      return;
    }
    const cached = getCached<ConversationRow[]>(`convos:${user.id}`);
    if (cached) setRecentConvos(cached);
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(SIDEBAR_CONVO_LIMIT);
    if (error) {
      console.warn("load recent conversations", error);
      return;
    }
    const rows = (data as ConversationRow[]) ?? [];
    setRecentConvos(rows);
    setCached(`convos:${user.id}`, rows);
  }, [user]);

  useEffect(() => {
    void loadConvos();
  }, [loadConvos, location.pathname]);

  useEffect(() => {
    const onChanged = () => void loadConvos();
    window.addEventListener(CONVOS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONVOS_CHANGED_EVENT, onChanged);
  }, [loadConvos]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.searchStr]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const onResize = () => {
      if (desktop.matches) setMobileMenuOpen(false);
    };
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, []);

  // Remember where the user is so reopening the app returns them here.
  useEffect(() => {
    rememberRoute(location.pathname);
  }, [location.pathname]);

  // Practice Questions (PQ) and Practice are content-heavy - collapse the
  // sidebar on entry so they get the full width. The user can still expand it
  // with the logo.
  // Deliberately *not* persisted: this is the app's doing, not the student's
  // choice, so it must not overwrite the remembered preference below.
  useEffect(() => {
    if (
      location.pathname.startsWith("/app/studybody") ||
      location.pathname.startsWith("/app/practice")
    ) {
      setIsSidebarCollapsed(true);
    }
  }, [location.pathname]);

  const groupedRecentConvos = useMemo(() => {
    const today: ConversationRow[] = [];
    const yesterday: ConversationRow[] = [];
    const thisWeek: ConversationRow[] = [];
    const thisMonth: ConversationRow[] = [];
    const older: ConversationRow[] = [];
    const now = Date.now();

    for (const convo of recentConvos) {
      const ts = convo.updated_at ? new Date(convo.updated_at).getTime() : 0;
      const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
      if (ageDays < 1) today.push(convo);
      else if (ageDays < 2) yesterday.push(convo);
      else if (ageDays < 7) thisWeek.push(convo);
      else if (ageDays < 30) thisMonth.push(convo);
      else older.push(convo);
    }

    return { today, yesterday, thisWeek, thisMonth, older };
  }, [recentConvos]);

  if (loading || !user) {
    return <AppShellSkeleton />;
  }

  if (!profile?.onboarded) {
    return (
      <div className="luxury-app-shell flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="symbiote-blob app-blob-one" />
        <div className="symbiote-blob app-blob-two" />
        <div className="luxury-panel w-full max-w-md rounded-lg p-5 text-center shadow-elegant sm:p-6">
          <h1 className="font-display text-3xl font-light leading-none">
            {authError ? "Profile could not load" : "Loading your profile"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {authError ||
              "Your account is signed in. We are waiting for the profile record before opening the workspace."}
          </p>
          {(authError || !profile) && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void refreshProfile()}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-glow"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/auth", replace: true });
                }}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Only an explicit click on the logo / collapse chevron is remembered - the
  // route-driven auto-collapse above calls setIsSidebarCollapsed directly.
  const chooseSidebarCollapsed = (collapsed: boolean) => {
    setIsSidebarCollapsed(collapsed);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Blocked storage - the choice just won't survive the reload.
    }
  };

  const openNewChat = () => {
    setMobileMenuOpen(false);
    navigate({ to: "/app/chat", search: {} });
    window.setTimeout(() => window.dispatchEvent(new Event("gd:new-chat")), 0);
  };

  // Tapping the ring at ANY level opens the same dialog a 402 does - see the
  // header note on CookieEmptyDialog for why its copy adapts instead of
  // always claiming "you're out" when it might not be true yet.
  const openCookieDialog = () => {
    setMobileMenuOpen(false);
    setCookieDialog(
      cookies.status === "ready"
        ? { remaining: cookies.balance.remaining, allowance: cookies.balance.allowance }
        : { remaining: null, allowance: null },
    );
  };

  // Ported wholesale from the chat page's old sidebar, behaviour unchanged:
  // it confirms first, deletes the messages itself (the schema has no FK
  // cascade, so removing only the conversation orphans its rows), and drops
  // you on a new chat if you just deleted the one you were reading.
  const deleteConversation = async (id: string) => {
    if (!user) return;
    if (!window.confirm("Delete this chat?")) return;
    await supabase.from("messages").delete().eq("conversation_id", id);
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (location.pathname.startsWith("/app/chat") && search.c === id) openNewChat();
    void loadConvos();
  };

  const goToMobileRoute = (
    to:
      | "/app/chat"
      | "/app/clerking"
      | "/app/library"
      | "/app/last-minute"
      | "/app/history"
      | "/app/studybody"
      | "/app/friends"
      | "/app/battle-royale"
      | "/app/feedback"
      | "/app/leaderboard"
      | "/app/admin"
      | "/app/settings",
  ) => {
    setMobileMenuOpen(false);
    navigate({ to });
  };

  const onChat = location.pathname.startsWith("/app/chat");
  // The named rank + progress that the footer shows in place of the old "L7".
  const rank = rankProgress(gamification.points);
  // Only highlight a conversation while the chat screen is actually showing it.
  const activeConvoId = onChat ? search.c : undefined;

  // The drawer only exists below the desktop breakpoint, including on touch
  // devices. Opening it at a wider viewport would make the content inert while
  // the drawer itself is hidden.
  const onContentTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    contentTouchRef.current = { x: touch.clientX, y: touch.clientY, edge: touch.clientX <= 28 };
  };
  const onContentTouchEnd = (event: React.TouchEvent) => {
    const start = contentTouchRef.current;
    contentTouchRef.current = null;
    if (!start || !start.edge || mobileMenuOpen || window.matchMedia("(min-width: 768px)").matches)
      return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx > 64 && Math.abs(dy) < 48) {
      if (onChat) setMobileMenuOpen(true);
      else navigate({ to: "/app/chat" });
    }
  };

  // Drawer swipe-to-close: dragging the open drawer left dismisses it.
  const onDrawerTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) drawerTouchRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const onDrawerTouchEnd = (event: React.TouchEvent) => {
    const start = drawerTouchRef.current;
    drawerTouchRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (touch.clientX - start.x < -48 && Math.abs(touch.clientY - start.y) < 60) {
      setMobileMenuOpen(false);
    }
  };

  const navItem = (
    to: string,
    icon: ReactNode,
    label: string,
    accent: "blue" | "violet" | "coral" | "amber" | "slate" = "slate",
    // Lets the guided tour spotlight this entry (see src/lib/feature-tour.ts).
    tourAnchor?: string,
  ) => {
    const active = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        data-tour={tourAnchor}
        aria-current={active ? "page" : undefined}
        className={`gd-side-nav-item gd-side-nav-${accent} ${active ? "gd-side-nav-active" : ""} group/nav relative flex items-center overflow-hidden rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
        } ${isSidebarCollapsed ? "justify-center gap-0" : "gap-3"}`}
        title={isSidebarCollapsed ? label : undefined}
        aria-label={label}
      >
        {icon}
        <span
          className={`whitespace-nowrap transition-all duration-300 ${
            isSidebarCollapsed
              ? "max-w-0 -translate-x-2 opacity-0"
              : "max-w-48 translate-x-0 opacity-100"
          }`}
          // Collapsed, the aria-label above is the accessible name - keep the
          // clipped text out of the tree so it is not announced twice.
          aria-hidden={isSidebarCollapsed}
        >
          {label}
        </span>
      </Link>
    );
  };

  // Same row as navItem, but for entries that open something in place instead
  // of routing (Personalize, and the More fold at the foot of the nav). `dot`
  // is the quiet unset marker - no badge, no count, just a small accent pip.
  // `expanded` is only passed by a row that discloses others, so screen readers
  // hear the fold open and shut.
  const navAction = (
    icon: ReactNode,
    label: string,
    onPick: () => void,
    accent: "blue" | "violet" | "coral" | "amber" | "slate" = "slate",
    dot = false,
    expanded?: boolean,
  ) => (
    <button
      type="button"
      onClick={onPick}
      aria-expanded={expanded}
      className={`gd-side-nav-item gd-side-nav-${accent} group/nav relative flex w-full items-center overflow-hidden rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-foreground/[0.045] hover:text-foreground ${
        isSidebarCollapsed ? "justify-center gap-0" : "gap-3"
      }`}
      title={isSidebarCollapsed ? label : undefined}
      aria-label={label}
    >
      <span className="relative flex shrink-0 items-center">
        {icon}
        {dot && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-pop"
          />
        )}
      </span>
      <span
        className={`whitespace-nowrap transition-all duration-300 ${
          isSidebarCollapsed
            ? "max-w-0 -translate-x-2 opacity-0"
            : "max-w-48 translate-x-0 opacity-100"
        }`}
        // Collapsed, the aria-label above is the accessible name - keep the
        // clipped text out of the tree so it is not announced twice.
        aria-hidden={isSidebarCollapsed}
      >
        {label}
      </span>
    </button>
  );

  // One write path, shared with the in-chat card (src/lib/personalization.ts).
  const persistPersonalization = async (text: string) => {
    if (!user) return;
    const error = await savePersonalizationBackground(user.id, text);
    if (error) {
      toast.error("Couldn't save your background - try again.");
      return;
    }
    await refreshProfile();
    toast.success(text ? "Saved - G&D now studies with you in mind." : "Personalization removed");
    setPersonalizeOpen(false);
  };

  // Guests have no way back into an anonymous session once it's gone, so warn
  // before signing out orphans everything they made. Returns false on cancel.
  const confirmAndSignOut = async () => {
    if (
      isGuest &&
      !window.confirm(
        "You're in a guest session - signing out permanently loses your documents and chats. Create a free account first to keep them.\n\nSign out anyway?",
      )
    ) {
      return false;
    }
    await signOut();
    return true;
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await deleteAccount();
      navigate({ to: "/" });
    } catch {
      setDeletingAccount(false);
      setShowDeleteDialog(false);
    }
  };

  const renderAccountCard = () => (
    <div className="gd-shell-account-card">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="gd-profile-mark shrink-0">
          {(profile.name || "S").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{profile.name || "Student"}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <RankBadge rank={rank.rank} size="sm" className="h-4 w-4 rounded" />
            <span className="truncate text-[11px] text-muted-foreground">{rank.rank.name}</span>
          </div>
        </div>
        <Link
          to="/app/settings"
          aria-current={location.pathname.startsWith("/app/settings") ? "page" : undefined}
          title="Account settings"
          aria-label="Account settings"
          className="gd-shell-icon-button shrink-0"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>
      <RankLadderBar points={gamification.points} className="mt-3" />
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
        <span>{gamification.points.toLocaleString()} points</span>
        <span>{gamification.currentStreak} day streak</span>
      </div>
      {cookies.status === "ready" && (
        <div className="gd-shell-credit-balance">
          <CookieRing
            remaining={cookies.balance.remaining}
            allowance={cookies.balance.allowance}
            onClick={openCookieDialog}
            size={30}
          />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={openCookieDialog}
            aria-label={`${cookies.balance.remaining} AI credits remaining. View usage details`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">
                {cookies.balance.remaining} AI credits left
              </span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {cookies.balance.allowance} available today
              </span>
            </span>
            <span className="gd-shell-credit-detail" aria-hidden="true">
              View
            </span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="gd-polished-shell luxury-app-shell flex h-dvh min-h-dvh flex-col overflow-hidden bg-background md:flex-row">
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account and all associated data - documents,
              conversations, study plans, and profile information. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              disabled={deletingAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAccount ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <aside
        aria-label="Main navigation"
        data-collapsed={isSidebarCollapsed}
        className={`gd-app-sidebar hidden md:flex flex-col overflow-hidden border-r border-border/70 bg-background/95 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:shrink-0 ${isSidebarCollapsed ? "md:w-[4.5rem]" : "md:w-[17rem] xl:w-[17.5rem]"}`}
      >
        <div
          className={`gd-shell-brand-row flex shrink-0 items-center transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isSidebarCollapsed ? "justify-center px-2 py-4" : "justify-between px-5 py-5"
          }`}
        >
          {isSidebarCollapsed ? (
            // Collapsed, the logo mark *is* the menu button (Gemini's rail).
            // A button, not a Link - it opens the menu, it does not navigate.
            <button
              type="button"
              onClick={() => chooseSidebarCollapsed(false)}
              className="gd-rail-mark grid h-10 w-10 place-items-center rounded-xl border border-border/70 transition-colors hover:bg-foreground/[0.06]"
              title="Open menu"
              aria-label="Open menu"
              aria-expanded={false}
            >
              G&D
            </button>
          ) : (
            <>
              <Link to="/app/chat" className="gd-shell-brand" aria-label="G&D study workspace">
                <span className="gd-sidebar-brand luxury-brand-text whitespace-nowrap">G&D</span>
                <span className="gd-shell-brand-caption">Your study workspace</span>
              </Link>
              <button
                type="button"
                onClick={() => chooseSidebarCollapsed(true)}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                title="Collapse menu"
                aria-label="Collapse menu"
                aria-expanded
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        {/* New chat - ported from the chat page's own sidebar, which is gone.
            The mobile drawer and top bar already had one; the desktop sidebar
            did not, so starting a fresh chat meant going through the rail. */}
        <div className={`shrink-0 ${isSidebarCollapsed ? "px-2 pb-1" : "px-3 pb-1"}`}>
          <button
            type="button"
            onClick={openNewChat}
            title="New chat"
            aria-label="New chat"
            className={`gd-shell-new-chat flex items-center overflow-hidden rounded-lg border border-border/70 text-foreground transition-colors hover:border-pop/40 hover:bg-foreground/[0.05] ${
              isSidebarCollapsed
                ? "mx-auto h-10 w-10 justify-center"
                : "w-full gap-2 px-3 py-2.5 text-sm font-medium"
            }`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span
              className={`whitespace-nowrap transition-all duration-300 ${
                isSidebarCollapsed
                  ? "max-w-0 -translate-x-2 opacity-0"
                  : "max-w-24 translate-x-0 opacity-100"
              }`}
              aria-hidden={isSidebarCollapsed}
            >
              New chat
            </span>
          </button>
        </div>

        {/* ONE scroll region for the nav AND the chat history.
            The nav used to be a fixed-height block with the history below it,
            which meant a tall nav (ten rows, and every row 4px taller in the
            .brutal skin) pushed the footer past the sidebar's bottom edge -
            the sidebar is overflow-hidden, so the Appearance picker at the
            bottom of that footer was simply cut off, and in brutal it vanished
            entirely. Everything above the footer scrolls now, so the footer is
            always reachable no matter how short the viewport or how tall the
            skin makes the rows. */}
        <div className="gd-no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain">
          <nav className="gd-shell-navigation shrink-0 px-3 py-3" aria-label="Study tools">
            <div className="gd-shell-nav-section">
              {!isSidebarCollapsed && <p className="gd-shell-section-label">Study</p>}
              {navItem("/app/chat", <MessageSquare className="h-4 w-4 shrink-0" />, "Chat", "blue")}
              {navItem("/app/clerking", <ClipboardList className="h-4 w-4 shrink-0" />, "Patient clerking", "coral")}
              {navItem(
                "/app/library",
                <BookOpen className="h-4 w-4 shrink-0" />,
                "Library",
                "blue",
                "nav-library",
              )}
              {navItem(
                "/app/studybody",
                <ListChecks className="h-4 w-4 shrink-0" />,
                "Practice questions",
                "violet",
                "nav-pq",
              )}
              {navItem(
                "/app/last-minute",
                <TimerReset className="h-4 w-4 shrink-0" />,
                "Last Minute",
                "coral",
                "nav-last-minute",
              )}
            </div>
            <div className="gd-shell-nav-section">
              {!isSidebarCollapsed && <p className="gd-shell-section-label">Community</p>}
              {navItem(
                "/app/leaderboard",
                <Trophy className="h-4 w-4 shrink-0" />,
                "Leaderboard",
                "amber",
                "nav-leaderboard",
              )}
              {socialEnabled(user) &&
                navItem(
                  "/app/friends",
                  <Users className="h-4 w-4 shrink-0" />,
                  "Friends",
                  "coral",
                  "nav-friends",
                )}
              {socialEnabled(user) &&
                navItem(
                  "/app/battle-royale",
                  <Swords className="h-4 w-4 shrink-0" />,
                  "Battle Royale",
                  "coral",
                  "nav-battle-royale",
                )}
            </div>
            <div className="gd-shell-nav-section">
              {!isSidebarCollapsed && <p className="gd-shell-section-label">Your space</p>}
              {navItem(
                "/app/history",
                <Clock className="h-4 w-4 shrink-0" />,
                "History",
                "slate",
                "nav-history",
              )}
              {navAction(
                navMoreOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0" />
                ) : (
                  <MoreHorizontal className="h-4 w-4 shrink-0" />
                ),
                "More",
                () => setNavMoreOpen((open) => !open),
                "slate",
                !navMoreOpen && !profile?.personalization_background,
                navMoreOpen,
              )}
              {navMoreOpen && (
                <>
                  {navAction(
                    <Sparkles className="h-4 w-4 shrink-0" />,
                    "Personalize",
                    () => setPersonalizeOpen(true),
                    "violet",
                    !profile?.personalization_background,
                  )}
                  {navItem("/app/feedback", <Heart className="h-4 w-4 shrink-0" />, "Feedback")}
                  {profile?.is_admin &&
                    navItem(
                      "/app/admin",
                      <ShieldCheck className="h-4 w-4 shrink-0" />,
                      "Admin",
                      "amber",
                    )}
                </>
              )}
            </div>
          </nav>

          {/* "Recent" - the app's only chat history now that the chat page's
              own sidebar is gone, so it carries that sidebar's date grouping
              (Today / Yesterday / … / Older), its delete control and its
              empty + guest states rather than a flat capped list. */}
          {!isSidebarCollapsed && (
            <div className="gd-shell-history px-3 pb-4 pt-4">
              <p className="gd-shell-section-label">Recent conversations</p>
              {recentConvos.length === 0 ? (
                <div className="gd-shell-empty-history">
                  <MessageSquare className="h-4 w-4" />
                  <p>
                    {isGuest
                      ? "Guest chats are not saved."
                      : "Your conversations will appear here."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <SidebarConvoGroup
                    title="Today"
                    items={groupedRecentConvos.today}
                    activeId={activeConvoId}
                    onDelete={deleteConversation}
                  />
                  <SidebarConvoGroup
                    title="Yesterday"
                    items={groupedRecentConvos.yesterday}
                    activeId={activeConvoId}
                    onDelete={deleteConversation}
                  />
                  <SidebarConvoGroup
                    title="This week"
                    items={groupedRecentConvos.thisWeek}
                    activeId={activeConvoId}
                    onDelete={deleteConversation}
                  />
                  <SidebarConvoGroup
                    title="This month"
                    items={groupedRecentConvos.thisMonth}
                    activeId={activeConvoId}
                    onDelete={deleteConversation}
                  />
                  <SidebarConvoGroup
                    title="Older"
                    items={groupedRecentConvos.older}
                    activeId={activeConvoId}
                    onDelete={deleteConversation}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {/* Account and appearance stay reachable when the navigation scrolls. */}
        <div
          className={`gd-shell-footer gd-no-scrollbar max-h-[48%] shrink-0 overflow-y-auto overscroll-contain border-t border-border/70 ${isSidebarCollapsed ? "flex flex-col items-center gap-2.5 px-2 py-3" : "p-3"}`}
        >
          {isSidebarCollapsed ? (
            <>
              <button
                type="button"
                data-tour="tour-launcher"
                onClick={() => setTourOpen(true)}
                title="Replay the app guide"
                aria-label="Replay the app guide"
                className="gd-shell-icon-button"
              >
                <Map className="h-4 w-4" />
              </button>
              <ThemeToggle />
              <button
                type="button"
                onClick={async () => {
                  if (await confirmAndSignOut()) navigate({ to: "/" });
                }}
                title="Sign out"
                aria-label="Sign out"
                className="gd-shell-icon-button"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <div className="gd-shell-rail-account flex flex-col items-center gap-2.5">
                <span title={`${rank.rank.name} · ${gamification.points.toLocaleString()} points`}>
                  <RankBadge rank={rank.rank} size="sm" />
                </span>
                {cookies.status === "ready" && (
                  <CookieRing
                    remaining={cookies.balance.remaining}
                    allowance={cookies.balance.allowance}
                    onClick={openCookieDialog}
                    size={28}
                  />
                )}
                <Link
                  to="/app/settings"
                  aria-current={location.pathname.startsWith("/app/settings") ? "page" : undefined}
                  title="Settings"
                  aria-label="Settings"
                  className="gd-shell-icon-button"
                >
                  <Settings className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => chooseSidebarCollapsed(false)}
                  title={`${profile.name || "Student"} - open menu`}
                  aria-label={`${profile.name || "Student"} - open menu`}
                  className="rounded-xl transition-opacity hover:opacity-80"
                >
                  <span className="gd-profile-mark">
                    {(profile.name || "S").slice(0, 1).toUpperCase()}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              {renderAccountCard()}
              <ThemePicker className="gd-shell-theme-picker mt-3" />
              <div className="gd-shell-account-actions mt-2">
                <button
                  type="button"
                  data-tour="tour-launcher"
                  onClick={() => setTourOpen(true)}
                  title="Replay the app guide"
                  className="gd-shell-footer-action"
                >
                  <Map className="h-3.5 w-3.5" />
                  Guide
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (await confirmAndSignOut()) navigate({ to: "/" });
                  }}
                  className="gd-shell-footer-action"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteDialog(true)}
                  title="Delete account"
                  aria-label="Delete account"
                  className="gd-shell-delete-action"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      <div
        inert={mobileMenuOpen}
        className={`mobile-app-topbar sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between overflow-hidden border-b border-border/70 bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform md:hidden ${
          hideMobileTopbar
            ? "pointer-events-none -translate-y-full opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          aria-expanded={mobileMenuOpen}
          aria-controls="gd-mobile-workspace-menu"
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          title={mobileMenuOpen ? "Close menu" : "Menu"}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/app/chat" className="gd-shell-mobile-brand luxury-brand-text small">
          G&D
        </Link>
        <div className="flex items-center gap-1.5">
          {/* On a phone this is THE meter: it is pinned to the top of the
              viewport, so it stays readable while the page scrolls, which the
              one in PageHeader does not. That is also why PageHeader's is
              desktop-only - two of them would sit inches apart here. */}
          {cookies.status === "ready" && (
            <CookieRing
              remaining={cookies.balance.remaining}
              allowance={cookies.balance.allowance}
              onClick={openCookieDialog}
              size={26}
            />
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={openNewChat}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Backdrop - tap outside the drawer to close it. */}
        <div
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] transition-opacity duration-200 md:hidden ${
            mobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        <aside
          ref={mobileDrawerRef}
          id="gd-mobile-workspace-menu"
          role="dialog"
          aria-modal={mobileMenuOpen ? true : undefined}
          aria-label="Study workspace menu"
          inert={!mobileMenuOpen}
          onTouchStart={onDrawerTouchStart}
          onTouchEnd={onDrawerTouchEnd}
          aria-hidden={!mobileMenuOpen}
          className={`gd-mobile-menu fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-[21rem] flex-col border-r border-border/60 text-foreground shadow-[20px_0_48px_rgba(0,0,0,0.28)] transition-transform will-change-transform md:hidden ${mobileMenuOpen ? "translate-x-0 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]" : "-translate-x-full duration-200 ease-in"}`}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="shrink-0 px-4 pb-3 pt-5">
            <div className="gd-shell-drawer-brand-row mb-5 flex items-center justify-between gap-4">
              <Link
                to="/app/chat"
                className="gd-shell-brand"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="gd-sidebar-brand luxury-brand-text">G&D</span>
                <span className="gd-shell-brand-caption">Your study workspace</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="gd-shell-icon-button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={openNewChat}
              className="gd-shell-new-chat flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" />
              New chat
            </button>
          </div>

          {/* Navigation and history share one scroll region on short screens. */}
          <div className="gd-no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
            <nav className="gd-shell-navigation" aria-label="Study tools">
              <div className="gd-shell-nav-section">
                <p className="gd-shell-section-label">Study</p>
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/chat")}
                  icon={<MessageSquare className="h-4 w-4" />}
                  label="Chat"
                  onPick={() => goToMobileRoute("/app/chat")}
                />
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/clerking")}
                  icon={<ClipboardList className="h-4 w-4" />}
                  label="Patient clerking"
                  onPick={() => goToMobileRoute("/app/clerking")}
                />
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/library")}
                  icon={<BookOpen className="h-4 w-4" />}
                  label="Library"
                  onPick={() => goToMobileRoute("/app/library")}
                  tourAnchor="nav-library"
                />
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/studybody")}
                  icon={<ListChecks className="h-4 w-4" />}
                  label="Practice questions"
                  onPick={() => goToMobileRoute("/app/studybody")}
                  tourAnchor="nav-pq"
                />
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/last-minute")}
                  icon={<TimerReset className="h-4 w-4" />}
                  label="Last Minute"
                  onPick={() => goToMobileRoute("/app/last-minute")}
                  tourAnchor="nav-last-minute"
                />
              </div>
              <div className="gd-shell-nav-section">
                <p className="gd-shell-section-label">Community</p>
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/leaderboard")}
                  icon={<Trophy className="h-4 w-4" />}
                  label="Leaderboard"
                  onPick={() => goToMobileRoute("/app/leaderboard")}
                  tourAnchor="nav-leaderboard"
                />
                {socialEnabled(user) && (
                  <MobileDrawerNavItem
                    active={location.pathname.startsWith("/app/friends")}
                    icon={<Users className="h-4 w-4" />}
                    label="Friends"
                    onPick={() => goToMobileRoute("/app/friends")}
                    tourAnchor="nav-friends"
                  />
                )}
                {socialEnabled(user) && (
                  <MobileDrawerNavItem
                    active={location.pathname.startsWith("/app/battle-royale")}
                    icon={<Swords className="h-4 w-4" />}
                    label="Battle Royale"
                    onPick={() => goToMobileRoute("/app/battle-royale")}
                    tourAnchor="nav-battle-royale"
                  />
                )}
              </div>
              <div className="gd-shell-nav-section">
                <p className="gd-shell-section-label">Your space</p>
                <MobileDrawerNavItem
                  active={location.pathname.startsWith("/app/history")}
                  icon={<Clock className="h-4 w-4" />}
                  label="History"
                  onPick={() => goToMobileRoute("/app/history")}
                  tourAnchor="nav-history"
                />
                <MobileDrawerNavItem
                  active={false}
                  expanded={navMoreOpen}
                  icon={
                    navMoreOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <MoreHorizontal className="h-4 w-4" />
                    )
                  }
                  label="More"
                  dot={!navMoreOpen && !profile?.personalization_background}
                  onPick={() => setNavMoreOpen((open) => !open)}
                />
                {navMoreOpen && (
                  <>
                    <MobileDrawerNavItem
                      active={false}
                      icon={<Sparkles className="h-4 w-4" />}
                      label="Personalize"
                      dot={!profile?.personalization_background}
                      onPick={() => {
                        setMobileMenuOpen(false);
                        setPersonalizeOpen(true);
                      }}
                    />
                    <MobileDrawerNavItem
                      active={location.pathname.startsWith("/app/feedback")}
                      icon={<Heart className="h-4 w-4" />}
                      label="Feedback"
                      onPick={() => goToMobileRoute("/app/feedback")}
                    />
                    {profile?.is_admin && (
                      <MobileDrawerNavItem
                        active={location.pathname.startsWith("/app/admin")}
                        icon={<ShieldCheck className="h-4 w-4" />}
                        label="Admin"
                        onPick={() => goToMobileRoute("/app/admin")}
                      />
                    )}
                  </>
                )}
              </div>
            </nav>
            <div className="gd-shell-history mt-4 pt-4">
              <p className="gd-shell-section-label">Recent conversations</p>
              {recentConvos.length === 0 ? (
                <div className="gd-shell-empty-history">
                  <MessageSquare className="h-4 w-4" />
                  <p>
                    {isGuest
                      ? "Guest chats are not saved."
                      : "Your conversations will appear here."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(
                    [
                      ["Today", groupedRecentConvos.today],
                      ["Yesterday", groupedRecentConvos.yesterday],
                      ["This week", groupedRecentConvos.thisWeek],
                      ["This month", groupedRecentConvos.thisMonth],
                      ["Older", groupedRecentConvos.older],
                    ] as const
                  ).map(([title, items]) => (
                    <MobileConvoGroup
                      key={title}
                      title={title}
                      items={items}
                      activeId={activeConvoId}
                      onPick={(id) => {
                        navigate({ to: "/app/chat", search: { c: id } });
                        setMobileMenuOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            className="gd-shell-footer gd-no-scrollbar max-h-[45%] shrink-0 overflow-y-auto border-t border-border/50 px-3 py-3"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            {renderAccountCard()}
            <ThemePicker className="gd-shell-theme-picker mt-3" />
            <div className="gd-shell-account-actions mt-2">
              <button
                type="button"
                data-tour="tour-launcher"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setTourOpen(true);
                }}
                className="gd-shell-footer-action"
              >
                <Map className="h-3.5 w-3.5" />
                Guide
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!(await confirmAndSignOut())) return;
                  setMobileMenuOpen(false);
                  navigate({ to: "/" });
                }}
                className="gd-shell-footer-action"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setShowDeleteDialog(true);
                }}
                title="Delete account"
                aria-label="Delete account"
                className="gd-shell-delete-action"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </aside>

        <main
          inert={mobileMenuOpen}
          onTouchStart={onContentTouchStart}
          onTouchEnd={onContentTouchEnd}
          className="gd-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:pb-0"
        >
          {isGuest && (
            <Link
              to="/auth"
              search={{ mode: "upgrade" }}
              className="z-10 block shrink-0 border-b border-primary/20 bg-primary/10 px-4 py-2 text-center text-xs font-medium text-foreground transition-colors hover:bg-primary/15"
            >
              You're exploring as a guest - <span className="underline">create a free account</span>{" "}
              to keep your documents and chats.
            </Link>
          )}
          <Outlet />
        </main>
      </div>

      {/* Personalize: the sidebar's permanent door into the "who I am" import.
          Unlike the in-chat card it stays available after the background is
          saved, and opens with the saved text loaded so it can be revised. */}
      <Dialog open={personalizeOpen} onOpenChange={setPersonalizeOpen}>
        <DialogContent className="luxury-panel max-h-[88dvh] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-h-[85vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-pop" />
              Personalize G&amp;D
            </DialogTitle>
            <DialogDescription>
              {profile?.personalization_background
                ? "This is what G&D knows about you. Edit it any time - saving an empty box clears it."
                : "Bring what another AI already knows about you into G&D."}
            </DialogDescription>
          </DialogHeader>
          <PersonalizationPanel
            variant="plain"
            initialBackground={profile?.personalization_background ?? ""}
            onSave={persistPersonalization}
            note={
              isGuest ? (
                <>
                  You're in a guest session - this saves, but it's lost if you sign out.{" "}
                  <Link to="/auth" search={{ mode: "upgrade" }} className="underline">
                    Create a free account
                  </Link>{" "}
                  to keep it.
                </>
              ) : undefined
            }
          />
        </DialogContent>
      </Dialog>

      {/* The two cards the shell still puts in front of the app. Both are
          rare - once per rank, and once ever - which is what earns them the
          interruption. */}
      <RankUpCelebration
        rank={rankUp}
        points={gamification.points}
        activeDays={gamification.activeDays}
        onDismiss={() => {
          setRankUp(null);
        }}
      />
      <UploadBonusUnlockCelebration
        total={uploadBonusUnlockTotal}
        onDismiss={() => setUploadBonusUnlockTotal(null)}
      />
      <CookieEmptyDialog
        open={cookieDialog != null}
        onOpenChange={(open) => {
          if (!open) setCookieDialog(null);
        }}
        remaining={cookieDialog?.remaining ?? null}
        allowance={cookieDialog?.allowance ?? null}
        handle={profile.username || profile.name}
      />
      <FeatureTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        userId={user?.id}
        social={socialEnabled(user)}
        onOpenMobileNav={() => setMobileMenuOpen(true)}
        onCloseMobileNav={() => setMobileMenuOpen(false)}
      />
    </div>
  );
}

function MobileDrawerNavItem({
  active,
  icon,
  label,
  onPick,
  tourAnchor,
  dot = false,
  expanded,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onPick: () => void;
  // On mobile the drawer holds the only copy of these entries, so the tour
  // spotlights them here instead of in the (hidden) sidebar.
  tourAnchor?: string;
  /** The quiet unset marker - a small accent pip on the icon, no badge or count. */
  dot?: boolean;
  /** Only passed by a row that discloses others, so the fold is announced. */
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      data-tour={tourAnchor}
      onClick={onPick}
      aria-expanded={expanded}
      aria-current={active ? "page" : undefined}
      className={`gd-shell-drawer-nav-item ${active ? "is-active" : ""} flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      }`}
    >
      <span className="relative flex shrink-0 items-center">
        {icon}
        {dot && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-pop"
          />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

// One dated block of the desktop sidebar's chat history. Ported from the chat
// page's ConvoGroup, with two deliberate changes: the row is a <Link> (so the
// browser's open-in-new-tab / middle-click still work, which the old <div
// onClick> broke), and the delete button is a SIBLING of that link rather than
// nested inside it - a button inside an anchor is invalid HTML and swallows
// keyboard activation.
function SidebarConvoGroup({
  title,
  items,
  activeId,
  onDelete,
}: {
  title: string;
  items: ConversationRow[];
  activeId?: string;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <p className="gd-shell-history-date px-3 pb-1">{title}</p>
      <ul className="space-y-0.5">
        {items.map((convo) => {
          const label = convo.title || "New conversation";
          const active = activeId === convo.id;
          return (
            <li key={convo.id} className="group/convo relative">
              <Link
                to="/app/chat"
                search={{ c: convo.id }}
                title={label}
                aria-current={active ? "page" : undefined}
                className={`gd-shell-conversation block truncate rounded-lg py-2 pl-3 pr-8 text-[12px] transition-colors ${
                  active
                    ? "bg-foreground/[0.07] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
                }`}
              >
                {label}
              </Link>
              <button
                type="button"
                onClick={() => onDelete(convo.id)}
                title="Delete chat"
                aria-label={`Delete chat: ${label}`}
                // Hidden until the row is hovered, but always reachable by
                // keyboard - focus-visible brings it back.
                className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-destructive focus-visible:opacity-100 group-hover/convo:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MobileConvoGroup({
  title,
  items,
  activeId,
  onPick,
}: {
  title: string;
  items: ConversationRow[];
  activeId?: unknown;
  onPick: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="w-full">
      <p className="gd-shell-history-date px-3 pb-1">{title}</p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            aria-current={activeId === item.id ? "page" : undefined}
            className={`gd-shell-conversation w-full rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
              activeId === item.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="block truncate font-medium">{item.title || "New conversation"}</span>
            {item.updated_at && (
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {new Date(item.updated_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
