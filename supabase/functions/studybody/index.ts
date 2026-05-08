const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action = "generate_plan" | "generate_questions" | "review_answers";
type QuestionType = "mcq" | "essay" | "mixed";

interface Profile {
  name?: string;
  university?: string;
  year?: string;
  exam_format?: string;
  preferred_mode?: string;
  weak_areas?: string[];
  recent_topics?: string[];
}

interface StudyDocument {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
}

interface Body {
  action: Action;
  profile: Profile;
  mode?: "Simplified" | "Detailed" | "Storytelling";
  planTitle?: string;
  courseOutline?: string;
  documents?: StudyDocument[];
  topic?: {
    id?: string;
    title: string;
    summary?: string | null;
    objectives?: unknown;
    source_refs?: unknown;
  };
  questionType?: QuestionType;
  count?: number;
  questions?: unknown[];
  answers?: Record<string, string>;
}

const MAX_DOC_CHARS_TOTAL = 100_000;
const DEEPSEEK_TIMEOUT_MS = 90_000;
const OPENAI_TIMEOUT_MS = 45_000;

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI returned invalid JSON");
    return JSON.parse(match[0]);
  }
}

function documentContext(documents: StudyDocument[] = []): string {
  if (!documents.length) return "No uploaded document excerpts were provided.";
  const perDoc = Math.max(2000, Math.floor(MAX_DOC_CHARS_TOTAL / documents.length));
  return documents
    .map(
      (doc) =>
        `=== DOCUMENT: ${doc.file_name}${doc.folder ? ` | folder: ${doc.folder}` : ""} (id:${doc.id}) ===\n${doc.excerpt.slice(0, perDoc)}`,
    )
    .join("\n\n---\n\n");
}

function profileBlock(profile: Profile): string {
  return `Student:
- Name: ${profile.name || "Student"}
- School: ${profile.university || "Unknown"}
- Level: ${profile.year || "Unknown"}
- Assessment format: ${profile.exam_format || "MCQ"}
- Preferred response mode: ${profile.preferred_mode || "Simplified"}
- Weak areas: ${(profile.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(profile.recent_topics || []).slice(0, 8).join(", ") || "none recorded"}`;
}

async function callDeepSeekJson(apiKey: string, systemPrompt: string, userPrompt: string) {
  const response = await fetchWithTimeout(
    "https://api.deepseek.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat",
        temperature: 0.2,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    DEEPSEEK_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek error ${response.status}: ${text}`);
  }

  const json = await response.json();
  return parseJsonObject(json.choices?.[0]?.message?.content ?? "{}");
}

async function callOpenAIText(apiKey: string, systemPrompt: string, userPrompt: string) {
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.55,
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    OPENAI_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const json = await response.json();
  return (json.choices?.[0]?.message?.content ?? "").toString().trim();
}

async function generatePlan(body: Body, deepSeekKey: string) {
  const result = await callDeepSeekJson(
    deepSeekKey,
    `You are StudyBody's roadmap engine. Read uploaded study material and produce a structured study roadmap.
DeepSeek does the file-reading and planning work. Return strict JSON only.`,
    `${profileBlock(body.profile)}

Plan title requested: ${body.planTitle || "Untitled study plan"}
Course outline supplied by user:
"""
${body.courseOutline || "No formal outline supplied. Create a sensible roadmap from the uploaded file excerpts."}
"""

Uploaded file excerpts:
${documentContext(body.documents)}

Return JSON with this shape:
{
  "title": "short roadmap title",
  "course_outline": "clean outline used",
  "source_type": "uploaded" | "generated" | "mixed",
  "topics": [
    {
      "title": "topic name",
      "summary": "what the student must master",
      "objectives": ["objective 1", "objective 2"],
      "source_refs": [{"file":"name", "page":"Page or chunk label", "note":"why this source matters"}],
      "estimated_minutes": 25
    }
  ]
}
Use 5 to 10 roadmap topics. Keep it practical and exam-focused.`,
  );

  const topics = Array.isArray(result.topics) ? result.topics.slice(0, 12) : [];
  return {
    title: (result.title || body.planTitle || "StudyBody roadmap").toString(),
    course_outline: (result.course_outline || body.courseOutline || "").toString(),
    source_type: ["uploaded", "generated", "mixed"].includes(result.source_type as string)
      ? result.source_type
      : body.courseOutline
        ? "mixed"
        : "generated",
    topics,
  };
}

async function generateQuestions(body: Body, deepSeekKey: string) {
  const type = body.questionType || "mcq";
  const count = Math.min(Math.max(body.count || 5, 1), 10);
  const result = await callDeepSeekJson(
    deepSeekKey,
    `You are StudyBody's question generator. Generate questions only from the selected uploaded file excerpts.
Return strict JSON only. Do not invent source references.`,
    `${profileBlock(body.profile)}

Topic:
${JSON.stringify(body.topic || {}, null, 2)}

Question type requested: ${type}
Number of questions: ${count}

Uploaded file excerpts:
${documentContext(body.documents)}

Return JSON:
{
  "questions": [
    {
      "type": "mcq" | "essay",
      "prompt": "question text",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct_answer": "A or ideal essay answer",
      "explanation": "source-grounded explanation",
      "rubric": ["point 1", "point 2"],
      "difficulty": "easy" | "medium" | "hard",
      "source_refs": [{"file":"name", "page":"Page or chunk label"}]
    }
  ]
}
For MCQ, provide exactly four options and one correct option id. For essay, options must be [].`,
  );

  const questions = Array.isArray(result.questions) ? result.questions.slice(0, count) : [];
  return { questions };
}

async function reviewAnswers(body: Body, deepSeekKey: string, openAIKey: string) {
  const grading = await callDeepSeekJson(
    deepSeekKey,
    `You are StudyBody's grading engine. Grade the student's answers against the supplied answer keys and rubrics.
DeepSeek does the scoring and correction analysis. Return strict JSON only.`,
    `${profileBlock(body.profile)}

Questions:
${JSON.stringify(body.questions || [], null, 2)}

Student answers:
${JSON.stringify(body.answers || {}, null, 2)}

Return JSON:
{
  "score": 0,
  "total": 0,
  "percentage": 0,
  "answers": [
    {
      "question_id": "id from question if present",
      "is_correct": true,
      "score": 1,
      "feedback": "specific correction",
      "missing_points": ["missing point"]
    }
  ],
  "weak_areas": ["topic weakness"],
  "next_steps": ["what to revise next"]
}`,
  );

  const coaching = await callOpenAIText(
    openAIKey,
    `You are StudyBody's final coach. You receive DeepSeek's structured grading only.
Explain results in the user's selected style. Do not add new facts beyond the grading data.`,
    `${profileBlock(body.profile)}
Mode: ${body.mode || "Simplified"}
DeepSeek grading:
${JSON.stringify(grading, null, 2)}

Write a concise review with: score, strongest area, weak area, corrected approach, and next study step.`,
  );

  return { grading, coaching };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Body;
    const deepSeekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const openAIKey = Deno.env.get("OPENAI_API_KEY");

    if (!deepSeekKey) return jsonResponse({ error: "DeepSeek API key not configured" }, 500);

    if (body.action === "generate_plan") {
      return jsonResponse(await generatePlan(body, deepSeekKey));
    }

    if (body.action === "generate_questions") {
      return jsonResponse(await generateQuestions(body, deepSeekKey));
    }

    if (body.action === "review_answers") {
      if (!openAIKey) return jsonResponse({ error: "OpenAI API key not configured" }, 500);
      return jsonResponse(await reviewAnswers(body, deepSeekKey, openAIKey));
    }

    return jsonResponse({ error: "Unknown StudyBody action" }, 400);
  } catch (e) {
    console.error("studybody error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
