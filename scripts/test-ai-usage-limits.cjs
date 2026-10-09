// Run with: node scripts/test-ai-usage-limits.cjs
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");
let calls = [],
  providerCalls = [],
  authError = null,
  rpcError = null,
  reserve = true;
let spend = { ok: true, spend_id: 12, remaining: 14, allowance: 15 };
const settings = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only",
};
const context = vm.createContext({
  exports: {},
  Response,
  Request,
  URL,
  Number,
  JSON,
  Error,
  console,
  TextDecoder,
  Uint8Array,
  Deno: { env: { get: (name) => settings[name] } },
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: authError ? null : { id: "user-1" } },
        error: authError,
      }),
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === "spend_cookies_for" ? spend : reserve, error: rpcError };
    },
  }),
  fetch: async (url, init) => {
    providerCalls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true });
  },
});
const source = fs
  .readFileSync("supabase/functions/_shared/usage-limits.ts", "utf8")
  .replace(/import[^;]+;/, "");
vm.runInContext(
  ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }),
  context,
);
const { chargeAiCredits, fetchAiWithLimits, withAiCredits, readAiBody } = context.exports;
let count = 0;
async function test(name, fn) {
  calls = [];
  providerCalls = [];
  await fn();
  count++;
  console.log("PASS", name);
}
(async () => {
  await test("missing session cannot spend", async () => {
    await assert.rejects(chargeAiCredits(null, "chat", 1), (e) => e.status === 401);
    assert.equal(calls.length, 0);
  });
  await test("unverified token cannot spend", async () => {
    authError = "invalid";
    await assert.rejects(chargeAiCredits("Bearer fake", "chat", 1), (e) => e.status === 401);
    authError = null;
    assert.equal(calls.length, 0);
  });
  await test("missing server configuration blocks work", async () => {
    delete settings.SUPABASE_SERVICE_ROLE_KEY;
    await assert.rejects(chargeAiCredits("Bearer test", "chat", 1), (e) => e.status === 503);
    settings.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  });
  await test("billing outage blocks work", async () => {
    rpcError = "missing function";
    await assert.rejects(chargeAiCredits("Bearer test", "chat", 1), (e) => e.status === 503);
    rpcError = null;
  });
  await test("empty billing response blocks work", async () => {
    spend = null;
    await assert.rejects(chargeAiCredits("Bearer test", "chat", 1), (e) => e.status === 503);
    spend = { ok: true, spend_id: 12 };
  });
  await test("exhausted auxiliary budget never invokes handler", async () => {
    spend = { ok: false, remaining: 0, allowance: 15 };
    let ran = false;
    const r = await withAiCredits(
      async () => {
        ran = true;
        return Response.json({});
      },
      "embed",
      1,
    )(
      new Request("https://example.com", {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      }),
    );
    assert.equal(r.status, 402);
    assert.equal(ran, false);
    spend = { ok: true, spend_id: 12 };
  });
  await test("chat completions receive output cap before fetch", async () => {
    await fetchAiWithLimits("https://api.deepseek.com/v1/chat/completions", {
      body: JSON.stringify({ messages: [{ content: "question" }], max_tokens: 9000 }),
    });
    assert.equal(providerCalls[0].body.max_tokens, 4096);
    assert.equal(calls[0].args.p_output_tokens, 4096);
  });
  await test("OpenAI chat uses correct token parameter", async () => {
    await fetchAiWithLimits("https://api.openai.com/v1/chat/completions", {
      body: JSON.stringify({ messages: [{ content: "question" }] }),
    });
    assert.equal(providerCalls[0].body.max_completion_tokens, 4096);
    assert.equal(providerCalls[0].body.max_tokens, undefined);
  });
  await test("web search caps output and tool calls", async () => {
    await fetchAiWithLimits("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        instructions: "research",
        input: [{ content: "question" }],
        tools: [{ type: "web_search" }],
      }),
    });
    assert.equal(providerCalls[0].body.max_output_tokens, 4096);
    assert.equal(providerCalls[0].body.max_tool_calls, 1);
  });
  await test("input overflow never contacts provider", async () => {
    await assert.rejects(
      fetchAiWithLimits("https://api.deepseek.com/v1/chat/completions", {
        body: JSON.stringify({ messages: [{ content: "a".repeat(200001) }] }),
      }),
      (e) => e.status === 413,
    );
    assert.equal(providerCalls.length, 0);
  });
  await test("exhausted global budget never contacts provider", async () => {
    reserve = false;
    await assert.rejects(
      fetchAiWithLimits("https://api.deepseek.com/v1/chat/completions", {
        body: JSON.stringify({ messages: [{ content: "q" }] }),
      }),
      (e) => e.status === 429,
    );
    reserve = true;
    assert.equal(providerCalls.length, 0);
  });
  await test("global billing outage never contacts provider", async () => {
    rpcError = "unavailable";
    await assert.rejects(
      fetchAiWithLimits("https://api.openai.com/v1/embeddings", {
        body: JSON.stringify({ input: ["text"] }),
      }),
      (e) => e.status === 503,
    );
    rpcError = null;
    assert.equal(providerCalls.length, 0);
  });
  await test("embeddings reserve input budget", async () => {
    await fetchAiWithLimits("https://api.openai.com/v1/embeddings", {
      body: JSON.stringify({ input: ["abc", "def"] }),
    });
    assert.equal(calls[0].args.p_input_chars, 6);
    assert.equal(calls[0].args.p_output_tokens, 0);
  });
  await test("failed auxiliary action refunds through server RPC", async () => {
    const r = await withAiCredits(
      async () => Response.json({ error: "fail" }, { status: 500 }),
      "embed",
      1,
    )(
      new Request("https://example.com", {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      }),
    );
    assert.equal(r.status, 500);
    assert.equal(calls[1].name, "refund_ai_credit_spend_for");
  });
  await test("successful auxiliary action is not refunded", async () => {
    await withAiCredits(
      async () => Response.json({}),
      "embed",
      1,
    )(
      new Request("https://example.com", {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      }),
    );
    assert.equal(calls.length, 1);
  });
  await test("environment can tighten but not raise hard ceilings", async () => {
    settings.AI_MAX_OUTPUT_TOKENS = "1024";
    await fetchAiWithLimits("https://api.deepseek.com/v1/chat/completions", {
      body: JSON.stringify({ messages: [{ content: "q" }] }),
    });
    assert.equal(providerCalls[0].body.max_tokens, 1024);
    settings.AI_MAX_OUTPUT_TOKENS = "99999";
    await fetchAiWithLimits("https://api.deepseek.com/v1/chat/completions", {
      body: JSON.stringify({ messages: [{ content: "q" }] }),
    });
    assert.equal(providerCalls[1].body.max_tokens, 4096);
    delete settings.AI_MAX_OUTPUT_TOKENS;
  });
  await test("oversized HTTP body is rejected before JSON parsing", async () => {
    await assert.rejects(
      readAiBody(
        new Request("https://example.com", { method: "POST", body: "x".repeat(101) }),
        100,
      ),
      (e) => e.status === 413,
    );
  });
  await test("malformed JSON gives a client error", async () => {
    await assert.rejects(
      readAiBody(new Request("https://example.com", { method: "POST", body: "{" })),
      (e) => e.status === 400,
    );
  });
  await test("valid HTTP JSON body is accepted", async () => {
    const body = await readAiBody(
      new Request("https://example.com", { method: "POST", body: '{"count":5}' }),
    );
    assert.equal(body.count, 5);
  });
  console.log(`${count} usage-control checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
