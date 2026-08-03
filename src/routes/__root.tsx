import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";

import appCss from "../styles.css?url";

const themeInitScript = `
(function () {
  try {
    var stored = window.localStorage.getItem("gd-theme");
    // Dark is the default; an explicit stored choice always wins.
    var theme = stored === "light" || stored === "brutal" || stored === "neo" ? stored : "dark";
    var root = document.documentElement;
    var nav = window.navigator || {};
    var memory = Number(nav.deviceMemory || 0);
    var cores = Number(nav.hardwareConcurrency || 0);
    var ua = String(nav.userAgent || "");
    var nativeApp = window.localStorage.getItem("gd_native_app") === "1" || /wv\\)|; wv\\)|WebView/i.test(ua);
    var oldAndroid = /Android\\s[0-8](\\.|;|\\s|$)/i.test(ua);
    var oldIos = /OS\\s([1-9]|1[0-2])_/i.test(ua);
    var lowPower = nativeApp || oldAndroid || oldIos || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("brutal", theme === "brutal");
    root.classList.toggle("neo", theme === "neo");
    root.classList.toggle("gd-low-power", lowPower);
    // Brutalism is a paper theme, so it takes the light color-scheme; neo is
    // charcoal and takes the dark one.
    root.style.colorScheme = theme === "light" || theme === "brutal" ? "light" : "dark";
  } catch (_) {}
})();
`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-bold text-foreground sm:text-7xl">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5",
      },
      // Bumps every build - View Source on the live site to confirm a deploy landed.
      { name: "app-build", content: __BUILD_ID__ },
      { title: "G&D - pinpoint answers from your files" },
      {
        name: "description",
        content:
          "Search large study files in seconds and get precise, source-backed answers from your own PDFs and notes.",
      },
      { property: "og:title", content: "G&D" },
      {
        property: "og:description",
        content:
          "Ask huge PDFs and notes precise questions. Get the exact answer, source, and explanation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  // A single AuthProvider for the whole app. Previously each route (/auth,
  // /onboarding, /app) mounted its own provider, so navigating between them
  // tore down and rebuilt auth state - racing getSession() against
  // onAuthStateChange and momentarily reporting "no user", which bounced
  // freshly-signed-up users back to /auth on slower devices.
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
