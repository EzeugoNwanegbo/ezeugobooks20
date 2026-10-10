// Exercise the real generation accumulator with mocked provider responses.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript");
let calls = 0,
  lastPrompt = "";
const good = (i) => ({
  prompt: `Which change increases output in example ${i}?`,
  options: [
    { id: "A", text: "A faster heart rate" },
    { id: "B", text: "A slower heart rate" },
    { id: "C", text: "A lower stroke volume" },
    { id: "D", text: "A smaller stroke volume" },
  ],
  correct_answer: "A",
  explanation: "Option A increases output; option B reduces it.",
  source_refs: [{ file: "Physiology.pdf", page: "Page 5" }],
});
const ctx = vm.createContext({
  Response,
  Request,
  URL,
  Number,
  JSON,
  Error,
  console,
  AbortController,
  setTimeout,
  clearTimeout,
  Date,
  Deno: {
    env: { get: (n) => (n === "QUESTION_PROVIDER" ? "deepseek" : undefined) },
    serve: () => {},
  },
  fetchAiWithLimits: async (url, init) => {
    calls++;
    lastPrompt = JSON.parse(init.body).messages[1].content;
    const bad = good(99);
    bad.options[0].text =
      "An extremely elaborate long answer that identifies every detail and also explains the entire mechanism while the others are short";
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              questions: [bad, null, ...Array.from({ length: 7 }, (_, i) => good(i))],
            }),
          },
        },
      ],
    });
  },
  UsageLimitError: class extends Error {},
  readAiBody: () => {},
  chargeAiCredits: () => {},
  chargeAiCreditsFor: () => {},
  refundAiCredits: () => {},
});
function load(file, extra = "") {
  const source = fs
    .readFileSync(file, "utf8")
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "");
  const compiled = ts.transpile(source + extra, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  });
  return vm.runInContext(`(function(){const exports={};${compiled};return exports;})()`, ctx);
}
Object.assign(ctx, load("supabase/functions/studybody/question-quality.ts"));
const { generateOneType } = load(
  "supabase/functions/studybody/index.ts",
  "\nexport {generateOneType};",
);
(async () => {
  const result = await generateOneType(
    {
      profile: {},
      difficulty: "recall",
      documents: [
        {
          file_name: "Physiology.pdf",
          excerpt: "[Page 5] Cardiac output equals heart rate multiplied by stroke volume.",
        },
      ],
      topic: { title: "Cardiac output" },
    },
    "fixture-key",
    undefined,
    "mcq",
    5,
    [],
  );
  assert.equal(calls, 1);
  assert.equal(result.length, 5);
  assert.ok(result.every((q) => q.options.length === 4 && q.difficulty === "medium"));
  assert.ok(!result.some((q) => q.prompt.includes("99")));
  assert.ok(lastPrompt.includes("QUESTION MODE: RECALL"));
  assert.ok(lastPrompt.includes("Exactly FOUR options"));
  const counts = ["A", "B", "C", "D"].map(
    (id) => result.filter((q) => q.correct_answer === id).length,
  );
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  for (const q of result) {
    assert.equal(q.options.find((o) => o.id === q.correct_answer).text, "A faster heart rate");
    assert.ok(q.explanation.startsWith(`Option ${q.correct_answer} increases`));
  }
  console.log(
    "PASS: real generation pipeline rejects malformed/long options, caps accepted count and returns balanced canonical keys.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
