// The first-run guided tour: what each part of G&D is for.
//
// Steps are data, not JSX, so the copy lives in one place and the overlay stays
// dumb. Each step optionally points at a real element via `data-tour="<anchor>"`
// - when that element is missing (wrong route, a control that only appears once
// there are messages, a sidebar that is off-screen on mobile) the step still
// runs, just centred with no spotlight. That is deliberate: the tour must never
// dead-end because the UI it wanted to point at is not on screen.

import { markSeenOnce } from "@/lib/seen-once";
export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** Matches a `data-tour="..."` attribute. Omit for a centred step. */
  anchor?: string;
  /** Route to move to before the step runs. */
  route?: string;
  /** The anchor lives in the mobile drawer, so open it first on small screens. */
  needsMobileNav?: boolean;
  /**
   * Gates the step on something the shell knows and this module does not.
   * "social" steps are dropped whenever Friends and Battle Royale are not
   * advertised - guests always, everyone until the social migration is applied
   * - because a map must never point at a room the student cannot enter.
   */
  requires?: "social";
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to G&D",
    body: "A quick tour of where everything lives - a minute or two. You can skip it now and replay it any time from the Guide button.",
  },
  {
    id: "ask",
    title: "Ask anything here",
    body: "Type a question, paste in a problem, or tap the mic to talk. Attach your own material and the answer is built from it instead of guesswork.",
    anchor: "composer",
    route: "/app/chat",
  },
  // Both of these used to point at their own segmented control in the chat
  // header. That header is gone and the "+" on the composer is the single door
  // to all of it, so they spotlight the same button twice - once for each
  // setting behind it.
  {
    id: "style",
    title: "Pick how the answer comes out",
    body: "Tap + and choose Answer style. Simple is plain English with an analogy. Detailed adds the reasoning and exceptions. Detailed+ writes full study notes - and offers to save them as a PDF.",
    anchor: "composer-plus",
    route: "/app/chat",
  },
  {
    id: "sources",
    title: "Tell it what to read",
    body: "The same + menu holds Answer sources, and Add file. My files only keeps every answer inside your uploads. Files + general fills the gaps. General knowledge ignores your library entirely.",
    anchor: "composer-plus",
    route: "/app/chat",
  },
  {
    id: "handoff",
    title: "Take the conversation with you",
    body: "Copy any answer with one tap, or use Continue elsewhere to hand the whole chat - or just the last answer - to another AI without starting over.",
    anchor: "continue-elsewhere",
    route: "/app/chat",
  },
  {
    id: "library",
    title: "Your library",
    body: "Upload lecture PDFs, slides, or photos of your notes. Scanned pages are read with OCR, and answers cite the document and page they came from.",
    anchor: "nav-library",
    needsMobileNav: true,
  },
  {
    id: "pq",
    title: "Practice Questions",
    body: "Sit questions built from your own material. It keeps track of what you have mastered, what is slipping, and what to revise next.",
    anchor: "nav-pq",
    needsMobileNav: true,
  },
  {
    id: "leaderboard",
    title: "Points and streak",
    body: "Studying earns points - uploading, practising, and sharing books all count - and days in a row build a streak. The Leaderboard is where both are ranked.",
    anchor: "nav-leaderboard",
    needsMobileNav: true,
  },
  {
    id: "friends",
    title: "Friends",
    body: "Add someone by their exact handle and their points and streak sit beside yours. You choose whether your own handle is findable.",
    anchor: "nav-friends",
    needsMobileNav: true,
    requires: "social",
  },
  {
    id: "battle-royale",
    title: "Battle Royale",
    body: "Study against a friend head to head: pick a topic or one of your files, and you each sit the same questions when it suits you. Scores meet at the end.",
    anchor: "nav-battle-royale",
    needsMobileNav: true,
    requires: "social",
  },
  {
    id: "last-minute",
    title: "Last Minute",
    body: "Exam tomorrow? This turns a topic or a document into a condensed cram sheet you can export and read on the way in.",
    anchor: "nav-last-minute",
    needsMobileNav: true,
  },
  {
    id: "progress",
    title: "Your work, kept",
    body: "History has every past chat, so you can pick one back up instead of asking again.",
    anchor: "nav-history",
    needsMobileNav: true,
  },
  {
    id: "replay",
    title: "That's the map",
    body: "Start by uploading something you actually need to study, then ask about it. Tap Guide whenever you want this tour again.",
    anchor: "tour-launcher",
    needsMobileNav: true,
  },
];

/** The steps this particular student should actually be walked through. */
export function tourStepsFor({ social }: { social: boolean }): TourStep[] {
  return TOUR_STEPS.filter((step) => step.requires !== "social" || social);
}

// Seen-state is per account, not per device: two students sharing a laptop each
// get their one run, and the account that has had it never gets it again.
//
// The key was device-wide before, so a device can still be carrying that old
// flag. It is honoured as "seen" for everybody on that device, on purpose: the
// alternative is re-showing the tour to every existing student exactly once,
// which is the very complaint this addressed. New devices only ever write the
// per-user key, so the legacy flag ages out on its own.
//
// Bump the version when the steps change enough that returning students should
// see it again.
const TOUR_STORAGE_KEY = "gd_feature_tour_seen_v1";

function tourStorageKey(userId?: string | null): string {
  return userId ? `${TOUR_STORAGE_KEY}:${userId}` : TOUR_STORAGE_KEY;
}

export function hasSeenTour(userId?: string | null): boolean {
  try {
    if (window.localStorage.getItem(TOUR_STORAGE_KEY) === "1") return true;
    return window.localStorage.getItem(tourStorageKey(userId)) === "1";
  } catch {
    // Private mode / blocked storage: treat as seen so we never trap someone in
    // a tour that reopens on every navigation.
    return true;
  }
}

/**
 * Called the moment the tour opens, not when it is completed. Anything that
 * ends a run - Next to the end, Skip, the X, Escape, a reload, closing the tab
 * mid-step - therefore leaves it marked. Only the deliberate Guide button
 * brings it back.
 */
export function markTourSeen(userId?: string | null): void {
  try {
    window.localStorage.setItem(tourStorageKey(userId), "1");
  } catch {
    // Nothing to do - worst case the tour offers itself again next session.
  }
  // …and on the ACCOUNT, so clearing this browser or signing in on another
  // device does not replay the tour. See src/lib/seen-once.ts.
  markSeenOnce("tour", userId);
}
