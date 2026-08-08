// The first-run guided tour: what each part of G&D is for.
//
// Steps are data, not JSX, so the copy lives in one place and the overlay stays
// dumb. Each step optionally points at a real element via `data-tour="<anchor>"`
// - when that element is missing (wrong route, a control that only appears once
// there are messages, a sidebar that is off-screen on mobile) the step still
// runs, just centred with no spotlight. That is deliberate: the tour must never
// dead-end because the UI it wanted to point at is not on screen.

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
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to G&D",
    body: "A quick tour of where everything lives - about a minute. You can skip it now and replay it any time from the Guide button.",
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
    id: "coach",
    title: "My Coach",
    body: "A study plan that adapts to you - it tracks what you have mastered, what is slipping, and what to revise next.",
    anchor: "nav-studybody",
    needsMobileNav: true,
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
    body: "History has every past chat. The Leaderboard tracks the points and streak you build by studying - uploading, practising, and sharing books all count.",
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

// Bump when the steps change enough that returning students should see it again.
const TOUR_STORAGE_KEY = "gd_feature_tour_seen_v1";

export function hasSeenTour(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    // Private mode / blocked storage: treat as seen so we never trap someone in
    // a tour that reopens on every navigation.
    return true;
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // Nothing to do - worst case the tour offers itself again next session.
  }
}
