import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  BookOpen,
  BrainCircuit,
  ChevronLeft,
  Clock,
  Heart,
  LogOut,
  Map,
  Menu,
  MessageSquare,
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
import { RankUpCelebration } from "@/components/rank-up-celebration";
import { StreakOpening } from "@/components/streak-opening";
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { rankProgress, type AcademicRank } from "@/lib/ranks";
import { takeRankCelebration, takeStreakOpening } from "@/lib/progression-moments";
import { useAuth } from "@/lib/auth-context";
import { isGuestUser } from "@/lib/guest-session";
import { socialEnabled } from "@/lib/social";
import { rememberRoute } from "@/lib/last-route";
import {
  emptyGamificationStats,
  loadGamificationStats,
  pointsAvailableToday,
  recordGamificationEvent,
  weekendMissionFor,
  type GamificationStats,
} from "@/lib/gamification";
import { getCached, setCached } from "@/lib/data-cache";
import { supabase } from "@/integrations/supabase/client";

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
  // The two progression moments. Both are centred cards, and both decide
  // whether they may run at all in src/lib/progression-moments.ts.
  const [rankUp, setRankUp] = useState<AcademicRank | null>(null);
  const [streakOpeningOpen, setStreakOpeningOpen] = useState(false);
  // The opening streak card is offered once per mount, not once per navigation.
  const streakOfferedRef = useRef(false);

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
  // shell has actually rendered its nav), offer the guided tour. Seen-state
  // lives in localStorage, so it never fires twice on a device.
  useEffect(() => {
    if (loading || !profile || hasSeenTour()) return;
    const timer = window.setTimeout(() => setTourOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [loading, profile]);

  // Theme the whole app to the student's discipline (medicine/law) via a
  // root attribute, parallel to the .dark/.light theme classes. Guests and
  // pre-discipline profiles get no attribute -> the neutral default theme.
  useEffect(() => {
    const root = document.documentElement;
    const discipline = profile?.discipline;
    if (discipline === "medicine" || discipline === "law") {
      root.dataset.discipline = discipline;
    } else {
      delete root.dataset.discipline;
    }
    return () => {
      delete root.dataset.discipline;
    };
  }, [profile?.discipline]);

  // Touch-gesture trackers (declared up here so the Hook order is stable across
  // the early returns below).
  const contentTouchRef = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const drawerTouchRef = useRef<{ x: number; y: number } | null>(null);

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

  // The opening streak card. Gated hard, because it sits between a student and
  // the thing they opened the app to do:
  //   - never during the first-run tour (one at a time)
  //   - never for a brand-new student who has not seen the tour yet
  //   - never on a 0-day streak, and at most once per device per day, both
  //     enforced by takeStreakOpening()
  useEffect(() => {
    if (loading || !user || !profile || streakOfferedRef.current) return;
    if (tourOpen || !hasSeenTour()) return;
    if (gamification.currentStreak < 1) return;
    streakOfferedRef.current = true;
    if (!takeStreakOpening(gamification.currentStreak)) return;
    // Behind the shell's own paint, so it arrives beside the app rather than
    // in front of it. Nothing waits on this.
    const timer = window.setTimeout(() => setStreakOpeningOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [loading, user, profile, tourOpen, gamification.currentStreak]);

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

  // Remember where the user is so reopening the app returns them here.
  useEffect(() => {
    rememberRoute(location.pathname);
  }, [location.pathname]);

  // My Coach and Practice are content-heavy - collapse the sidebar on entry so
  // they get the full width. The user can still expand it with the logo.
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
      | "/app/library"
      | "/app/last-minute"
      | "/app/history"
      | "/app/studybody"
      | "/app/friends"
      | "/app/battle-royale"
      | "/app/feedback"
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

  // Content edge-swipe: a right-swipe starting at the very left edge returns to
  // Chat from any other screen (and opens the menu when already on Chat) - the
  // iOS-style "back to the core experience" gesture, no button press needed.
  const onContentTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    contentTouchRef.current = { x: touch.clientX, y: touch.clientY, edge: touch.clientX <= 28 };
  };
  const onContentTouchEnd = (event: React.TouchEvent) => {
    const start = contentTouchRef.current;
    contentTouchRef.current = null;
    if (!start || !start.edge || mobileMenuOpen) return;
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
              : "max-w-32 translate-x-0 opacity-100"
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
  // of routing (currently just Personalize). `dot` is the quiet unset marker -
  // no badge, no count, just a small accent pip.
  const navAction = (
    icon: ReactNode,
    label: string,
    onPick: () => void,
    accent: "blue" | "violet" | "coral" | "amber" | "slate" = "slate",
    dot = false,
  ) => (
    <button
      type="button"
      onClick={onPick}
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
            : "max-w-32 translate-x-0 opacity-100"
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

  return (
    <div className="luxury-app-shell flex h-dvh min-h-dvh flex-col overflow-hidden bg-background md:flex-row">
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
        className={`gd-app-sidebar hidden md:flex flex-col overflow-hidden border-r border-border/70 bg-background/95 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:shrink-0 ${isSidebarCollapsed ? "md:w-16 xl:w-16" : "md:w-60 xl:w-64"}`}
      >
        <div
          className={`flex shrink-0 items-center transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
              <Link to="/app/chat" className="gd-sidebar-brand luxury-brand-text whitespace-nowrap">
                G&D
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
            className={`flex items-center overflow-hidden rounded-lg border border-border/70 text-foreground transition-colors hover:border-pop/40 hover:bg-foreground/[0.05] ${
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
          <nav className="shrink-0 space-y-6 px-3 py-2">
            {!isSidebarCollapsed && <p className="gd-nav-label px-3">Study space</p>}
            <div className="space-y-1">
              {navItem("/app/chat", <MessageSquare className="h-4 w-4 shrink-0" />, "Chat", "blue")}
              {navItem(
                "/app/library",
                <BookOpen className="h-4 w-4 shrink-0" />,
                "Library",
                "blue",
                "nav-library",
              )}
              {navItem(
                "/app/studybody",
                <BrainCircuit className="h-4 w-4 shrink-0" />,
                "My Coach",
                "violet",
                "nav-studybody",
              )}
              {navItem(
                "/app/last-minute",
                <TimerReset className="h-4 w-4 shrink-0" />,
                "Last Minute",
                "coral",
                "nav-last-minute",
              )}
            </div>
            <div className="space-y-1 border-t border-border/60 pt-5">
              {!isSidebarCollapsed && <p className="gd-nav-label px-3">Your work</p>}
              {navItem(
                "/app/history",
                <Clock className="h-4 w-4 shrink-0" />,
                "History",
                "slate",
                "nav-history",
              )}
              {navItem(
                "/app/leaderboard",
                <Trophy className="h-4 w-4 shrink-0" />,
                "Leaderboard",
                "amber",
              )}
              {/* Hidden entirely until the social migration is applied, and
                  hidden from guests always — see socialEnabled(). The route
                  still exists; this only decides whether it is advertised. */}
              {socialEnabled(user) &&
                navItem("/app/friends", <Users className="h-4 w-4 shrink-0" />, "Friends", "coral")}
              {/* Same gate as Friends — a battle needs an opponent, which needs
                  the same schema. Last Minute keeps its own slot below
                  unchanged; unlike mobile (four tabs only), the sidebar has
                  room to add this rather than replace anything. */}
              {socialEnabled(user) &&
                navItem(
                  "/app/battle-royale",
                  <Swords className="h-4 w-4 shrink-0" />,
                  "Battle Royale",
                  "coral",
                )}
              {navAction(
                <Sparkles className="h-4 w-4 shrink-0" />,
                "Personalize",
                () => setPersonalizeOpen(true),
                "violet",
                !profile?.personalization_background,
              )}
              {navItem("/app/feedback", <Heart className="h-4 w-4 shrink-0" />, "Feedback")}
              {/* Settings is not in this list any more - it lives with the account,
                as the gear in the footer user row (and at the foot of the
                collapsed rail). Same /app/settings route, one entry point. */}
              {profile?.is_admin &&
                navItem(
                  "/app/admin",
                  <ShieldCheck className="h-4 w-4 shrink-0" />,
                  "Admin",
                  "amber",
                )}
            </div>
          </nav>

          {/* "Recent" - the app's only chat history now that the chat page's
              own sidebar is gone, so it carries that sidebar's date grouping
              (Today / Yesterday / … / Older), its delete control and its
              empty + guest states rather than a flat capped list. */}
          {!isSidebarCollapsed && (
            <div className="px-3 pb-2 pt-5">
              <p className="gd-nav-label px-3 pb-2">Recent</p>
              {recentConvos.length === 0 ? (
                <p className="px-3 text-xs text-muted-foreground">
                  {isGuest ? "Guest chats are not saved." : "No chats yet."}
                </p>
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
        {/* The footer is pinned and never shrinks, so everything in it - the
            Appearance picker included - stays on screen. The max-height is the
            belt-and-braces case: on a viewport too short for even the footer
            (and the .brutal skin makes every row taller), it scrolls itself
            rather than letting its lower half be clipped away by the aside's
            overflow-hidden, which is how the theme picker went missing. */}
        <div
          className={`gd-no-scrollbar max-h-[55%] shrink-0 overflow-y-auto overscroll-contain border-t border-border/70 ${
            isSidebarCollapsed ? "flex flex-col items-center gap-3 p-3" : "p-4"
          }`}
        >
          {/* The account block. Collapsed it is the foot of the rail - settings
              gear above the avatar (screenshot A), pushed last by order-last so
              the guide/theme/sign-out icons stack above it. Expanded it is the
              pinned user row: avatar + name on the left, gear on the right. */}
          {isSidebarCollapsed ? (
            <div className="order-last flex flex-col items-center gap-3">
              {/* Collapsed, there is no room for a name or a bar, so the rail
                  carries the badge alone - the rank is still legible at a
                  glance and the title spells it out. */}
              <span title={`${rank.rank.name} · ${gamification.points.toLocaleString()} pts`}>
                <RankBadge rank={rank.rank} size="sm" />
              </span>
              <Link
                to="/app/settings"
                title="Settings"
                aria-label="Settings"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => chooseSidebarCollapsed(false)}
                title={`${profile.name || "Student"} - open menu`}
                aria-label={`${profile.name || "Student"} - open menu`}
                className="rounded-[0.45rem] transition-opacity hover:opacity-80"
              >
                <span className="gd-profile-mark">
                  {(profile.name || "S").slice(0, 1).toUpperCase()}
                </span>
              </button>
            </div>
          ) : (
            <div className="gd-sidebar-profile mb-3 px-2">
              <div className="flex items-center gap-2">
                <span className="gd-profile-mark shrink-0">
                  {(profile.name || "S").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{profile.name || "Student"}</div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <RankBadge rank={rank.rank} size="sm" className="h-4 w-4 rounded" />
                    <span className="truncate text-[11px] font-medium text-foreground">
                      {rank.rank.name}
                    </span>
                  </div>
                </div>
                <Link
                  to="/app/settings"
                  title="Settings"
                  aria-label="Settings"
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
              {/* Progress to the next rank, then the raw numbers underneath -
                  the bar answers "how close am I", the line answers "to what". */}
              <RankProgressBar percent={rank.percent} className="mt-2" />
              <div className="mt-1 truncate text-[11px] text-muted-foreground tabular-nums">
                {gamification.points.toLocaleString()} pts ·{" "}
                {rank.next
                  ? `${rank.pointsToNext.toLocaleString()} to ${rank.next.name}`
                  : "top rank"}{" "}
                · {gamification.currentStreak}d
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {[profile.year, profile.university].filter(Boolean).join(" - ")}
              </div>
            </div>
          )}
          <button
            type="button"
            data-tour="tour-launcher"
            onClick={() => setTourOpen(true)}
            title={isSidebarCollapsed ? "Guide" : "Replay the app guide"}
            aria-label="Replay the app guide"
            className={`mb-1 flex items-center text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground ${
              isSidebarCollapsed
                ? "justify-center rounded-lg p-2"
                : "w-full gap-3 rounded-lg px-3 py-2 text-sm font-medium"
            }`}
          >
            <Map className="h-4 w-4 shrink-0" />
            <span
              className={`whitespace-nowrap transition-all duration-300 ${
                isSidebarCollapsed
                  ? "max-w-0 -translate-x-2 opacity-0"
                  : "max-w-24 translate-x-0 opacity-100"
              }`}
              aria-hidden={isSidebarCollapsed}
            >
              Guide
            </span>
          </button>
          {/* Expanded, the side menu has room to show all four themes at once;
              collapsed it does not, so it falls back to the cycling button. */}
          {isSidebarCollapsed ? <ThemeToggle /> : <ThemePicker className="mb-2 px-3" />}
          <button
            onClick={async () => {
              if (await confirmAndSignOut()) navigate({ to: "/" });
            }}
            className={`flex items-center text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground ${
              isSidebarCollapsed
                ? "justify-center rounded-lg p-2"
                : "w-full gap-3 rounded-lg px-3 py-2 text-sm font-medium"
            }`}
            title={isSidebarCollapsed ? "Sign out" : undefined}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span
              className={`whitespace-nowrap transition-all duration-300 ${
                isSidebarCollapsed
                  ? "max-w-0 -translate-x-2 opacity-0"
                  : "max-w-24 translate-x-0 opacity-100"
              }`}
              aria-hidden={isSidebarCollapsed}
            >
              Sign out
            </span>
          </button>
          {!isSidebarCollapsed && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              Account deletion
            </button>
          )}
        </div>
      </aside>

      <div
        className={`mobile-app-topbar sticky top-0 z-[60] flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center justify-between overflow-hidden border-b border-border/70 bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform md:hidden ${
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
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          title={mobileMenuOpen ? "Close menu" : "Menu"}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/app/chat" className="luxury-brand-text small">
          G&D
        </Link>
        <div className="flex items-center gap-1.5">
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
          className={`fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] transition-opacity duration-200 md:hidden ${
            mobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        <aside
          onTouchStart={onDrawerTouchStart}
          onTouchEnd={onDrawerTouchEnd}
          aria-hidden={!mobileMenuOpen}
          className={`gd-mobile-menu fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-[19rem] flex-col border-r border-border/60 text-foreground shadow-[20px_0_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform will-change-transform md:hidden ${
            mobileMenuOpen
              ? "translate-x-0 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              : "-translate-x-full duration-200 ease-in"
          }`}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {/* ── Pinned top section: New Chat + Nav ── */}
          <div className="shrink-0 px-3 pb-3 pt-4">
            <button
              type="button"
              onClick={openNewChat}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-opacity active:opacity-80"
            >
              <Plus className="h-4 w-4" />
              New chat
            </button>

            <nav className="mt-3 grid gap-0.5">
              <MobileDrawerNavItem
                active={location.pathname.includes("chat")}
                icon={<MessageSquare className="h-4 w-4" />}
                label="Chat"
                onPick={() => goToMobileRoute("/app/chat")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("library")}
                icon={<BookOpen className="h-4 w-4" />}
                label="Library"
                onPick={() => goToMobileRoute("/app/library")}
                tourAnchor="nav-library"
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("last-minute")}
                icon={<TimerReset className="h-4 w-4" />}
                label="Last Minute"
                onPick={() => goToMobileRoute("/app/last-minute")}
                tourAnchor="nav-last-minute"
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("studybody")}
                icon={<BrainCircuit className="h-4 w-4" />}
                label="My Coach"
                onPick={() => goToMobileRoute("/app/studybody")}
                tourAnchor="nav-studybody"
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("history")}
                icon={<Clock className="h-4 w-4" />}
                label="History"
                onPick={() => goToMobileRoute("/app/history")}
                tourAnchor="nav-history"
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("leaderboard")}
                icon={<Trophy className="h-4 w-4" />}
                label="Leaderboard"
                onPick={() => {
                  setMobileMenuOpen(false);
                  navigate({ to: "/app/leaderboard" });
                }}
              />
              {/* Same gate as the desktop sidebar's Friends and Battle Royale
                  entries — see socialEnabled(). Kept in step with the sidebar
                  deliberately: the route resolves at any width, so it must be
                  reachable at any width too, and the drawer is the only nav
                  below md. Same order as the sidebar: Friends, then Battle
                  Royale, which is the opponent you pick from it. */}
              {socialEnabled(user) && (
                <MobileDrawerNavItem
                  active={location.pathname.includes("friends")}
                  icon={<Users className="h-4 w-4" />}
                  label="Friends"
                  onPick={() => goToMobileRoute("/app/friends")}
                />
              )}
              {socialEnabled(user) && (
                <MobileDrawerNavItem
                  active={location.pathname.includes("battle-royale")}
                  icon={<Swords className="h-4 w-4" />}
                  label="Battle Royale"
                  onPick={() => goToMobileRoute("/app/battle-royale")}
                />
              )}
              <MobileDrawerNavItem
                active={false}
                icon={<Sparkles className="h-4 w-4" />}
                label="Personalize"
                onPick={() => {
                  setMobileMenuOpen(false);
                  setPersonalizeOpen(true);
                }}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("feedback")}
                icon={<Heart className="h-4 w-4" />}
                label="Feedback"
                onPick={() => goToMobileRoute("/app/feedback")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("settings")}
                icon={<Settings className="h-4 w-4" />}
                label="Settings"
                onPick={() => goToMobileRoute("/app/settings")}
              />
              <MobileDrawerNavItem
                active={false}
                icon={<Map className="h-4 w-4" />}
                label="Guide"
                onPick={() => {
                  setMobileMenuOpen(false);
                  setTourOpen(true);
                }}
                tourAnchor="tour-launcher"
              />
            </nav>
          </div>

          {/* ── Scrollable chat history ── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border/50 px-3 py-3">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent chats
            </p>
            {recentConvos.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No chats yet. Start one above!</p>
              </div>
            ) : (
              <div className="space-y-3">
                <MobileConvoGroup
                  title="Today"
                  items={groupedRecentConvos.today}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="Yesterday"
                  items={groupedRecentConvos.yesterday}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="This week"
                  items={groupedRecentConvos.thisWeek}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="This month"
                  items={groupedRecentConvos.thisMonth}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="Older"
                  items={groupedRecentConvos.older}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Pinned footer: user info + actions ── */}
          <div
            className="shrink-0 border-t border-border/50 px-3 py-3"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            {/* The name had to share this row with the theme button, which
                truncated it early on narrow phones. It gets the full width now,
                and the theme control moves to its own row below. */}
            <div className="mb-2 min-w-0 px-1">
              <div className="truncate text-sm font-semibold leading-tight">
                {profile.name || "Student"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {[profile.year, profile.university].filter(Boolean).join(" · ")}
              </div>
            </div>
            <ThemePicker className="mb-3 px-1" />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={async () => {
                  if (!(await confirmAndSignOut())) return;
                  setMobileMenuOpen(false);
                  navigate({ to: "/" });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete account
              </button>
            </div>
          </div>
        </aside>

        <main
          onTouchStart={onContentTouchStart}
          onTouchEnd={onContentTouchEnd}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:pb-0"
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

      {/* A rank-up outranks the daily streak note, so it suppresses it: two
          centred cards at once is two things to dismiss. */}
      <RankUpCelebration
        rank={rankUp}
        points={gamification.points}
        onDismiss={() => {
          setRankUp(null);
        }}
      />
      <StreakOpening
        open={streakOpeningOpen && !rankUp}
        streak={gamification.currentStreak}
        points={gamification.points}
        mission={weekendMissionFor()}
        pointsAvailable={pointsAvailableToday(gamification)}
        onDismiss={() => setStreakOpeningOpen(false)}
      />

      <FeatureTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
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
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onPick: () => void;
  // On mobile the drawer holds the only copy of these entries, so the tour
  // spotlights them here instead of in the (hidden) sidebar.
  tourAnchor?: string;
}) {
  return (
    <button
      type="button"
      data-tour={tourAnchor}
      onClick={onPick}
      className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
        active
          ? "bg-primary/10 text-foreground shadow-[inset_2px_0_0_var(--primary)]"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      }`}
    >
      {icon}
      {label}
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
      <p className="gd-nav-label px-3 pb-1">{title}</p>
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
                className={`block truncate rounded-lg py-1.5 pl-3 pr-8 text-[13px] transition-colors ${
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
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <div className="divide-y divide-border/50">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            className={`w-full px-1 py-2.5 text-left text-xs transition-colors ${
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
