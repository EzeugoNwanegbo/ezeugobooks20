// pdfjs-dist 3.x legacy build supports iOS Safari ~11+ and does NOT use
// Promise.withResolvers (the ES2024 API that breaks pre-iOS-17.4 Safari in
// pdfjs 4.x/5.x). UMD `.js` files instead of `.mjs`.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";
import { readBlobAsArrayBuffer } from "@/lib/file";

GlobalWorkerOptions.workerSrc = workerUrl;

// pdfjs needs CMap + standard-font data files for many real-world PDFs
// (anything with embedded subset fonts, non-Latin scripts, or exported from
// Pages / Word / Acrobat). Without these, pdfjs throws during parse. We point
// to the unpkg CDN — only the specific files a given PDF needs get fetched,
// and they're small (a few KB each).
const PDFJS_VERSION = "3.11.174";
const CMAP_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
const STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;

export async function extractPdfText(
  file: File,
  maxChars = Number.POSITIVE_INFINITY,
): Promise<{ text: string; pageCount: number }> {
  let pdf: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
  try {
    const buf = new Uint8Array(await readBlobAsArrayBuffer(file));
    pdf = await getDocument({
      data: buf,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
      // Don't auto-prompt for passwords — surface a clear error instead.
      password: "",
    }).promise;

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
      throw new Error("__SCANNED_PDF__");
    }

    return { text: out, pageCount };
  } catch (error) {
    // Always log the raw error — invaluable when a future PDF fails.
    console.error("extract pdf text", {
      name: file.name,
      type: file.type,
      size: file.size,
      error,
    });

    const errAny = error as { name?: string; code?: number; message?: string };
    const message = errAny?.message || "";

    if (message === "__SCANNED_PDF__") {
      throw new Error(
        "This PDF has no selectable text — it looks like a scanned document. Upload the pages as images instead (PNG/JPG), and we'll OCR them.",
      );
    }

    // pdfjs throws named exceptions for these — match on .name first, then
    // fall back to message text since the legacy build sometimes loses the name.
    if (errAny?.name === "PasswordException" || /password/i.test(message)) {
      throw new Error(
        "This PDF is password-protected. Remove the password (Print → Save as PDF on iPhone usually works) and try again.",
      );
    }

    if (errAny?.name === "InvalidPDFException" || /invalid pdf|corrupt/i.test(message)) {
      throw new Error(
        "This PDF appears to be damaged. Try re-downloading it, or open it once in your PDF reader and save a fresh copy.",
      );
    }

    if (errAny?.name === "MissingPDFException" || /missing pdf/i.test(message)) {
      throw new Error(
        "Could not read this PDF — the file may not have finished downloading from iCloud. Open it in Files first to force a local copy, then try again.",
      );
    }

    if (/out of memory|allocation/i.test(message)) {
      throw new Error(
        "This PDF is too large for your device's browser to parse. Try splitting it into smaller files (under ~50 MB each).",
      );
    }

    // Unknown error — surface the underlying message so the user has
    // something actionable to share with support.
    throw new Error(
      `Could not read this PDF in the browser${message ? `: ${message}` : ""}. Try opening it on a computer and re-saving as a standard PDF.`,
    );
  } finally {
    if (pdf) {
      try {
        await pdf.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
