import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  BookOpen,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  TimerReset,
  Trophy,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { AppShellSkeleton } from "@/components/app-skeletons";
import { useAuth } from "@/lib/auth-context";
import { isGuestUser } from "@/lib/guest-session";
import { rememberRoute } from "@/lib/last-route";
import {
  emptyGamificationStats,
  levelFromPoints,
  loadGamificationStats,
  recordGamificationEvent,
  type GamificationStats,
} from "@/lib/gamification";
import { supabase } from "@/integrations/supabase/client";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

export function AppShell() {
  return <AppLayout />;
}

function AppLayout() {
  const { user, profile, loading, authError, refreshProfile, signOut, deleteAccount } = useAuth();
  const isGuest = isGuestUser(user);
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ strict: false }) as { c?: string };
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileConvos, setMobileConvos] = useState<ConversationRow[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [hideMobileTopbar, setHideMobileTopbar] = useState(false);
  const [gamification, setGamification] =
    useState<GamificationStats>(emptyGamificationStats);

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

  useEffect(() => {
    if (!user) {
      setMobileConvos([]);
      return;
    }

    let active = true;
    supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.warn("load mobile conversations", error);
          return;
        }
        setMobileConvos((data as ConversationRow[]) ?? []);
      });

    return () => {
      active = false;
    };
  }, [location.pathname, user]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.searchStr]);

  // Remember where the user is so reopening the app returns them here.
  useEffect(() => {
    rememberRoute(location.pathname);
  }, [location.pathname]);

  // My Coach and Practice are content-heavy - collapse the sidebar on entry so
  // they get the full width. The user can still expand it with the toggle.
  useEffect(() => {
    if (
      location.pathname.startsWith("/app/studybody") ||
      location.pathname.startsWith("/app/practice")
    ) {
      setIsSidebarCollapsed(true);
    }
  }, [location.pathname]);

  const groupedMobileConvos = useMemo(() => {
    const today: ConversationRow[] = [];
    const yesterday: ConversationRow[] = [];
    const thisWeek: ConversationRow[] = [];
    const thisMonth: ConversationRow[] = [];
    const older: ConversationRow[] = [];
    const now = Date.now();

    for (const convo of mobileConvos) {
      const ts = convo.updated_at ? new Date(convo.updated_at).getTime() : 0;
      const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
      if (ageDays < 1) today.push(convo);
      else if (ageDays < 2) yesterday.push(convo);
      else if (ageDays < 7) thisWeek.push(convo);
      else if (ageDays < 30) thisMonth.push(convo);
      else older.push(convo);
    }

    return { today, yesterday, thisWeek, thisMonth, older };
  }, [mobileConvos]);

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

  const openNewChat = () => {
    setMobileMenuOpen(false);
    navigate({ to: "/app/chat", search: {} });
    window.setTimeout(() => window.dispatchEvent(new Event("gd:new-chat")), 0);
  };

  const goToMobileRoute = (
    to:
      | "/app/chat"
      | "/app/library"
      | "/app/last-minute"
      | "/app/history"
      | "/app/studybody"
      | "/app/feedback"
      | "/app/settings",
  ) => {
    setMobileMenuOpen(false);
    navigate({ to });
  };

  const onChat = location.pathname.startsWith("/app/chat");

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
  ) => {
    const active = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
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
        >
          {label}
        </span>
      </Link>
    );
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
          className={`flex items-center transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isSidebarCollapsed ? "justify-center px-4 py-5" : "justify-between px-5 py-5"
          }`}
        >
          <Link
            to="/app/chat"
            className={`gd-sidebar-brand luxury-brand-text overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isSidebarCollapsed
                ? "max-w-0 -translate-x-2 opacity-0"
                : "max-w-24 translate-x-0 opacity-100"
            }`}
            aria-hidden={isSidebarCollapsed}
            tabIndex={isSidebarCollapsed ? -1 : undefined}
          >
            G&D
          </Link>
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
        <nav className="flex-1 space-y-6 px-3 py-2">
          {!isSidebarCollapsed && <p className="gd-nav-label px-3">Study space</p>}
          <div className="space-y-1">
            {navItem("/app/chat", <MessageSquare className="h-4 w-4 shrink-0" />, "Chat", "blue")}
            {navItem("/app/library", <BookOpen className="h-4 w-4 shrink-0" />, "Library", "blue")}
            {navItem("/app/studybody", <BrainCircuit className="h-4 w-4 shrink-0" />, "My Coach", "violet")}
            {navItem("/app/last-minute", <TimerReset className="h-4 w-4 shrink-0" />, "Last Minute", "coral")}
          </div>
          <div className="space-y-1 border-t border-border/60 pt-5">
            {!isSidebarCollapsed && <p className="gd-nav-label px-3">Your work</p>}
            {navItem("/app/history", <Clock className="h-4 w-4 shrink-0" />, "History")}
            {navItem("/app/leaderboard", <Trophy className="h-4 w-4 shrink-0" />, "Leaderboard", "amber")}
            {navItem("/app/feedback", <Heart className="h-4 w-4 shrink-0" />, "Feedback")}
            {navItem("/app/settings", <Settings className="h-4 w-4 shrink-0" />, "Settings")}
          </div>
        </nav>
        <div
          className={`border-t border-border/70 ${
            isSidebarCollapsed ? "flex flex-col items-center gap-3 p-4" : "p-4"
          }`}
        >
          <div
            className={`gd-sidebar-profile overflow-hidden px-2 transition-all duration-300 ${
              isSidebarCollapsed
                ? "mb-0 max-h-0 -translate-y-1 opacity-0"
                : "mb-3 max-h-14 translate-y-0 opacity-100"
            }`}
            aria-hidden={isSidebarCollapsed}
          >
            <div className="flex items-center gap-2">
              <span className="gd-profile-mark">{(profile.name || "S").slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{profile.name || "Student"}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {gamification.points} pts - L{levelFromPoints(gamification.points)} -{" "}
                  {gamification.currentStreak}d
                </div>
              </div>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[profile.year, profile.university].filter(Boolean).join(" - ")}
            </div>
          </div>
          <div className={isSidebarCollapsed ? "" : "mb-2 px-3"}>
            <ThemeToggle showLabel={!isSidebarCollapsed} />
          </div>
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
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span
              className={`whitespace-nowrap transition-all duration-300 ${
                isSidebarCollapsed
                  ? "max-w-0 -translate-x-2 opacity-0"
                  : "max-w-24 translate-x-0 opacity-100"
              }`}
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
          className={`fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-[19rem] flex-col border-r border-border/60 bg-background/98 text-foreground shadow-[20px_0_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform will-change-transform md:hidden ${
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
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("last-minute")}
                icon={<TimerReset className="h-4 w-4" />}
                label="Last Minute"
                onPick={() => goToMobileRoute("/app/last-minute")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("studybody")}
                icon={<BrainCircuit className="h-4 w-4" />}
                label="My Coach"
                onPick={() => goToMobileRoute("/app/studybody")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("history")}
                icon={<Clock className="h-4 w-4" />}
                label="History"
                onPick={() => goToMobileRoute("/app/history")}
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
            </nav>
          </div>

          {/* ── Scrollable chat history ── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border/50 px-3 py-3">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent chats
            </p>
            {mobileConvos.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No chats yet. Start one above!</p>
              </div>
            ) : (
              <div className="space-y-3">
                <MobileConvoGroup
                  title="Today"
                  items={groupedMobileConvos.today}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="Yesterday"
                  items={groupedMobileConvos.yesterday}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="This week"
                  items={groupedMobileConvos.thisWeek}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="This month"
                  items={groupedMobileConvos.thisMonth}
                  activeId={search.c}
                  onPick={(id) => {
                    navigate({ to: "/app/chat", search: { c: id } });
                    setMobileMenuOpen(false);
                  }}
                />
                <MobileConvoGroup
                  title="Older"
                  items={groupedMobileConvos.older}
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
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight">
                  {profile.name || "Student"}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {[profile.year, profile.university].filter(Boolean).join(" · ")}
                </div>
              </div>
              <ThemeToggle />
            </div>
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
    </div>
  );
}

function MobileDrawerNavItem({
  active,
  icon,
  label,
  onPick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
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
