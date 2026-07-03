// Client-side text extraction for modern Office files (.docx, .pptx). Both are
// just ZIP archives of XML, so we unzip with fflate and pull the visible text
// runs out of the document/slide XML. We only need raw text for search and
// chunking, so formatting is intentionally discarded. Legacy binary .doc/.ppt
// are NOT handled here - they need heavy tooling and are rejected upstream.

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    // Ampersand last so we don't double-decode the entities above.
    .replace(/&amp;/g, "&");
}

// Turn an OOXML fragment into plain text: convert paragraph/line-break tags to
// newlines, strip every other tag (attribute values live inside tags, so they
// drop out cleanly), then decode entities and tidy whitespace.
function xmlToText(xml: string, breakPattern: RegExp): string {
  return decodeXmlEntities(xml.replace(breakPattern, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

export async function extractDocxText(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const docXml = entries["word/document.xml"];
  if (!docXml) return "";
  // <w:p> ends a paragraph, <w:br/> a soft line break.
  return xmlToText(strFromU8(docXml), /<\/w:p>|<w:br\s*\/?>/g);
}

export async function extractPptxText(
  file: File,
): Promise<{ text: string; slideCount: number }> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const slideNames = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const parts: string[] = [];
  slideNames.forEach((name, index) => {
    // <a:p> ends a text paragraph, <a:br> a line break, inside DrawingML.
    const text = xmlToText(strFromU8(entries[name]), /<\/a:p>|<a:br\s*\/?>/g);
    if (text) parts.push(`[Slide ${index + 1}]\n${text}`);
  });

  return { text: parts.join("\n\n"), slideCount: slideNames.length };
}
