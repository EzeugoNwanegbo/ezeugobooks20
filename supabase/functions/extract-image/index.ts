const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  dataUrl: string;
  fileName: string;
  mimeType: string;
}

const DEEPSEEK_OCR_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Body;
    const ocrBaseUrl = Deno.env.get("DEEPSEEK_OCR_BASE_URL");
    const apiKey = Deno.env.get("DEEPSEEK_OCR_API_KEY") || Deno.env.get("DEEPSEEK_API_KEY");
    const model = Deno.env.get("DEEPSEEK_OCR_MODEL") || "deepseek-ai/DeepSeek-OCR";

    if (!ocrBaseUrl || !apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "DeepSeek OCR is not configured. Set DEEPSEEK_OCR_BASE_URL and DEEPSEEK_OCR_API_KEY in Supabase secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.dataUrl?.startsWith("data:image/")) {
      return new Response(JSON.stringify({ error: "Only image uploads are supported." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const upstream = await fetchWithTimeout(
      joinUrl(ocrBaseUrl, "/v1/chat/completions"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 8192,
          messages: [
            {
              role: "system",
              content:
                "Extract all readable text from the image. Preserve headings, tables, lists, labels, formulas, and page-like layout where possible. Return clean markdown only, with no commentary.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extract the text from this uploaded study image: ${body.fileName}`,
                },
                {
                  type: "image_url",
                  image_url: { url: body.dataUrl },
                },
              ],
            },
          ],
        }),
      },
      DEEPSEEK_OCR_TIMEOUT_MS,
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("DeepSeek OCR error:", upstream.status, text);
      return new Response(JSON.stringify({ error: "DeepSeek OCR failed" }), {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await upstream.json();
    const extractedText = (json.choices?.[0]?.message?.content ?? "").toString().trim();

    return new Response(JSON.stringify({ text: extractedText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-image error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
