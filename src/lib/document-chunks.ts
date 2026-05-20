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
  text: string;
};

export function documentPreview(text: string): string {
  if (text.length <= DOCUMENT_PREVIEW_CHARS) return text;
  return `${text.slice(0, DOCUMENT_PREVIEW_CHARS)}\n\n[...preview truncated; full text is stored in searchable chunks]`;
}

export function chunkDocumentText(text: string): DocumentChunkInput[] {
  const pages = parsePageBlocks(text);
  const chunks = pages.some((page) => page.page !== null)
    ? chunkPages(pages)
    : chunkPlainText(text, null);

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunk_index: index,
    token_estimate: Math.ceil(chunk.content.length / 4),
  }));
}

function parsePageBlocks(text: string): PageBlock[] {
  const marker = /\[Page\s+(\d+)\]\s*/g;
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  while ((match = marker.exec(text)) !== null) {
    matches.push(match);
  }

  if (matches.length === 0) return [{ page: null, text }];

  return matches.map((match, index) => {
    const page = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return {
      page,
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
    const labelled = `[Page ${page.page ?? "?"}]\n${page.text.trim()}`;
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
