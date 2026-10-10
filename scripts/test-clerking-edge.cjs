// Mocked edge integration: no real patient data, provider calls or database writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
let rpc = [],
  providers = [],
  allow = true,
  invalid = false,
  authBad = false,
  handler;
const settings = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only",
  DEEPSEEK_API_KEY: "test-only",
};
const ctx = vm.createContext({
  Response,
  Request,
  URL,
  Number,
  JSON,
  Error,
  TextDecoder,
  Uint8Array,
  AbortController,
  setTimeout,
  clearTimeout,
  console,
  Deno: {
    env: { get: (n) => settings[n] },
    serve: (fn) => {
      handler = fn;
    },
  },
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: authBad ? null : { id: "fixture-user" } },
        error: authBad ? "invalid" : null,
      }),
    },
    rpc: async (name, args) => {
      rpc.push({ name, args });
      return {
        data:
          name === "spend_cookies_for"
            ? { ok: allow, spend_id: 22, remaining: 0, allowance: 10 }
            : true,
        error: null,
      };
    },
  }),
  fetch: async (url, init) => {
    providers.push(JSON.parse(init.body));
    const intake = JSON.parse(providers.at(-1).messages[1].content);
    const sections = ctx.sections.map((s) => ({
      id: s.id,
      text: intake.answers[s.id] || "Not obtained.",
      evidence: intake.answers[s.id] ? [{ sectionId: s.id, quote: intake.answers[s.id] }] : [],
    }));
    if (invalid)
      sections[0] = {
        id: "biodata",
        text: "Invented patient",
        evidence: [{ sectionId: "biodata", quote: "Invented patient" }],
      };
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ sections, clarifications: [] }) },
        },
      ],
    });
  },
});
function load(file) {
  const source = fs
    .readFileSync(file, "utf8")
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "");
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  });
  return vm.runInContext(`(function(){const exports={};${compiled};return exports;})()`, ctx);
}
Object.assign(ctx, load("supabase/functions/_shared/usage-limits.ts"));
Object.assign(ctx, load("supabase/functions/clerking/contract.ts"));
load("supabase/functions/clerking/index.ts");
const input = {
  answers: { complaint: "Cough for two days.", biodata: "Initials A B, age 40." },
  clinicianFindings: "Clinician measured pulse 80 bpm.",
};
const request = (body = input, authorization = "Bearer fixture") =>
  new Request("https://example.supabase.co/functions/v1/clerking", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
    body: JSON.stringify(body),
  });
(async () => {
  let r = await handler(request(input, null));
  assert.equal(r.status, 401);
  assert.equal(providers.length, 0);
  authBad = true;
  r = await handler(request());
  assert.equal(r.status, 401);
  assert.equal(providers.length, 0);
  authBad = false;
  allow = false;
  r = await handler(request());
  assert.equal(r.status, 402);
  assert.equal(providers.length, 0);
  allow = true;
  rpc = [];
  r = await handler(request({ answers: {} }));
  assert.equal(r.status, 400);
  assert.equal(providers.length, 0);
  assert.ok(rpc.some((x) => x.name === "refund_ai_credit_spend_for"));
  rpc = [];
  r = await handler(request());
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.clinicianFindings, input.clinicianFindings);
  assert.equal(providers[0].max_tokens, 3000);
  assert.equal(rpc.find((x) => x.name === "spend_cookies_for").args.p_cost, 2);
  assert.ok(rpc.some((x) => x.name === "reserve_ai_provider_budget"));
  assert.equal(result.sections[5].text, "Not obtained.");
  invalid = true;
  rpc = [];
  r = await handler(request());
  assert.equal(r.status, 502);
  assert.ok(rpc.some((x) => x.name === "refund_ai_credit_spend_for"));
  assert.ok(!(await r.text()).includes("Invented patient"));
  console.log(
    "PASS: authenticated 2-credit charge, budget reservation, empty/invalid draft refund, missing sections and clinician-only examination.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
