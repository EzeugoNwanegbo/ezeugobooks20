// Client-side PDF export for "Detailed+" study notes.
//
// Everything happens in the browser with pdf-lib (already a dependency, used by
// the OCR page-splitter), so an export costs nothing per document, needs no
// server round-trip, and the notes never leave the device.
//
// The trade-off of pdf-lib's standard fonts is WinAnsi-only encoding, so
// `toPdfText` transliterates the symbols that actually turn up in medical and
// legal notes (arrows, Greek letters, sub/superscripts) and replaces anything
// still unencodable rather than letting drawText throw mid-render.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";

// A4 in PDF points.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 54;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 58;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const SIZE_TITLE = 19;
const SIZE_H2 = 13;
const SIZE_H3 = 11;
const SIZE_BODY = 10.5;
const SIZE_CODE = 8.8;
const SIZE_META = 8.5;

const INK = rgb(0.09, 0.09, 0.1);
const INK_SOFT = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.82, 0.82, 0.84);
const ACCENT = rgb(0.93, 0.42, 0.3); // the app's coral pop

/** Symbols the standard PDF fonts cannot encode, mapped to readable text. */
const CHAR_REPLACEMENTS: [RegExp, string][] = [
  [/[→⇒⟶]/g, " -> "],
  [/[←⇐⟵]/g, " <- "],
  [/[↔⇔]/g, " <-> "],
  [/≤/g, " <= "],
  [/≥/g, " >= "],
  [/≠/g, " != "],
  [/[≈≅≋]/g, " ~ "],
  [/−/g, "-"],
  [/∞/g, "infinity"],
  [/∑/g, "sum"],
  [/√/g, "sqrt"],
  [/∆/g, "delta"],
  [/μ/g, "µ"], // Greek mu -> micro sign, which IS in WinAnsi
  [/α/g, "alpha"],
  [/β/g, "beta"],
  [/γ/g, "gamma"],
  [/δ/g, "delta"],
  [/Δ/g, "Delta"],
  [/ε/g, "epsilon"],
  [/θ/g, "theta"],
  [/κ/g, "kappa"],
  [/λ/g, "lambda"],
  [/π/g, "pi"],
  [/ρ/g, "rho"],
  [/σ/g, "sigma"],
  [/τ/g, "tau"],
  [/φ/g, "phi"],
  [/χ/g, "chi"],
  [/ψ/g, "psi"],
  [/ω/g, "omega"],
  [/Ω/g, "Omega"],
  [/₀/g, "0"],
  [/₁/g, "1"],
  [/₂/g, "2"],
  [/₃/g, "3"],
  [/₄/g, "4"],
  [/⁰/g, "0"],
  [/⁴/g, "4"],
  [/[‐‑]/g, "-"],
  [/[‘’‛]/g, "'"],
  [/[“”„]/g, '"'],
  // Zero-width space / non-joiner / joiner / byte-order mark.
  [/\u200B|\u200C|\u200D|\uFEFF/g, ""],
];

// Everything WinAnsi can render: tab/newline, ASCII, the Latin-1 upper range,
// and the typographic characters WinAnsi maps into 0x80-0x9F.
const WINANSI_SAFE =
  /[\t\n\u0020-\u007E\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

/** Make a string safe for the standard PDF fonts. */
function toPdfText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of CHAR_REPLACEMENTS) out = out.replace(pattern, replacement);
  return out
    .split("")
    .map((char) => (WINANSI_SAFE.test(char) ? char : "?"))
    .join("")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Strip the inline markdown the renderer would otherwise show literally, and
 * make the result PDF-safe. Sanitizing here rather than at draw time is what
 * keeps `wrapText` honest: pdf-lib's `widthOfTextAtSize` throws on a character
 * WinAnsi cannot encode, so measurement must never see raw text.
 */
function stripInline(text: string): string {
  return toPdfText(
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1"),
  ).trim();
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string; depth: number }
  | { kind: "numbered"; marker: string; text: string; depth: number }
  | { kind: "quote"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" };

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInline(cell.trim()));
}

const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

/** Turn the answer's markdown into a flat list of layout blocks. */
export function parseNotesMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = stripInline(paragraph.join(" "));
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Fenced code / diagram block: kept verbatim, unwrapped.
    const fence = trimmed.match(/^```+\s*(\S*)/);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```+\s*$/.test(lines[i]!.trim())) {
        body.push(lines[i]!);
        i += 1;
      }
      // Code keeps its layout, but still has to be encodable.
      if (body.length > 0) blocks.push({ kind: "code", lines: body.map(toPdfText) });
      continue;
    }

    // Pipe table: a header row plus a |---| divider.
    if (trimmed.startsWith("|") && TABLE_DIVIDER.test(lines[i + 1]?.trim() ?? "")) {
      flushParagraph();
      const rows: string[][] = [parseTableRow(trimmed)];
      i += 2; // skip the divider
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        rows.push(parseTableRow(lines[i]!));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", rows });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3;
      const text = stripInline(heading[2]!);
      if (text) blocks.push({ kind: "heading", level, text });
      continue;
    }

    if (/^([-*_])\s*\1\s*\1[-*_\s]*$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const indent = raw.match(/^\s*/)![0].replace(/\t/g, "  ").length;
    const depth = Math.min(2, Math.floor(indent / 2));

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const text = stripInline(bullet[1]!);
      if (text) blocks.push({ kind: "bullet", text, depth });
      continue;
    }

    const numbered = trimmed.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      const text = stripInline(numbered[2]!);
      if (text) blocks.push({ kind: "numbered", marker: `${numbered[1]}.`, text, depth });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      const text = stripInline(quote[1]!);
      if (text) blocks.push({ kind: "quote", text });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

/** Greedy word wrap, hard-splitting any single word too long for the width. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const width = (value: string) => font.widthOfTextAtSize(value, size);
  const lines: string[] = [];
  let current = "";

  const pushWord = (word: string) => {
    let rest = word;
    // A URL or long token that cannot fit even alone: break it by character.
    while (width(rest) > maxWidth && rest.length > 1) {
      let cut = 1;
      while (cut < rest.length && width(rest.slice(0, cut + 1)) <= maxWidth) cut += 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!current) {
      pushWord(word);
      continue;
    }
    const candidate = `${current} ${word}`;
    if (width(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    pushWord(word);
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export type NotesPdfMeta = {
  /** Overrides the notes' own `# ` heading. Rarely wanted. */
  title?: string;
  /** Used when the notes have no `# ` heading - typically the question asked. */
  fallbackTitle?: string;
  studentName?: string;
  /** e.g. "Lecture 4.pdf, Page 12" - shown under the title when present. */
  sourceLabel?: string;
};

type Fonts = { body: PDFFont; bold: PDFFont; mono: PDFFont };

/** Mutable layout cursor shared by the drawing helpers. */
type Layout = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: Fonts;
};

function addPage(layout: Layout): void {
  layout.page = layout.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  layout.y = PAGE_HEIGHT - MARGIN_TOP;
}

/** Break to a new page unless `needed` points of vertical space remain. */
function ensureSpace(layout: Layout, needed: number): void {
  if (layout.y - needed < MARGIN_BOTTOM) addPage(layout);
}

function drawLines(
  layout: Layout,
  lines: string[],
  options: {
    font: PDFFont;
    size: number;
    x?: number;
    leading?: number;
    color?: ReturnType<typeof rgb>;
  },
): void {
  const { font, size } = options;
  const leading = options.leading ?? size * 1.42;
  const x = options.x ?? MARGIN_X;
  const color = options.color ?? INK;

  for (const line of lines) {
    ensureSpace(layout, leading);
    layout.y -= leading;
    const text = toPdfText(line);
    try {
      layout.page.drawText(text, { x, y: layout.y, size, font, color });
    } catch {
      // Last-resort guard: a glyph the sanitizer missed must not kill the export.
      layout.page.drawText(text.replace(/[^\x20-\x7E]/g, "?"), {
        x,
        y: layout.y,
        size,
        font,
        color,
      });
    }
  }
}

function drawTable(layout: Layout, rows: string[][], fonts: Fonts): void {
  const columns = Math.max(...rows.map((row) => row.length));
  if (columns === 0) return;

  const padding = 5;
  const size = columns > 4 ? SIZE_CODE : SIZE_BODY - 0.5;
  const leading = size * 1.35;

  // Width each column would want, then scaled down to the content width.
  const natural = Array.from({ length: columns }, (_unused, column) =>
    Math.max(
      40,
      ...rows.map((row) => fonts.body.widthOfTextAtSize(toPdfText(row[column] ?? ""), size) + 12),
    ),
  );
  const total = natural.reduce((sum, value) => sum + value, 0);
  const widths = natural.map((value) => (value / total) * CONTENT_WIDTH);

  rows.forEach((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    const font = isHeader ? fonts.bold : fonts.body;
    const cells = Array.from({ length: columns }, (_unused, column) =>
      wrapText(toPdfText(row[column] ?? ""), font, size, widths[column]! - padding * 2),
    );
    const height = Math.max(...cells.map((cell) => cell.length)) * leading + padding;

    ensureSpace(layout, height + 4);
    const top = layout.y;

    if (isHeader) {
      layout.page.drawRectangle({
        x: MARGIN_X,
        y: top - height,
        width: CONTENT_WIDTH,
        height,
        color: rgb(0.96, 0.96, 0.97),
      });
    }

    let x = MARGIN_X;
    cells.forEach((cell, column) => {
      cell.forEach((line, lineIndex) => {
        layout.page.drawText(line, {
          x: x + padding,
          y: top - padding - (lineIndex + 1) * leading + leading * 0.28,
          size,
          font,
          color: INK,
        });
      });
      x += widths[column]!;
    });

    layout.page.drawLine({
      start: { x: MARGIN_X, y: top - height },
      end: { x: MARGIN_X + CONTENT_WIDTH, y: top - height },
      thickness: isHeader ? 0.8 : 0.4,
      color: RULE,
    });
    layout.y = top - height;
  });

  layout.y -= 8;
}

function drawBlocks(layout: Layout, blocks: Block[]): void {
  const { fonts } = layout;

  blocks.forEach((block, index) => {
    switch (block.kind) {
      case "heading": {
        const size = block.level === 1 ? SIZE_H2 + 1 : block.level === 2 ? SIZE_H2 : SIZE_H3;
        const lines = wrapText(block.text, fonts.bold, size, CONTENT_WIDTH);
        // Keep a heading with the first line of what follows.
        const needed =
          lines.length * size * 1.4 + (index < blocks.length - 1 ? SIZE_BODY * 2.2 : 0);
        ensureSpace(layout, needed + 14);
        layout.y -= index === 0 ? 6 : 14;
        drawLines(layout, lines, { font: fonts.bold, size, leading: size * 1.35 });
        if (block.level <= 2) {
          layout.y -= 5;
          layout.page.drawLine({
            start: { x: MARGIN_X, y: layout.y },
            end: { x: MARGIN_X + CONTENT_WIDTH, y: layout.y },
            thickness: 0.6,
            color: RULE,
          });
        }
        layout.y -= 4;
        break;
      }
      case "paragraph": {
        layout.y -= 4;
        drawLines(layout, wrapText(block.text, fonts.body, SIZE_BODY, CONTENT_WIDTH), {
          font: fonts.body,
          size: SIZE_BODY,
        });
        break;
      }
      case "bullet":
      case "numbered": {
        const marker = block.kind === "bullet" ? "•" : block.marker;
        const indent = 12 + block.depth * 14;
        const markerWidth = block.kind === "bullet" ? 10 : 16;
        const textX = MARGIN_X + indent + markerWidth;
        const lines = wrapText(
          block.text,
          fonts.body,
          SIZE_BODY,
          CONTENT_WIDTH - indent - markerWidth,
        );
        const leading = SIZE_BODY * 1.42;

        ensureSpace(layout, leading);
        layout.y -= leading;
        layout.page.drawText(toPdfText(marker), {
          x: MARGIN_X + indent,
          y: layout.y,
          size: SIZE_BODY,
          font: fonts.body,
          color: block.kind === "bullet" ? ACCENT : INK_SOFT,
        });
        // First line sits on the marker's baseline; the rest hang under it.
        drawLines(layout, lines.slice(0, 1), {
          font: fonts.body,
          size: SIZE_BODY,
          x: textX,
          leading: 0,
        });
        if (lines.length > 1) {
          drawLines(layout, lines.slice(1), {
            font: fonts.body,
            size: SIZE_BODY,
            x: textX,
            leading,
          });
        }
        break;
      }
      case "quote": {
        layout.y -= 6;
        const lines = wrapText(block.text, fonts.body, SIZE_BODY, CONTENT_WIDTH - 16);
        const top = layout.y;
        drawLines(layout, lines, {
          font: fonts.body,
          size: SIZE_BODY,
          x: MARGIN_X + 14,
          color: INK_SOFT,
        });
        // Only rule the quote when it did not straddle a page break.
        if (layout.y < top) {
          layout.page.drawLine({
            start: { x: MARGIN_X + 4, y: top - 2 },
            end: { x: MARGIN_X + 4, y: layout.y - 2 },
            thickness: 1.6,
            color: ACCENT,
          });
        }
        break;
      }
      case "code": {
        layout.y -= 8;
        const lines = block.lines.flatMap((line) =>
          wrapText(line.replace(/\t/g, "  "), fonts.mono, SIZE_CODE, CONTENT_WIDTH - 16),
        );
        drawLines(layout, lines, {
          font: fonts.mono,
          size: SIZE_CODE,
          x: MARGIN_X + 8,
          leading: SIZE_CODE * 1.5,
          color: INK_SOFT,
        });
        layout.y -= 6;
        break;
      }
      case "table": {
        layout.y -= 10;
        ensureSpace(layout, 40);
        drawTable(layout, block.rows, fonts);
        break;
      }
      case "rule": {
        ensureSpace(layout, 16);
        layout.y -= 10;
        layout.page.drawLine({
          start: { x: MARGIN_X, y: layout.y },
          end: { x: MARGIN_X + CONTENT_WIDTH, y: layout.y },
          thickness: 0.6,
          color: RULE,
        });
        break;
      }
    }
  });
}

/** "17 Feb 2026" - stable regardless of locale quirks in the PDF text. */
function formatDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Render a Detailed+ answer as a PDF. Resolves to the file bytes plus the title
 * and filename it settled on; nothing is written or uploaded.
 */
export async function buildNotesPdf(
  markdown: string,
  meta: NotesPdfMeta = {},
): Promise<{ bytes: Uint8Array; title: string; filename: string }> {
  const blocks = parseNotesMarkdown(markdown);

  // The document title comes from the answer's own `# ` heading when it has one,
  // which then must not be drawn twice.
  const leadHeading = blocks[0]?.kind === "heading" && blocks[0].level === 1 ? blocks[0] : null;
  // Block text is already sanitized; the caller-supplied strings are not.
  const title =
    toPdfText(meta.title || leadHeading?.text || meta.fallbackTitle || "").trim() || "Study notes";
  const body = leadHeading ? blocks.slice(1) : blocks;

  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  doc.setTitle(toPdfText(title));
  doc.setSubject("Study notes");
  doc.setCreator("G&D");
  doc.setProducer("G&D");
  if (meta.studentName) doc.setAuthor(toPdfText(meta.studentName));

  const layout: Layout = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN_TOP,
    fonts,
  };

  // Cover block: title, then a muted meta line under a coral rule.
  drawLines(layout, wrapText(title, fonts.bold, SIZE_TITLE, CONTENT_WIDTH), {
    font: fonts.bold,
    size: SIZE_TITLE,
    leading: SIZE_TITLE * 1.3,
  });
  layout.y -= 8;
  layout.page.drawLine({
    start: { x: MARGIN_X, y: layout.y },
    end: { x: MARGIN_X + 46, y: layout.y },
    thickness: 2.4,
    color: ACCENT,
  });
  layout.y -= 4;

  const metaBits = ["Study notes", formatDate(new Date())];
  if (meta.studentName) metaBits.push(meta.studentName);
  drawLines(layout, [metaBits.join("  ·  ")], {
    font: fonts.body,
    size: SIZE_META,
    color: INK_SOFT,
    leading: SIZE_META * 1.9,
  });
  if (meta.sourceLabel) {
    drawLines(layout, wrapText(toPdfText(meta.sourceLabel), fonts.body, SIZE_META, CONTENT_WIDTH), {
      font: fonts.body,
      size: SIZE_META,
      color: INK_SOFT,
      leading: SIZE_META * 1.5,
    });
  }
  layout.y -= 6;

  drawBlocks(layout, body);

  // Footers last, so the page count is known.
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(toPdfText("Made with G&D"), {
      x: MARGIN_X,
      y: MARGIN_BOTTOM - 32,
      size: SIZE_META - 0.5,
      font: fonts.body,
      color: INK_SOFT,
    });
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN_X - fonts.body.widthOfTextAtSize(label, SIZE_META - 0.5),
      y: MARGIN_BOTTOM - 32,
      size: SIZE_META - 0.5,
      font: fonts.body,
      color: INK_SOFT,
    });
  });

  return { bytes: await doc.save(), title, filename: notesPdfFilename(title) };
}

/** "Cardiac cycle" -> "cardiac-cycle-notes.pdf" */
export function notesPdfFilename(title: string): string {
  const slug = toPdfText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "study"}-notes.pdf`;
}

/** Hand the bytes to the browser as a download. */
export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh ArrayBuffer: pdf-lib can hand back a view onto a larger
  // buffer, and Blob would then include the slack bytes.
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke late so slower webviews have finished reading the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
