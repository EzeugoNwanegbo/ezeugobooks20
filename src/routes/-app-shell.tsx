import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpen, Loader2, LogOut, Map, MessageSquare, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth", replace: true });
    else if (profile && !profile.onboarded) navigate({ to: "/onboarding", replace: true });
  }, [loading, user, profile, navigate]);

  if (loading || !user) {
    return (
      <div className="luxury-app-shell flex min-h-dvh items-center justify-center bg-background">
        <div className="symbiote-blob app-blob-one" />
        <div className="symbiote-blob app-blob-two" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
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

  const navItem = (to: string, icon: ReactNode, label: string) => {
    const active = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
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
    <div className="luxury-app-shell flex h-dvh min-h-dvh flex-col overflow-x-hidden bg-background md:flex-row md:overflow-hidden">
      <div className="symbiote-blob app-blob-one" />
      <div className="symbiote-blob app-blob-two" />
      
      {/* Sidebar toggle for desktop when hidden */}
      {isSidebarHidden && (
        <button
          onClick={() => setIsSidebarHidden(false)}
          className="fixed left-4 top-4 z-50 hidden rounded-md border border-border bg-background/80 p-2 text-muted-foreground backdrop-blur hover:text-foreground md:inline-flex"
          title="Show navigation"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <aside className={`${isSidebarHidden ? "hidden" : "hidden md:flex"} flex-col border-r border-border bg-background/75 backdrop-blur transition-[width] duration-300 md:shrink-0 ${isSidebarCollapsed ? "md:w-20 xl:w-20" : "md:w-56 xl:w-64"}`}>
        <div className={`flex items-center border-b border-border ${isSidebarCollapsed ? "justify-center p-4" : "justify-between p-5"}`}>
          {!isSidebarCollapsed && (
            <Link to="/app/chat" className="luxury-brand-text">
              G&D
            </Link>
          )}
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
              className="p-1.5 rounded-md text-muted-foreground hover:bg-surface-elevated hover:text-foreground transition-colors"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button 
              onClick={() => setIsSidebarHidden(true)} 
              className="p-1.5 rounded-md text-muted-foreground hover:bg-surface-elevated hover:text-foreground transition-colors"
              title="Hide sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItem("/app/chat", <MessageSquare className="h-4 w-4 shrink-0" />, "Chat")}
          {navItem("/app/library", <BookOpen className="h-4 w-4 shrink-0" />, "Library")}
          {navItem("/app/studybody", <Map className="h-4 w-4 shrink-0" />, "StudyBody")}
        </nav>
        <div className={`border-t border-border ${isSidebarCollapsed ? "p-3 flex flex-col items-center gap-3" : "p-3"}`}>
          {!isSidebarCollapsed && (
            <div className="px-3 py-2 mb-1">
              <div className="text-sm font-medium truncate">{profile.name || "Student"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {profile.year} - {profile.university}
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
            className={`flex items-center text-muted-foreground hover:bg-surface-elevated hover:text-foreground transition-colors ${
              isSidebarCollapsed 
                ? "justify-center p-2 rounded-lg" 
                : "w-full gap-3 px-3 py-2 rounded-lg text-sm font-medium"
            }`}
            title={isSidebarCollapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Link to="/app/chat" className="luxury-brand-text small">
          G&D
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-[calc(3.25rem+env(safe-area-inset-top))] md:pb-0 md:pt-0">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-1">
          <MobileNavItem
            to="/app/chat"
            active={location.pathname.includes("chat")}
            icon={<MessageSquare className="h-4 w-4" />}
            label="Chat"
          />
          <MobileNavItem
            to="/app/library"
            active={location.pathname.includes("library")}
            icon={<BookOpen className="h-4 w-4" />}
            label="Library"
          />
          <MobileNavItem
            to="/app/studybody"
            active={location.pathname.includes("studybody")}
            icon={<Map className="h-4 w-4" />}
            label="StudyBody"
          />
        </div>
      </nav>
    </div>
  );
}

function MobileNavItem({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
        active
          ? "border border-primary/15 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
      }`}
      aria-label={label}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </Link>
  );
}
