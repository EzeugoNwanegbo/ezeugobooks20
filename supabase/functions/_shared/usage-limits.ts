import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export class UsageLimitError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key)
    throw new UsageLimitError("AI usage controls are unavailable. Please try again later.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function verifiedUser(auth: string | null): Promise<string> {
  const token = auth?.replace(/^Bearer\s+/i, "");
  if (!token) throw new UsageLimitError("Sign in to use AI features.", 401);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user)
    throw new UsageLimitError("Your session has expired. Please sign in again.", 401);
  return data.user.id;
}

export async function chargeAiCredits(auth: string | null, action: string, cost: number) {
  const user = await verifiedUser(auth);
  return chargeAiCreditsFor(user, action, cost);
}

export async function chargeAiCreditsFor(user: string, action: string, cost: number) {
  if (!Number.isSafeInteger(cost) || cost < 1)
    throw new UsageLimitError("Invalid AI credit charge.", 400);
  const { data, error } = await adminClient().rpc("spend_cookies_for", {
    p_user: user,
    p_action: action,
    p_cost: cost,
  });
  if (error)
    throw new UsageLimitError("AI usage controls are unavailable. Please try again later.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.ok !== "boolean")
    throw new UsageLimitError("AI usage controls are unavailable. Please try again later.");
  if (!row.ok)
    return {
      status: "refused" as const,
      remaining: row.remaining ?? 0,
      allowance: row.allowance ?? 0,
    };
  if (!Number.isSafeInteger(row.spend_id) || row.spend_id <= 0)
    throw new UsageLimitError("AI usage controls are unavailable. Please try again later.");
  return { status: "charged" as const, spendId: row.spend_id };
}

export async function refundAiCredits(auth: string, spendId: number | null) {
  if (spendId == null) return;
  try {
    const user = await verifiedUser(auth);
    await adminClient().rpc("refund_ai_credit_spend_for", { p_user: user, p_spend_id: spendId });
  } catch {
    /* Best effort; never expose credentials or bypass the next charge. */
  }
}

function positiveSetting(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

/** Reject oversized bodies before parsing them or sending them to a provider. */
export async function readAiBody(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new UsageLimitError("Missing request body.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UsageLimitError(
          "This request is too large. Select fewer files or shorten the input.",
          413,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new UsageLimitError("Invalid JSON request.", 400);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Bound every paid hop, including retries and calls whose answers fail later.
 * Reservations are deliberately not refunded: the provider may have billed it.
 */
export async function fetchAiWithLimits(
  input: string,
  init: RequestInit,
  outputCap = 4096,
): Promise<Response> {
  if (typeof init.body !== "string") throw new UsageLimitError("Invalid AI request.", 400);
  const body = JSON.parse(init.body);
  let inputChars = 0;
  if (new URL(input).pathname.endsWith("/responses")) {
    inputChars = String(body.instructions ?? "").length + JSON.stringify(body.input ?? "").length;
    const cap = positiveSetting("AI_MAX_OUTPUT_TOKENS", outputCap);
    body.max_output_tokens =
      Number.isSafeInteger(body.max_output_tokens) && body.max_output_tokens > 0
        ? Math.min(body.max_output_tokens, cap)
        : cap;
    body.max_tool_calls = 1;
  } else if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      const parts = Array.isArray(message.content)
        ? message.content
        : [{ type: "text", text: message.content }];
      for (const part of parts)
        inputChars += part.type === "image_url" ? 8192 : String(part.text ?? "").length;
    }
    const cap = positiveSetting("AI_MAX_OUTPUT_TOKENS", outputCap);
    const supplied = body.max_completion_tokens ?? body.max_tokens;
    const tokens = Number.isSafeInteger(supplied) && supplied > 0 ? Math.min(supplied, cap) : cap;
    if (new URL(input).hostname === "api.openai.com") {
      delete body.max_tokens;
      body.max_completion_tokens = tokens;
    } else {
      delete body.max_completion_tokens;
      body.max_tokens = tokens;
    }
  } else if (body.input) {
    const texts = Array.isArray(body.input) ? body.input : [body.input];
    inputChars = texts.reduce((n: number, text: unknown) => n + String(text).length, 0);
  } else throw new UsageLimitError("Unsupported AI request.", 400);
  if (inputChars > 200_000)
    throw new UsageLimitError(
      "Too much material in one request. Select fewer files or shorten your question.",
      413,
    );
  const outputTokens = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? 0;
  const { data, error } = await adminClient().rpc("reserve_ai_provider_budget", {
    p_output_tokens: outputTokens,
    p_input_chars: inputChars,
    p_call_limit: positiveSetting("AI_DAILY_PROVIDER_CALL_LIMIT", 100),
    p_output_limit: positiveSetting("AI_DAILY_OUTPUT_TOKEN_LIMIT", 300_000),
    p_input_limit: positiveSetting("AI_DAILY_INPUT_CHAR_LIMIT", 2_000_000),
  });
  if (error)
    throw new UsageLimitError("AI usage controls are unavailable. Please try again later.");
  if (data !== true)
    throw new UsageLimitError(
      "G&D has reached its daily AI budget. Please come back after the daily reset.",
      429,
    );
  return fetch(input, { ...init, body: JSON.stringify(body) });
}

/** Authenticate auxiliary paid endpoints and charge once before their work. */
export function withAiCredits(
  handler: (req: Request) => Promise<Response>,
  action: string,
  cost: number,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return handler(req);
    const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
    if (req.method !== "POST")
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers,
      });
    const auth = req.headers.get("Authorization");
    let spendId: number | null = null;
    try {
      const charge = await chargeAiCredits(auth, action, cost);
      if (charge.status === "refused")
        return new Response(
          JSON.stringify({
            error: "out_of_cookies",
            remaining: charge.remaining,
            allowance: charge.allowance,
          }),
          { status: 402, headers },
        );
      spendId = charge.spendId;
      const response = await handler(req);
      if (!response.ok && auth) await refundAiCredits(auth, spendId);
      return response;
    } catch (error) {
      if (auth && spendId) await refundAiCredits(auth, spendId);
      return new Response(
        JSON.stringify({
          error: error instanceof UsageLimitError ? error.message : "AI request failed.",
        }),
        { status: error instanceof UsageLimitError ? error.status : 500, headers },
      );
    }
  };
}
