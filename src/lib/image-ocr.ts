import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const IMAGE_OCR_URL = `${SUPABASE_URL}/functions/v1/extract-image`;
const IMAGE_OCR_TIMEOUT_MS = 90_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

export async function extractImageText(file: File): Promise<{ text: string; pageCount: number }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can use image extraction.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image too large for OCR (max 20 MB).");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), IMAGE_OCR_TIMEOUT_MS);

  try {
    const dataUrl = await fileToDataUrl(file);
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Sign in again before uploading images.");

    const response = await fetch(IMAGE_OCR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        dataUrl,
        fileName: file.name,
        mimeType: file.type,
      }),
    });

    if (!response.ok) {
      let message = "Image extraction failed";
      try {
        const json = await response.json();
        message = json.error ?? message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const json = (await response.json()) as { text?: string };
    const text = (json.text || "").trim();
    if (!text) throw new Error("DeepSeek OCR did not find readable text in that image.");

    return {
      text: `\n\n[Page 1]\n${text}`,
      pageCount: 1,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
