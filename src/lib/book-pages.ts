// The page a student can actually turn to.
//
// THE PROBLEM. Everything downstream cites the PDF's own page position - the
// 47th sheet in the file. A scanned textbook usually carries a cover, a title
// page, a contents section and a preface before the book's own "page 1", so
// sheet 47 is printed page 23. Telling a student "page 47" sends them to the
// wrong chapter of the physical book, and it is worse than useless because it
// looks precise. The reverse happens too: a single chapter ripped out of a book
// starts at sheet 1 and prints page 340.
//
// THE SIGNAL. Not the number on any one page - a page is full of numbers, and
// picking "the number in the footer" is guesswork on a figure caption or a
// year. The signal is that the printed number advances in LOCKSTEP with the
// sheet number. So every page proposes an offset (printed - sheet), and if one
// offset is proposed over and over across the document, that offset is the
// book's front matter and nothing else could produce it.
//
// One document-wide offset also fixes the pages that never state their number:
// chapter openers and full-page plates usually drop the folio, and they get the
// right answer anyway because the offset came from their neighbours.
//
// Pure: no DOM, no network. Everything here is checkable in isolation, which is
// the point - this decides what a student is told about where a fact came from.

/** A page's sheet position in the file, and the text found on it. */
export type ExtractedPage = { page: number; text: string };

/**
 * How many lines at the top and bottom of a page can hold a folio.
 *
 * Two, not one: a running head is very often "Chapter 4" on one line and the
 * number on the next, and plenty of scans put a stray artefact on the very
 * first line.
 */
const EDGE_LINES = 2;

/** Above this, it is a year, a quantity or an OCR smear - not a page number. */
const MAX_PLAUSIBLE_PAGE = 9999;

/**
 * The fewest pages that must agree before an offset is trusted.
 *
 * A handful of coincidences can agree by chance in a short document; a real
 * folio sequence agrees dozens of times. Set against short files deliberately:
 * refusing to guess costs a student nothing, and guessing wrong costs them the
 * trust that makes citations worth printing.
 */
const MIN_AGREEING_PAGES = 5;

/** The winning offset must also account for this share of pages that proposed one. */
const MIN_AGREEMENT_RATIO = 0.5;

/**
 * Every standalone integer sitting on a page's top or bottom edge lines.
 *
 * "Standalone" matters: `\b23\b` would match inside "1923" or "Figure 23.4",
 * so a candidate must be a whole token with no digit, dot or dash welded to it.
 */
function edgeNumbers(text: string): number[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const edges = [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)];
  const found: number[] = [];

  for (const line of edges) {
    // Roman numerals are deliberately ignored. Front matter numbered i, ii, iii
    // is the very region whose length we are trying to measure - reading it
    // would fold the preface into the offset it exists to detect.
    for (const match of line.matchAll(/(?<![\w.\-–—])(\d{1,4})(?![\w.\-–—])/g)) {
      const value = Number(match[1]);
      if (value >= 1 && value <= MAX_PLAUSIBLE_PAGE) found.push(value);
    }
  }

  return found;
}

/**
 * The offset to add to a sheet number to get the book's printed page, or null
 * when the document does not support one confidently.
 *
 * Null is a real answer and the common one for slide decks, lecture notes and
 * anything without running folios. Callers must fall back to the sheet number
 * rather than inventing a book page.
 */
export function detectBookPageOffset(pages: ExtractedPage[]): number | null {
  if (pages.length < MIN_AGREEING_PAGES) return null;

  const tally = new Map<number, number>();
  let pagesWithCandidates = 0;

  for (const { page, text } of pages) {
    const candidates = edgeNumbers(text);
    if (candidates.length === 0) continue;
    pagesWithCandidates += 1;

    // One vote per DISTINCT offset per page. Without the dedupe a page whose
    // header and footer both show the folio would out-vote its neighbours.
    const seen = new Set<number>();
    for (const value of candidates) {
      const offset = value - page;
      if (seen.has(offset)) continue;
      seen.add(offset);
      tally.set(offset, (tally.get(offset) ?? 0) + 1);
    }
  }

  if (pagesWithCandidates === 0) return null;

  let best: number | null = null;
  let bestVotes = 0;
  for (const [offset, votes] of tally) {
    // Ties break towards the offset closer to zero: front matter is short, and
    // a tie between "24 pages of preface" and some coincidence 900 pages away
    // is not really a tie.
    if (
      votes > bestVotes ||
      (votes === bestVotes && best !== null && Math.abs(offset) < Math.abs(best))
    ) {
      best = offset;
      bestVotes = votes;
    }
  }

  if (best === null) return null;
  if (bestVotes < MIN_AGREEING_PAGES) return null;
  if (bestVotes / pagesWithCandidates < MIN_AGREEMENT_RATIO) return null;

  return best;
}

/**
 * The printed page for a sheet, or null when there is no trustworthy offset or
 * the result lands in the front matter (page zero or below, which no book
 * prints).
 */
export function bookPageFor(sheet: number, offset: number | null): number | null {
  if (offset === null) return null;
  const value = sheet + offset;
  return value >= 1 ? value : null;
}

/** The marker written into extracted text, and parsed back out of it. */
export function pageMarker(sheet: number, bookPage: number | null): string {
  return bookPage === null ? `[Page ${sheet}]` : `[Page ${sheet} | Book page ${bookPage}]`;
}

/**
 * Rewrite a document's `[Page N]` markers to carry the book's own page too.
 *
 * Takes and returns the whole extracted text so both extraction paths (the text
 * layer and the OCR pool) get this from one call, rather than each having to
 * remember to do it.
 */
export function annotateBookPages(text: string): string {
  const marker = /\[Page\s+(\d+)\]\s*/g;
  const matches = [...text.matchAll(marker)];
  if (matches.length === 0) return text;

  const pages: ExtractedPage[] = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return { page: Number(match[1]), text: text.slice(start, end) };
  });

  const offset = detectBookPageOffset(pages);
  if (offset === null || offset === 0) return text;

  // ONE PASS, LEFT TO RIGHT, JOINED ONCE.
  //
  // This used to walk the matches right to left, rebuilding the WHOLE string on
  // every marker (`out.slice(0, at) + replacement + out.slice(...)`). That is
  // correct but quadratic: each of a textbook's 1,600 markers copied all ~5 MB
  // of text, so annotating Gray's Anatomy cost ~33 seconds of blocked main
  // thread - and it ran after the last page was read, so the upload bar sat at
  // "100%" throughout, looking frozen.
  //
  // Collecting the pieces and joining once is the same output for O(n) work.
  // Right-to-left was only ever needed because each write disturbed the indexes
  // of the writes still to come; a cursor never looks back, so the direction
  // flips for free.
  //
  // WHY THE SPANS CANNOT OVERLAP, which is what makes the two orders equivalent.
  // Each rewrite replaces `[at, at + "[Page ${sheet}]".length)`. The regex match
  // that produced `at` is `[Page` + \s+ + digits + `]` + \s*, so it is at least
  // 7 + digits.length characters, while the span replaced is exactly
  // 7 + String(Number(digits)).length - and Number() only ever drops leading
  // zeros, never adds digits. So the replaced span is always within this match,
  // and regex matches never overlap. The cursor is therefore monotonic.
  //
  // Deliberately preserved, NOT fixed: the span replaced is `[Page N]` built
  // from the PARSED number, so a source marker written `[Page  7]` (two spaces)
  // or `[Page 007]` is only partly overwritten, leaving a residue character.
  // Both extraction paths emit exactly one space and no leading zeros
  // (src/lib/pdf.ts, and the OCR pool beside it), so this cannot arise in
  // practice - but changing it here would alter stored text for anything that
  // ever did, and this rewrite is meant to be byte-identical, not better.
  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    const at = match.index ?? 0;
    const sheet = Number(match[1]);
    parts.push(text.slice(cursor, at));
    parts.push(pageMarker(sheet, bookPageFor(sheet, offset)));
    cursor = at + `[Page ${sheet}]`.length;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}
