import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  BookOpen,
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
import { rememberRoute } from "@/lib/last-route";
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
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ strict: false }) as { c?: string };
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileConvos, setMobileConvos] = useState<ConversationRow[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  // Touch-gesture trackers (declared up here so the Hook order is stable across
  // the early returns below).
  const contentTouchRef = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const drawerTouchRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth", replace: true });
    else if (profile && !profile.onboarded) navigate({ to: "/onboarding", replace: true });
  }, [loading, user, profile, navigate]);

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
      .limit(30)
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

  const groupedMobileConvos = useMemo(() => {
    const today: ConversationRow[] = [];
    const older: ConversationRow[] = [];
    const now = Date.now();

    for (const convo of mobileConvos) {
      const timestamp = convo.updated_at ? new Date(convo.updated_at).getTime() : 0;
      const ageDays = (now - timestamp) / (1000 * 60 * 60 * 24);
      if (ageDays < 1) today.push(convo);
      else older.push(convo);
    }

    return { today, older };
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
  // Chat from any other screen (and opens the menu when already on Chat) — the
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

  const navItem = (to: string, icon: ReactNode, label: string) => {
    const active = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "border border-primary/15 bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
        } ${isSidebarCollapsed ? "justify-center" : ""}`}
        title={isSidebarCollapsed ? label : undefined}
      >
        {icon}
        {!isSidebarCollapsed && <span>{label}</span>}
      </Link>
    );
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
              This permanently deletes your account and all associated data — documents,
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

      <div className="symbiote-blob app-blob-one" />
      <div className="symbiote-blob app-blob-two" />

      {isSidebarHidden && (
        <button
          onClick={() => setIsSidebarHidden(false)}
          className="fixed left-4 top-4 z-50 hidden rounded-md border border-border bg-background/80 p-2 text-muted-foreground backdrop-blur hover:text-foreground md:inline-flex"
          title="Show navigation"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <aside
        className={`${isSidebarHidden ? "hidden" : "hidden md:flex"} flex-col border-r border-border bg-background/75 backdrop-blur transition-[width] duration-300 md:shrink-0 ${isSidebarCollapsed ? "md:w-20 xl:w-20" : "md:w-56 xl:w-64"}`}
      >
        <div
          className={`flex items-center border-b border-border ${
            isSidebarCollapsed ? "justify-center p-4" : "justify-between p-5"
          }`}
        >
          {!isSidebarCollapsed && (
            <Link to="/app/chat" className="luxury-brand-text">
              G&D
            </Link>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => setIsSidebarHidden(true)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
              title="Hide sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItem("/app/chat", <MessageSquare className="h-4 w-4 shrink-0" />, "Chat")}
          {navItem("/app/library", <BookOpen className="h-4 w-4 shrink-0" />, "Library")}
          {navItem("/app/history", <Clock className="h-4 w-4 shrink-0" />, "History")}
          {navItem("/app/studybody", <Map className="h-4 w-4 shrink-0" />, "StudyBody")}
          {navItem("/app/feedback", <Heart className="h-4 w-4 shrink-0" />, "Feedback")}
          {navItem("/app/settings", <Settings className="h-4 w-4 shrink-0" />, "Settings")}
        </nav>
        <div
          className={`border-t border-border ${
            isSidebarCollapsed ? "flex flex-col items-center gap-3 p-3" : "p-3"
          }`}
        >
          {!isSidebarCollapsed && (
            <div className="mb-1 px-3 py-2">
              <div className="truncate text-sm font-medium">{profile.name || "Student"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[profile.year, profile.university].filter(Boolean).join(" - ")}
              </div>
            </div>
          )}
          <div className={isSidebarCollapsed ? "" : "mb-2 px-3"}>
            <ThemeToggle className={isSidebarCollapsed ? "" : "w-full"} />
          </div>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
            className={`flex items-center text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground ${
              isSidebarCollapsed
                ? "justify-center rounded-lg p-2"
                : "w-full gap-3 rounded-lg px-3 py-2 text-sm font-medium"
            }`}
            title={isSidebarCollapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>Sign out</span>}
          </button>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className={`flex items-center text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-destructive ${
              isSidebarCollapsed
                ? "justify-center rounded-lg p-2"
                : "w-full gap-3 rounded-lg px-3 py-2 text-sm font-medium"
            }`}
            title={isSidebarCollapsed ? "Delete account" : undefined}
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>Delete account</span>}
          </button>
        </div>
      </aside>

      <div
        className="mobile-app-topbar sticky top-0 z-[60] flex shrink-0 items-center justify-between border-b border-border bg-background px-3 shadow-[0_10px_24px_rgba(0,0,0,0.18)] md:hidden"
        style={{
          height: "calc(3rem + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-primary/25 bg-surface text-foreground"
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          title={mobileMenuOpen ? "Close menu" : "Menu"}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/app/chat" className="luxury-brand-text small">
          G&D
        </Link>
        <button
          type="button"
          onClick={openNewChat}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-foreground"
          aria-label="New chat"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Backdrop — tap outside the drawer to close it. */}
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
          className={`fixed inset-y-0 left-0 z-50 flex w-[78vw] max-w-[18rem] flex-col overflow-y-auto border-r border-[#2a2a26] bg-[#060606] px-2.5 pb-3 text-[#e4e4cc] shadow-[18px_0_36px_rgba(0,0,0,0.44)] transition-transform duration-200 ease-out will-change-transform md:hidden ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{ paddingTop: "calc(3rem + env(safe-area-inset-top) + 0.5rem)" }}
        >
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-between pb-0.5">
              <span className="luxury-brand-text small">G&D</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#2a2a26] text-[#e4e4cc]"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={openNewChat}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#e4e4cc] px-3 py-2 text-sm font-bold text-[#060606] shadow-[0_12px_32px_rgba(228,228,204,0.12)]"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
            </div>

            <nav className="grid gap-1.5">
              <MobileDrawerNavItem
                active={location.pathname.includes("chat")}
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                label="Chat"
                onPick={() => goToMobileRoute("/app/chat")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("library")}
                icon={<BookOpen className="h-3.5 w-3.5" />}
                label="Library"
                onPick={() => goToMobileRoute("/app/library")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("history")}
                icon={<Clock className="h-3.5 w-3.5" />}
                label="History"
                onPick={() => goToMobileRoute("/app/history")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("studybody")}
                icon={<Map className="h-3.5 w-3.5" />}
                label="StudyBody"
                onPick={() => goToMobileRoute("/app/studybody")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("feedback")}
                icon={<Heart className="h-3.5 w-3.5" />}
                label="Feedback"
                onPick={() => goToMobileRoute("/app/feedback")}
              />
              <MobileDrawerNavItem
                active={location.pathname.includes("settings")}
                icon={<Settings className="h-3.5 w-3.5" />}
                label="Settings"
                onPick={() => goToMobileRoute("/app/settings")}
              />
            </nav>

            <div className="border-t border-[#2a2a26] pt-2">
              <p className="text-center text-[10px] font-bold uppercase tracking-wide text-[#b6b4ab]">
                Chat history
              </p>
              {mobileConvos.length === 0 ? (
                <p className="py-1.5 text-center text-xs font-medium text-[#b6b4ab]">
                  No chats yet.
                </p>
              ) : (
                <div className="space-y-2">
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

            <div className="border-t border-[#2a2a26] pt-2">
              <div className="mb-1 px-1 text-left">
                <div className="truncate text-xs font-semibold">{profile.name || "Student"}</div>
                <div className="truncate text-[11px] text-[#b6b4ab]">
                  {[profile.year, profile.university].filter(Boolean).join(" - ")}
                </div>
              </div>
              <div className="mb-1 flex w-full items-center justify-between rounded-lg px-1 py-1">
                <span className="text-xs font-semibold text-[#e4e4cc]">Appearance</span>
                <ThemeToggle />
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  setMobileMenuOpen(false);
                  navigate({ to: "/" });
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-xs font-semibold text-[#e4e4cc] hover:bg-[#1b1b19]"
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
                className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-xs font-semibold text-red-400 hover:bg-[#1b1b19]"
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
          <Outlet />
        </main>

        {!onChat && (
          <button
            type="button"
            onClick={openNewChat}
            aria-label="Start a new chat"
            className="fixed right-4 z-30 inline-flex items-center gap-2 rounded-full bg-gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-transform active:scale-95 md:hidden"
            style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
        )}
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
      className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-bold transition-colors ${
        active
          ? "border border-[#e4e4cc] bg-[#e4e4cc] text-[#060606] shadow-[0_12px_28px_rgba(228,228,204,0.12)]"
          : "border border-[#b6b4ab] bg-[#e4e4cc] text-[#060606] shadow-[0_8px_22px_rgba(0,0,0,0.24)] hover:bg-white"
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
      <p className="px-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-[#b6b4ab]">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            className={`w-full rounded-lg border px-3 py-1.5 text-left text-xs font-semibold transition-colors ${
              activeId === item.id
                ? "border-[#e4e4cc] bg-[#e4e4cc] text-[#060606]"
                : "border-[#2a2a26] bg-[#1b1b19] text-[#e4e4cc] hover:border-[#b6b4ab]"
            }`}
          >
            <span className="block truncate">{item.title || "New conversation"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
