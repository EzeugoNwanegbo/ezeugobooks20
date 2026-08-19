export type DocumentChunkInput = {
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  token_estimate: number;
};

const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 700;
const DOCUMENT_PREVIEW_CHARS = 120_000;

type PageBlock = {
  page: number | null;
  /**
   * The page number printed on the page itself, when the document supports one.
   * Distinct from `page`, which is the sheet's position in the file - they
   * differ by the length of the front matter. See src/lib/book-pages.ts.
   */
  bookPage: number | null;
  text: string;
};

export function sanitizeExtractedText(text: string): string {
  let out = "";

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);

    // PostgreSQL rejects JSON strings containing \u0000 before PostgREST can
    // write them to text columns. Other non-whitespace C0 controls are not
    // useful study text either, so strip/space them before document inserts.
    if (code === 0) continue;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      out += " ";
      continue;
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) continue;

    out += text[i];
  }

  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function documentPreview(text: string): string {
  const cleanText = sanitizeExtractedText(text);
  if (cleanText.length <= DOCUMENT_PREVIEW_CHARS) return cleanText;
  return `${cleanText.slice(0, DOCUMENT_PREVIEW_CHARS)}\n\n[...preview truncated; full text is stored in searchable chunks]`;
}

export function chunkDocumentText(text: string): DocumentChunkInput[] {
  const cleanText = sanitizeExtractedText(text);
  const pages = parsePageBlocks(cleanText);
  const chunks = pages.some((page) => page.page !== null)
    ? chunkPages(pages)
    : chunkPlainText(cleanText, null);

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunk_index: index,
    token_estimate: Math.ceil(chunk.content.length / 4),
  }));
}

function parsePageBlocks(text: string): PageBlock[] {
  // The book-page half is optional: documents with no consistent folio (slide
  // decks, lecture notes) keep the plain `[Page N]` marker, and so does every
  // document extracted before book pages existed.
  const marker = /\[Page\s+(\d+)(?:\s*\|\s*Book page\s+(\d+))?\]\s*/g;
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  while ((match = marker.exec(text)) !== null) {
    matches.push(match);
  }

  if (matches.length === 0) return [{ page: null, bookPage: null, text }];

  return matches.map((match, index) => {
    const page = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return {
      page,
      bookPage: match[2] ? Number(match[2]) : null,
      text: text.slice(start, end).trim(),
    };
  });
}

function chunkPages(
  pages: PageBlock[],
): Omit<DocumentChunkInput, "chunk_index" | "token_estimate">[] {
  const chunks: Omit<DocumentChunkInput, "chunk_index" | "token_estimate">[] = [];
  let current = "";
  let pageStart: number | null = null;
  let pageEnd: number | null = null;

  const flush = () => {
    const content = current.trim();
    if (!content) return;
    chunks.push({ content, page_start: pageStart, page_end: pageEnd });
    current = "";
    pageStart = null;
    pageEnd = null;
  };

  for (const page of pages) {
    // Re-stamped rather than carried through verbatim, because a chunk can span
    // several pages and each one has to name itself inside the chunk text - that
    // label is what the model copies into a citation.
    const sheet = page.page ?? "?";
    const marker =
      page.bookPage === null ? `[Page ${sheet}]` : `[Page ${sheet} | Book page ${page.bookPage}]`;
    const labelled = `${marker}\n${page.text.trim()}`;
    if (labelled.length > CHUNK_CHARS) {
      flush();
      chunks.push(...chunkPlainText(labelled, page.page));
      continue;
    }

    if (current && current.length + labelled.length + 2 > CHUNK_CHARS) flush();

    current = current ? `${current}\n\n${labelled}` : labelled;
    pageStart = pageStart ?? page.page;
    pageEnd = page.page ?? pageEnd;
  }

  flush();
  return chunks;
}

function chunkPlainText(
  text: string,
  page: number | null,
): Omit<DocumentChunkInput, "chunk_index" | "token_estimate">[] {
  const chunks: Omit<DocumentChunkInput, "chunk_index" | "token_estimate">[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_CHARS);
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ content, page_start: page, page_end: page });
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}
