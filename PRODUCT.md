# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Medical and law students at university, working toward a named assessment format
(MCQ, OSCE, essay, problem question). Their profile carries year, university,
course/discipline, exam format, weak areas, and recent topics, and the product
pitches depth and vocabulary to that level.

Both usage scenes are first-class and confirmed by the user:

- Phone, in short bursts — between lectures, on the ward, in transit. Quick
  questions, revision, checking one thing.
- Desktop, in long sessions — studying with their own PDFs and slides open,
  an hour or more at a stretch.

Guests can use the product without an account; a guest session is ephemeral and
its documents and chats are lost on sign-out.

## Product Purpose

Turn a student's own course material into study they can actually act on: ask a
question, get an answer built from their uploaded documents with the source and
page named, then practise it, track what has stuck, and condense it before an
exam.

## Positioning

Answers are grounded in the student's own uploaded material and cite the
document and page they came from. A general assistant answers from the open
web and cannot point at the student's lecture PDF, page 214. The retrieval
pipeline, the citation requirement, and the shared discipline library exist to
make that claim true rather than decorative.

## Operating Context

- Students upload lecture PDFs, slides, and photographs of handwritten notes.
  Image-only PDFs are OCR'd: up to 50 pages in the browser, larger ones through
  a queue, with very large files split client-side before upload.
- A shared library of admin-approved textbooks lets a student search material
  they never uploaded, merged into retrieval by discipline.
- Answers are produced by a two-stage pipeline: a research draft grounded in the
  retrieved documents, then a styling pass that applies the chosen answer mode.
- Work continues across devices and survives reload through a persisted session.
- Study happens against a deadline. Exam proximity is the organising pressure,
  not open-ended curiosity.

## Capabilities and Constraints

Confirmed functionality that a redesign must keep:

- **Chat** with four answer styles: Simplified, Detailed, Detailed+ (full study
  notes, exportable as a PDF, capped at 2/day), and Storytelling. Source scope
  is selectable: my files only, files + general, or general knowledge.
- Per-answer Copy; "Continue elsewhere" exports either the whole conversation or
  an explainer prompt for the last answer, for pasting into another AI.
- Inline diagrams (Mermaid) rendered inside answers; key terms are tappable for
  a web lookup; selected text can open an inline follow-up thread; answers can
  be read aloud; questions can be edited and re-run with version history.
- **Library** — upload, folder, search, OCR, and select documents for grounding.
- **My Coach** — an adapting study plan with mastery tracking.
- **Last Minute** — condensed cram sheets, exportable as Markdown or DOCX.
- **Practice**, **History**, **Leaderboard** (points, streak, level),
  **Feedback**, **Settings**, and an **Admin** surface for approving shared books.
- A first-run guided tour, replayable from a Guide entry in the menu.

Constraints:

- Vite + React + TanStack Router + Tailwind, deployed as a static build to
  Hostinger at gd1.online. A Capacitor Android wrapper ships the same web UI, so
  the design language stays web.
- Supabase provides auth, data, and the edge functions behind chat.
- Theme is per-discipline (medicine/law) via a root data attribute, layered on
  top of light/dark.

## Brand Commitments

- The **G&D name and wordmark** are fixed and survive any redesign.
- **Medicine/law discipline theming** is fixed and survives any redesign.
- Everything else visual is explicitly open, including the current coral accent
  (#ee6c4d) — the user confirmed it is not protected.
- Voice in-product is warm, direct, and addresses the student by name. The
  assistant never names the underlying model or any internal step; it is G&D.

## Evidence on Hand

- The live product at https://gd1.online and the full application source.
- Real feature surfaces listed above, all implemented — nothing in this record
  is aspirational.
- No testimonials, customer names, usage numbers, press, or institutional
  endorsements exist. Future work must not invent them.

## Product Principles

1. **The student's own material outranks general knowledge.** When both exist,
   ground the answer in their documents and say where it came from.
2. **Meet the deadline the student is actually facing.** Depth is a setting, not
   a default; the product must be as useful in a five-minute gap as in an hour.
3. **Every answer should be portable.** Copy it, export it, take it elsewhere —
   the product does not hold work hostage.
4. **Discipline is not decoration.** Medicine and law reason differently, and
   the product's framing, examples, and structure follow that difference.
5. **Never impersonate certainty.** Cite the source, flag the uncertainty, and
   let the student verify against their own material.

## Accessibility & Inclusion

No formal standard has been established for this product. Existing behaviour to
preserve: keyboard and screen-reader labelling on interactive controls, respect
for light/dark preference, and readable type on small screens in both scenes.
