import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
// Use bundled worker
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(
  file: File,
  maxChars = Number.POSITIVE_INFINITY,
): Promise<{ text: string; pageCount: number }> {
  const buf = await file.arrayBuffer();
  const pdf = await getDocument({ data: buf }).promise;
  const pageCount = pdf.numPages;
  let out = "";
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it: unknown) =>
        typeof (it as { str?: string }).str === "string" ? (it as { str: string }).str : "",
      )
      .join(" ");
    out += `\n\n[Page ${i}]\n${pageText}`;
    if (out.length >= maxChars) {
      out = out.slice(0, maxChars) + "\n\n[...truncated]";
      break;
    }
  }
  return { text: out, pageCount };
}
