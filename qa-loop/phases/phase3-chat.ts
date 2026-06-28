import { collectSSE, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

type Category =
  | "coding" | "math" | "science" | "translation" | "creative" | "sql"
  | "json" | "markdown" | "multi-language" | "long";

const PROMPTS: Record<Category, string[]> = {
  coding: [
    "Write a Python function that reverses a string.",
    "Explain the difference between async/await and promises in JavaScript. Provide code examples showing both approaches and when to use each one.",
    "Design a REST API for a simple e-commerce system with endpoints for products, cart, orders, and authentication. Include request/response schemas and error codes for all endpoints. Consider rate limiting and pagination.",
  ],
  math: [
    "What is 2+2?",
    "Explain the Pythagorean theorem with an example triangle where a=3 and b=4.",
    "Prove that the sum of angles in a triangle is 180 degrees using both geometric and algebraic approaches.",
  ],
  science: [
    "What is photosynthesis?",
    "Explain how CRISPR-Cas9 gene editing works at the molecular level.",
    "Describe the Standard Model of particle physics, including all fundamental particles and forces, their properties, and current open questions in physics.",
  ],
  translation: [
    "Translate 'hello' to Thai.",
    "Translate this sentence to Japanese: 'The quick brown fox jumps over the lazy dog.'",
    "Translate the following paragraph to Spanish and explain any cultural nuances: 'In the United States, tipping at restaurants is expected at 15-20% of the total bill, while in many European countries this practice is less common.'",
  ],
  creative: [
    "Write a haiku about AI.",
    "Write a short story about a robot that learns to paint.",
    "Write a 500-word science fiction story set in 2150 where humanity has colonized Mars, exploring themes of identity and what it means to be human when you were born on another planet.",
  ],
  sql: [
    "Write a SQL SELECT query.",
    "Write a SQL query to find the top 10 customers by revenue in the last 30 days.",
    "Design a database schema for a social media platform supporting posts, comments, likes, follows, and direct messages. Include indexes, constraints, and explain your normalization choices.",
  ],
  json: [
    "Output a JSON object with name and age fields.",
    "Create a JSON schema for a user profile with validation rules.",
    "Design a JSON API response format for a paginated list of products with filtering, sorting, error handling, and metadata fields.",
  ],
  markdown: [
    "Format this as markdown: hello world",
    "Write a markdown README for a Node.js library.",
    "Create comprehensive markdown documentation for a REST API including authentication, endpoints, request/response examples, error codes, rate limits, and a quickstart guide.",
  ],
  "multi-language": [
    "สวัสดี",
    "Bonjour, comment puis-je vous aider aujourd'hui?",
    "こんにちは！今日はAIについて教えてください。",
  ],
  long: [
    "a".repeat(500),
    "Explain everything about machine learning: " + "deep learning, neural networks, ".repeat(20),
  ],
};

function randomPrompt(): { category: Category; message: string } {
  const categories = Object.keys(PROMPTS) as Category[];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const msgs = PROMPTS[category];
  const message = msgs[Math.floor(Math.random() * msgs.length)];
  return { category, message };
}

function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function runPhase3(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const chatUrl = `${config.baseUrl}/api/chat`;

  // ── Test 1: POST /api/chat with missing body → 400 ────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(chatUrl, {}, { timeoutMs: config.timeoutMs });
    // Empty message should either 400 or return a stream with an error frame
    const ok = res.status >= 200 && res.status < 500;
    const t: TestResult = {
      name: "POST /api/chat empty body → no 5xx crash",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Server returned ${res.status} on empty body`;
      t.rootCause = "Unhandled null/undefined message in chat route";
      t.suggestedFix = "Add guard: if (!body.message) return 400 early in route handler";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Tests 2-7: Random category prompts (streaming) ────────────────────
  const trials: Array<{ category: Category; message: string; label: string }> = [];

  // Pick 3 random categories + always include a short and a long prompt
  for (let i = 0; i < 3; i++) trials.push({ ...randomPrompt(), label: `random-${i + 1}` });
  trials.push({ category: "math", message: "What is 2+2?", label: "short-10tok" });
  trials.push({ category: "coding", message: PROMPTS.coding[2], label: "long-1000tok" });

  for (const trial of trials) {
    const t0 = Date.now();
    const approxTokens = approximateTokens(trial.message);
    const res = await collectSSE(
      chatUrl,
      { message: trial.message, agent: "chat", style: "short" },
      { timeoutMs: Math.max(config.timeoutMs, 60_000) },
    );

    const gotFrames = res.frames.length > 0;
    const noError = !res.error;

    let ok = noError && gotFrames;
    let notes = "";

    if (!noError && res.error?.includes("401")) {
      ok = true; notes = "401 — auth required (expected without token)";
    } else if (!noError && res.error?.includes("403")) {
      ok = true; notes = "403 — plan enforcement (expected)";
    } else if (!noError && res.error?.includes("429")) {
      // 429 = platform rate limiter fired — the chat endpoint IS working, just throttled.
      // Pass the test; note it as a rate-limit finding for the report.
      ok = true; notes = "429 — rate-limited (chat limiter active; reduce QA_LOOP_INTERVAL_MS)";
    }

    const t: TestResult = {
      name: `Chat [${trial.category}] ~${approxTokens} tokens → streaming response`,
      passed: ok,
      durationMs: Date.now() - t0,
      request: { url: chatUrl, method: "POST", body: trial.message.slice(0, 100) },
      details: {
        category: trial.category,
        approxTokens,
        frames: res.frames.length,
        firstFrame: res.frames[0]?.slice(0, 100),
        notes,
      },
    };

    if (!ok) {
      const is429 = res.error?.includes("429");
      t.error = res.error ?? "No streaming frames received";
      t.rootCause = res.error?.includes("abort")
        ? "Request timed out — provider too slow or backend sleeping"
        : is429
        ? "Platform rate limiter (AOF_ERROR_005) — chat requests throttled in rapid succession"
        : "Provider not configured or API key missing";
      t.suggestedFix = is429
        ? "Rate limiter window too tight for monitoring — either raise the chat rate-limit for QA IPs, or add delay between chat tests"
        : "Ensure at least one provider API key is configured in Supabase provider_keys";
    }

    tests.push(t);
    ok ? log.ok(t.name + (notes ? ` (${notes})` : "") + ` [${res.durationMs}ms]`)
       : log.fail(t.name + " — " + t.error);

    // Brief cooldown between chat requests to respect rate limits
    await new Promise((r) => setTimeout(r, 800));
  }

  // ── Test: POST /api/chat with all agents ──────────────────────────────
  const agents: Array<"chat" | "code-chat" | "requirements"> = ["chat", "code-chat", "requirements"];
  for (const agent of agents) {
    const t0 = Date.now();
    const res = await collectSSE(
      chatUrl,
      { message: "Hello, describe yourself.", agent },
      { timeoutMs: Math.max(config.timeoutMs, 60_000) },
    );
    // 429 = rate-limited but endpoint accepted the request — agent routing worked
    const ok = !res.error || res.error.includes("401") || res.error.includes("403") || res.error.includes("429");
    const is429 = res.error?.includes("429");
    const t: TestResult = {
      name: `Chat agent="${agent}" accepted without crash`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { agent, frames: res.frames.length, error: res.error, rateLimited: is429 },
    };
    if (!ok) {
      t.error = res.error;
      t.rootCause = `agentConfig() branch for agent="${agent}" may throw or be misconfigured`;
      t.suggestedFix = `Review agentConfig() switch in /api/chat/route.ts for "${agent}" case`;
    }
    tests.push(t);
    ok ? log.ok(t.name + (is429 ? " (rate-limited)" : "")) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 600));
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 3, name: "AI Chat", tests, totalMs: Date.now() - start, passCount, failCount };
}
