import {
  fetchAiWithLimits,
  readAiBody,
  UsageLimitError,
  withAiCredits,
} from "../_shared/usage-limits.ts";
import { instruction, parseDraft, parseIntake } from "./contract.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(
  withAiCredits(
    async (req) => {
      if (req.method === "OPTIONS") return new Response(null, { headers });
      const body = await readAiBody(req, 140000);
      let intake;
      try {
        intake = parseIntake(body);
      } catch (e) {
        return reply({ error: e instanceof Error ? e.message : "Invalid interview." }, 400);
      }
      const key = Deno.env.get("DEEPSEEK_API_KEY");
      if (!key)
        return reply({ error: "Clerking AI is not configured. Please try again later." }, 503);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetchAiWithLimits(
          "https://api.deepseek.com/v1/chat/completions",
          {
            method: "POST",
            signal: controller.signal,
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-pro",
              temperature: 0.1,
              max_tokens: 3000,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: instruction },
                { role: "user", content: JSON.stringify({ answers: intake.answers }) },
              ],
            }),
          },
          3000,
        );
        if (!response.ok) {
          await response.body?.cancel();
          return reply({ error: "The clerking service could not finish. Please try again." }, 502);
        }
        const data = await response.json();
        if (data.choices?.[0]?.finish_reason !== "stop")
          return reply(
            { error: "The draft was incomplete. Please shorten the history and try again." },
            502,
          );
        const raw = data.choices?.[0]?.message?.content;
        if (typeof raw !== "string")
          return reply({ error: "The draft was incomplete. Please try again." }, 502);
        return reply(parseDraft(JSON.parse(raw), intake));
      } catch (e) {
        if (e instanceof UsageLimitError) throw e;
        // Never log patient history or raw provider output.
        return reply(
          {
            error:
              e instanceof Error && e.message.startsWith("The draft")
                ? e.message
                : "The clerking service could not finish. Please try again.",
          },
          502,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
    "clerking",
    2,
  ),
);
