import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const location = useLocation();

  const chatActive = location.pathname.startsWith("/app/chat");

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
          <Link
            to="/app/chat"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              chatActive
                ? "border border-primary/15 bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </Link>
        </nav>
        <div className="p-3 border-t border-border">
          <div className="px-3 py-2">
            <div className="text-sm font-medium truncate">Guest session</div>
            <div className="text-xs text-muted-foreground truncate">No sign-up required</div>
          </div>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-20 border-b border-border bg-background/90 backdrop-blur px-4 py-3 flex items-center justify-between">
        <Link to="/app/chat" className="luxury-brand-text small">
          G&D
        </Link>
        <Link
          to="/app/chat"
          className={`p-2 rounded-md ${chatActive ? "text-primary" : "text-muted-foreground"}`}
        >
          <MessageSquare className="h-4 w-4" />
        </Link>
      </div>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
