import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(
  file: File,
  maxChars = Number.POSITIVE_INFINITY,
): Promise<{ text: string; pageCount: number }> {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
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

    if (!out.trim()) {
      throw new Error("This PDF does not contain selectable text.");
    }

    return { text: out, pageCount };
  } catch (error) {
    console.error("extract pdf text", error);
    if (error instanceof Error && error.message === "This PDF does not contain selectable text.") {
      throw new Error(
        "This PDF has no readable text. If it is a scanned document, upload page images instead.",
      );
    }

    throw new Error(
      "Could not read this PDF in the browser. Try saving it as a standard PDF or upload a text file.",
    );
  }
}
