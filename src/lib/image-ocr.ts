import { createWorker } from "tesseract.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_OCR_IMAGE_DIMENSION = 2600;
const MAX_WORKER_INIT_MS = 20_000;

type OcrProgress = (status: string, percent?: number) => void;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image file."));
    };
    image.src = url;
  });
}

async function prepareImageForOcr(file: File): Promise<HTMLCanvasElement> {
  const image = await loadImage(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error("Could not read image dimensions.");
  }

  const scale = Math.min(1, MAX_OCR_IMAGE_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare image for OCR.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas;
}

function formatTesseractStatus(status: string): string {
  if (!status) return "Reading image text";
  return status
    .replace(/^loading/i, "Loading")
    .replace(/^recognizing/i, "Recognizing")
    .replace(/^initializing/i, "Initializing");
}

export async function extractImageText(
  file: File,
  onProgress?: OcrProgress,
): Promise<{ text: string; pageCount: number }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can use image extraction.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image too large for OCR (max 20 MB).");
  }

  onProgress?.("Preparing image for OCR", 5);
  const image = await prepareImageForOcr(file);

  const workerInit = createWorker("eng", 1, {
    logger: (message) => {
      const percent =
        typeof message.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(message.progress * 100)))
          : undefined;
      onProgress?.(formatTesseractStatus(message.status), percent);
    },
  });
  const workerTimeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "OCR engine took too long to load. Check your connection and try again, or use a PDF instead.",
          ),
        ),
      MAX_WORKER_INIT_MS,
    ),
  );
  const worker = await Promise.race([workerInit, workerTimeout]);

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    const result = await worker.recognize(image);
    const text = (result.data.text || "").trim();

    if (!text) {
      throw new Error(
        "Tesseract could not find readable text in that image. Try a clearer, higher-contrast image.",
      );
    }

    return {
      text: `\n\n[Page 1]\n${text}`,
      pageCount: 1,
    };
  } catch (error) {
    console.error("tesseract image extraction", error);
    if (error instanceof Error) throw error;
    throw new Error("Image OCR failed.");
  } finally {
    await worker.terminate();
  }
}
