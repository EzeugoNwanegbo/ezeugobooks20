import { Skeleton } from "@/components/ui/skeleton";

// Skeleton placeholders used instead of full-screen spinners. The app should
// feel like it's already there and filling in — not like a page that is
// "loading". Each skeleton mirrors the real layout it stands in for.

/** Content placeholder for a lazy app page rendered inside the shell Outlet. */
export function PageSkeleton() {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-8 md:px-8">
        <Skeleton className="h-9 w-48 sm:h-12 sm:w-64" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Placeholder for the chat surface (message stream + composer). */
export function ChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl space-y-6 px-3 pt-8 sm:px-4 md:px-8">
          <div className="flex justify-end">
            <Skeleton className="h-12 w-2/3 rounded-lg rounded-br-sm" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <Skeleton className="h-28 flex-1 rounded-lg" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-1/2 rounded-lg rounded-br-sm" />
          </div>
        </div>
      </div>
      <div className="px-3 pb-4 pt-2 sm:px-4 md:px-8">
        <Skeleton className="mx-auto h-12 max-w-3xl rounded-2xl sm:rounded-[28px]" />
      </div>
    </div>
  );
}

/** Full app-shell placeholder shown while auth/profile is still settling. */
export function AppShellSkeleton() {
  return (
    <div className="luxury-app-shell flex h-dvh min-h-dvh flex-col overflow-hidden bg-background md:flex-row">
      <div className="symbiote-blob app-blob-one" />
      <div className="symbiote-blob app-blob-two" />

      {/* Desktop sidebar chrome */}
      <aside className="hidden flex-col border-r border-border bg-background/75 backdrop-blur md:flex md:w-56 md:shrink-0 xl:w-64">
        <div className="flex items-center justify-between border-b border-border p-5">
          <Skeleton className="h-6 w-12" />
        </div>
        <div className="flex-1 space-y-2 p-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      </aside>

      {/* Mobile top bar chrome */}
      <div
        className="sticky top-0 z-[60] flex shrink-0 items-center justify-between border-b border-border bg-background px-3 md:hidden"
        style={{
          height: "calc(3rem + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-5 w-10" />
        <Skeleton className="h-9 w-9 rounded-md" />
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatSkeleton />
      </main>
    </div>
  );
}
