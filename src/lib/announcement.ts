// One-off "what's new" announcements.
//
// Same shape as the feature tour's seen-state (src/lib/feature-tour.ts): a
// versioned localStorage key, and a blocked-storage fallback that reports
// "already seen" so nobody gets trapped behind a dialog that reopens on every
// navigation. Deliberately NOT a column on user_profiles — an announcement
// showing once per device is fine, and it keeps this shippable without a
// database migration.

/** Bump the suffix to announce something new; the old key is simply abandoned. */
const ANNOUNCEMENT_KEY = "gd_announcement_seen_shared_library_v1";

export function hasSeenAnnouncement(): boolean {
  try {
    return window.localStorage.getItem(ANNOUNCEMENT_KEY) === "1";
  } catch {
    return true;
  }
}

export function markAnnouncementSeen(): void {
  try {
    window.localStorage.setItem(ANNOUNCEMENT_KEY, "1");
  } catch {
    // Worst case it offers itself again next session.
  }
}
