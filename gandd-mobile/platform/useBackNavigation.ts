import { useEffect } from "react";
import { BackHandler } from "react-native";
import { router, usePathname } from "expo-router";
import { useDrawer } from "./drawer-context";
import { useModal } from "./modal-context";

// The four primary tabs (Chat is the root). Anything else under (app) is a
// "secondary" screen reached via the drawer and gets a normal back.
// Battle Royale replaced Last Minute here — kept in step with BottomNav.tsx's
// TABS and tab-transition.ts's TAB_ROUTES, which must all agree on this same
// four or the bottom bar disappears on whichever route is out of sync.
const MAIN_ROUTES = ["/chat", "/library", "/battle-royale", "/coach"];

export function isMainRoute(pathname: string) {
  return MAIN_ROUTES.includes(pathname);
}

// Priority-based Android hardware back handling (spec §4):
//   drawer open  → close drawer
//   modal open   → close top modal
//   secondary    → router.back()
//   non-Chat tab → go to Chat
//   Chat root    → Android default (exit app)
export function useBackNavigation() {
  const { isOpen, close } = useDrawer();
  const { isAnyOpen, dismissTop } = useModal();
  const pathname = usePathname();

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isOpen) {
        close();
        return true;
      }
      if (isAnyOpen) {
        dismissTop();
        return true;
      }
      if (!isMainRoute(pathname)) {
        router.back();
        return true;
      }
      if (pathname !== "/chat") {
        router.replace("/chat");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isOpen, isAnyOpen, pathname, close, dismissTop]);
}
