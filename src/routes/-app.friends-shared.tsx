// Shared shell for the three friends screens (Friends / Add / Battles).
//
// The friends page used to do everything at once - claim a handle, search,
// answer requests, browse friends, and track battles - in one long scroll.
// Splitting it into three routes only works if the boring parts (the gate for
// guests and the pre-migration flag, the header, the tab strip) live in ONE
// place, so this file holds exactly that and nothing page-specific. Each page
// supplies its own title, header actions and body; this decides whether the
// body is shown at all.
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Swords, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { useAuth } from "@/lib/auth-context";
import { isGuestUser } from "@/lib/guest-session";
import { SOCIAL_SCHEMA_APPLIED, socialEnabled } from "@/lib/social";

export type FriendsTab = "friends" | "add" | "battles";

const FRIENDS_TAB_PATH: Record<FriendsTab, string> = {
  friends: "/app/friends",
  add: "/app/friends-add",
  battles: "/app/friends-battles",
};

const TAB_OPTIONS = ["friends", "add", "battles"] as const satisfies readonly FriendsTab[];
const TAB_LABEL: Record<FriendsTab, string> = {
  friends: "Friends",
  add: "Add",
  battles: "Battles",
};
const TAB_ICON: Record<FriendsTab, ReactNode> = {
  friends: <Users className="h-3.5 w-3.5" />,
  add: <UserPlus className="h-3.5 w-3.5" />,
  battles: <Swords className="h-3.5 w-3.5" />,
};

function FriendsSubNav({ active }: { active: FriendsTab }) {
  const navigate = useNavigate();
  return (
    <Segmented<FriendsTab>
      value={active}
      onChange={(tab) => {
        if (tab !== active) void navigate({ to: FRIENDS_TAB_PATH[tab] });
      }}
      options={TAB_OPTIONS}
      getIcon={(tab) => TAB_ICON[tab]}
      getLabel={(tab) => TAB_LABEL[tab]}
      className="max-w-sm"
    />
  );
}

/**
 * The page frame every friends screen shares: the scroll container, the
 * header, the tab strip, and the gate. `children` is only ever rendered once
 * both gates pass - a page component never has to check `socialEnabled()` or
 * guest status itself, so there is exactly one place that decides whether
 * this feature is on.
 */
export function FriendsPageFrame({
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  active: FriendsTab;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const enabled = socialEnabled(user);
  const isGuest = isGuestUser(user);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader eyebrow="Friends" title={title} subtitle={subtitle} actions={actions} />
        {enabled && <FriendsSubNav active={active} />}
        {!SOCIAL_SCHEMA_APPLIED ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              Friends and challenges aren&apos;t switched on yet. They&apos;ll appear here once
              they&apos;re live.
            </p>
          </Panel>
        ) : isGuest ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              You&apos;re in a guest session. Guest sessions disappear when you sign out, so they
              can&apos;t hold friendships — create a free account and everything you&apos;ve made
              comes with you.
            </p>
          </Panel>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">{children}</section>
  );
}

export function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
      <span className="text-pop">{icon}</span>
      {title}
    </h2>
  );
}

// One list row. The 360px case is what the wrapping and min-w-0 are for: the
// name truncates and the action keeps its full width rather than being
// squeezed.
export function Row({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]">{title}</div>
        {subtitle && (
          <div className="truncate font-mono text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// A single dashed-border empty state with one primary action. Every "nothing
// here yet" moment across the three pages uses this instead of a paragraph
// telling the student what to do - the button IS the instruction.
export function EmptyState({
  icon,
  text,
  action,
}: {
  icon: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
      <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
