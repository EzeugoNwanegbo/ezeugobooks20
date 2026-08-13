import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

// friendId/friendUsername/friendName are set when Friends' "Battle" button
// hands off here with the opponent already chosen (see -app.friends-page.tsx),
// so the setup screen can skip straight to "which file" instead of asking who
// to fight again. All three optional — arriving from the sidebar/nav directly
// (no opponent yet) is just as valid a way in.
type BattleRoyaleSearch = { friendId?: string; friendUsername?: string; friendName?: string };

// The route exists whether or not the schema is applied — the page itself is
// gated (see src/lib/social.ts's socialEnabled()). A route that only exists
// behind a flag would break every deep link the moment the flag moved.
const BattleRoyalePage = lazy(() =>
  import("./-app.battle-royale-page").then((module) => ({ default: module.BattleRoyalePage })),
);

export const Route = createFileRoute("/app/battle-royale")({
  head: () => ({ meta: [{ title: "Battle Royale - G&D" }] }),
  validateSearch: (s: Record<string, unknown>): BattleRoyaleSearch => ({
    friendId: typeof s.friendId === "string" ? s.friendId : undefined,
    friendUsername: typeof s.friendUsername === "string" ? s.friendUsername : undefined,
    friendName: typeof s.friendName === "string" ? s.friendName : undefined,
  }),
  component: BattleRoyaleRoute,
});

function BattleRoyaleRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BattleRoyalePage />
    </Suspense>
  );
}
