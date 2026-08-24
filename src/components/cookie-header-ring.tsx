// The cookie meter as it appears at the TOP OF A PAGE, rather than in the
// sidebar.
//
// WHY THIS EXISTS AS ITS OWN COMPONENT. CookieRing is deliberately dumb: it
// takes a number and draws an arc. The shell can hand it one because the shell
// already holds the balance and owns the dialog. PageHeader cannot - it lives
// in components/ui, it is rendered by ten different screens, and threading
// `remaining`, `allowance` and an onClick through every one of them would put
// the same four lines in ten files and guarantee they drift.
//
// So this is the self-contained version: it finds the balance itself, opens the
// dialog through the event bus in src/lib/cookies.ts, and renders NOTHING at all
// until it knows there is a real number to show. That last part is the same
// "no meter is better than a wrong meter" rule the shell's rings follow - with
// the schema absent, or for a guest, this is simply not on the page.
//
// DESKTOP ONLY, and that is not an oversight. Below md the mobile topbar
// already carries a ring, and it is fixed to the top of the viewport rather
// than scrolling away with the page heading - which is the better place for it
// on a phone. Rendering both would put two identical meters within about sixty
// pixels of each other on every screen that has a PageHeader.
import { useAuth } from "@/lib/auth-context";
import { CookieRing } from "@/components/cookie-ring";
import { requestCookieDialog, useCookies } from "@/lib/cookies";

export function CookieHeaderRing() {
  const { user } = useAuth();
  const cookies = useCookies(user?.id);

  if (cookies.status !== "ready") return null;

  return (
    // The wrapper, not the ring itself, carries the breakpoint. CookieRing sets
    // its own `display` (inline-grid), and `hidden` would be fighting it on
    // equal specificity - which of the two wins would then depend on the order
    // Tailwind happened to emit them in, not on what is written here.
    <span className="hidden md:inline-flex">
      <CookieRing
        remaining={cookies.balance.remaining}
        allowance={cookies.balance.allowance}
        onClick={requestCookieDialog}
        size={32}
      />
    </span>
  );
}
