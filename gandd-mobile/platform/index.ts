// Centralized native/mobile system — all gesture, drawer, modal, haptic and
// back-navigation logic lives here (spec §8) instead of being scattered.
export { BottomNav, BOTTOM_NAV_HEIGHT } from "./BottomNav";
export { Drawer } from "./Drawer";
export { DrawerProvider, useDrawer } from "./drawer-context";
export { MainTabContainer } from "./MainTabContainer";
export { ModalProvider, useModal } from "./modal-context";
export { ScreenContainer, TopBar } from "./ScreenContainer";
export { TAB_ROUTES } from "./tab-transition";
export { useBackNavigation, isMainRoute } from "./useBackNavigation";
export { useDrawerGestures } from "./useDrawerGestures";
export { useEdgeSwipe } from "./useEdgeSwipe";
export { haptics, useHaptics } from "./useHaptics";
export { IS_NATIVE, useIsNative } from "./useIsNative";
