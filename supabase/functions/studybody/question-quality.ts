// "medium" and "hard" remain wire/storage values so existing apps and saved
// sessions keep working. The two public modes are Recall and Applied.
export type QuestionDifficulty = "medium" | "hard";
export function questionDifficulty(value: unknown, hint?: unknown): QuestionDifficulty {
  if (value === "hard" || value === "applied") return "hard";
  if (value === "medium" || value === "recall" || value === "easy") return "medium";
  return hint === "harder" ? "hard" : "medium";
}
export function difficultyLabel(value: unknown) {
  return questionDifficulty(value) === "hard" ? "Applied" : "Recall";
}
type Option = { id: string; text: string };
const labels = ["A", "B", "C", "D"];
export function validMcq(question: Record<string, unknown>): boolean {
  const options = question.options;
  if (
    typeof question.prompt !== "string" ||
    !question.prompt.trim() ||
    typeof question.explanation !== "string" ||
    !question.explanation.trim() ||
    !Array.isArray(options) ||
    options.length !== 4
  )
    return false;
  if (
    !options.every(
      (o) =>
        o &&
        typeof o.id === "string" &&
        labels.includes(o.id) &&
        typeof o.text === "string" &&
        o.text.trim(),
    )
  )
    return false;
  if (
    new Set(options.map((o) => o.id)).size !== 4 ||
    !labels.includes(String(question.correct_answer))
  )
    return false;
  const texts = options.map((o) =>
    o.text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, ""),
  );
  if (new Set(texts).size !== 4 || texts.some((t) => /^(?:all|none) of (?:the )?above\b/.test(t)))
    return false;
  const words = texts.map((t) => t.split(/\s+/).length),
    chars = texts.map((t) => t.length);
  // Reject surface cues rather than padding distractors with unsupported facts.
  if (Math.max(...words) - Math.min(...words) > Math.max(2, Math.ceil(Math.min(...words) * 0.25)))
    return false;
  if (Math.max(...chars) - Math.min(...chars) > Math.max(14, Math.ceil(Math.min(...chars) * 0.5)))
    return false;
  const correct = options.findIndex((o) => o.id === question.correct_answer);
  const others = words.filter((_, i) => i !== correct);
  if (words[correct] > Math.max(...others) + 1) return false;
  return true;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function relabel(text: string, map: Record<string, string>) {
  return text.replace(
    /\b(options?|choices?|answers?)\s+\(?([A-Za-z])\)?(?![\w])|\(([A-Za-z])\)/gi,
    (whole, word, label, bracket) => {
      const next = map[(label ?? bracket ?? "").toUpperCase()];
      return next ? (word ? `${word} ${next}` : `(${next})`) : whole;
    },
  );
}
export function balanceMcqs(
  questions: Record<string, unknown>[],
  random: () => number = Math.random,
): Record<string, unknown>[] {
  if (questions.some((q) => !validMcq(q)))
    throw new Error("Cannot balance invalid multiple-choice questions.");
  // Balance the whole accepted set, then shuffle it. Unlike repeating bags of
  // four, the last letter of each four-question block is not forced.
  const order = shuffle([0, 1, 2, 3], random);
  const slots = shuffle(
    questions.map((_, i) => order[i % 4]),
    random,
  );
  return questions.map((q, i) => {
    const options = q.options as Option[];
    const correct = options.find((o) => o.id === q.correct_answer)!;
    const wrong = shuffle(
      options.filter((o) => o !== correct),
      random,
    );
    const next = labels.map((id, j) => ({
      id,
      text: j === slots[i] ? correct.text : wrong.shift()!.text,
    }));
    const map: Record<string, string> = {};
    for (const original of options)
      map[original.id] = next.find((o) => o.text === original.text)!.id;
    return {
      ...q,
      options: next,
      correct_answer: labels[slots[i]],
      explanation: relabel(q.explanation as string, map),
    };
  });
}
