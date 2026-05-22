import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

export function AppShell() {
  return (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  );
}

function AppLayout() {
  const { user, profile, loading, authError, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ strict: false }) as { c?: string };
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileConvos, setMobileConvos] = useState<ConversationRow[]>([]);

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
    return (
      <div className="luxury-app-shell flex min-h-dvh items-center justify-center bg-background">
        <div className="symbiote-blob app-blob-one" />
        <div className="symbiote-blob app-blob-two" />
        <div className="relative z-10 luxury-brand-text small">G&D</div>
      </div>
    );
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
          {authError && (
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

  const goToMobileRoute = (to: "/app/chat" | "/app/library" | "/app/studybody") => {
    setMobileMenuOpen(false);
    navigate({ to });
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

  return (
    <div className="luxury-app-shell flex h-dvh min-h-dvh flex-col overflow-hidden bg-background md:flex-row">
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
          {navItem("/app/studybody", <Map className="h-4 w-4 shrink-0" />, "StudyBody")}
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

      {mobileMenuOpen && (
        <div
          className="relative z-40 shrink-0 overflow-y-auto border-b border-[#2f2a22] bg-[#0e0d0b] px-3 pb-3 pt-2.5 text-[#f5f0e8] shadow-[0_18px_40px_rgba(0,0,0,0.35)] md:hidden"
          style={{ maxHeight: "calc(100dvh - 3rem - env(safe-area-inset-top))" }}
        >
          <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
            <div>
              <button
                type="button"
                onClick={openNewChat}
                className="mx-auto flex min-h-10 w-[70%] max-w-[13.5rem] items-center justify-center gap-2 rounded-lg bg-[#f5f0e8] px-3 py-2 text-sm font-bold text-[#0e0d0b] shadow-[0_12px_32px_rgba(245,240,232,0.12)]"
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
                active={location.pathname.includes("studybody")}
                icon={<Map className="h-3.5 w-3.5" />}
                label="StudyBody"
                onPick={() => goToMobileRoute("/app/studybody")}
              />
            </nav>

            <div className="border-t border-[#2f2a22] pt-2">
              <p className="text-center text-[10px] font-bold uppercase tracking-wide text-[#d8d0c2]">
                Chat history
              </p>
              {mobileConvos.length === 0 ? (
                <p className="py-1.5 text-center text-xs font-medium text-[#d8d0c2]">
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

            <div className="border-t border-[#2f2a22] pt-2">
              <div className="mx-auto mb-1 w-[74%] max-w-[14rem] text-center">
                <div className="truncate text-xs font-semibold">{profile.name || "Student"}</div>
                <div className="truncate text-[11px] text-[#d8d0c2]">
                  {[profile.year, profile.university].filter(Boolean).join(" - ")}
                </div>
              </div>
              <div className="mx-auto mb-1 flex w-[74%] max-w-[14rem] items-center justify-between rounded-lg px-2 py-1">
                <span className="text-xs font-semibold text-[#f5f0e8]">Appearance</span>
                <ThemeToggle />
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  setMobileMenuOpen(false);
                  navigate({ to: "/" });
                }}
                className="mx-auto flex w-[70%] max-w-[13.5rem] items-center justify-center gap-2.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#f5f0e8] hover:bg-[#1f1c17]"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:pb-0">
        <Outlet />
      </main>
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
      className={`mx-auto flex min-h-10 w-[70%] max-w-[13.5rem] items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
        active
          ? "border border-[#f5f0e8] bg-[#f5f0e8] text-[#0e0d0b] shadow-[0_12px_28px_rgba(245,240,232,0.12)]"
          : "border border-[#d8d0c2] bg-[#f5f0e8] text-[#0e0d0b] shadow-[0_8px_22px_rgba(0,0,0,0.24)] hover:bg-white"
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
    <section className="mx-auto w-[76%] max-w-[14rem]">
      <p className="px-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-[#d8d0c2]">
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
                ? "border-[#f5f0e8] bg-[#f5f0e8] text-[#0e0d0b]"
                : "border-[#2f2a22] bg-[#1f1c17] text-[#f5f0e8] hover:border-[#d8d0c2]"
            }`}
          >
            <span className="block truncate">{item.title || "New conversation"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
