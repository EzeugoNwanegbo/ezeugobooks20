import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpen, Loader2, LogOut, MessageSquare } from "lucide-react";
import { useEffect } from "react";
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
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!profile || !profile.onboarded) navigate({ to: "/onboarding" });
  }, [loading, user, profile, navigate]);

  if (loading || !user || !profile?.onboarded) {
    return (
      <div className="luxury-app-shell min-h-screen flex items-center justify-center bg-background">
        <div className="symbiote-blob app-blob-one" />
        <div className="symbiote-blob app-blob-two" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
        }`}
      >
        {icon}
        {label}
      </Link>
    );
  };

  return (
    <div className="luxury-app-shell flex h-screen overflow-hidden bg-background">
      <div className="symbiote-blob app-blob-one" />
      <div className="symbiote-blob app-blob-two" />
      <aside className="hidden md:flex md:w-64 flex-col border-r border-border bg-background/75 backdrop-blur">
        <div className="p-5 border-b border-border">
          <Link to="/app/chat" className="luxury-brand-text">
            G&D
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItem("/app/chat", <MessageSquare className="h-4 w-4" />, "Chat")}
          {navItem("/app/library", <BookOpen className="h-4 w-4" />, "Library")}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="px-3 py-2 mb-1">
            <div className="text-sm font-medium truncate">{profile.name || "Student"}</div>
            <div className="text-xs text-muted-foreground truncate">
              {profile.year} - {profile.university}
            </div>
          </div>
          <div className="mb-2 px-3">
            <ThemeToggle className="w-full" />
          </div>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-surface-elevated hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-20 border-b border-border bg-background/90 backdrop-blur px-4 py-3 flex items-center justify-between">
        <Link to="/app/chat" className="luxury-brand-text small">
          G&D
        </Link>
        <div className="flex gap-1">
          <ThemeToggle />
          <Link
            to="/app/chat"
            className={`p-2 rounded-md ${
              location.pathname.includes("chat") ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
          </Link>
          <Link
            to="/app/library"
            className={`p-2 rounded-md ${
              location.pathname.includes("library") ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <BookOpen className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
