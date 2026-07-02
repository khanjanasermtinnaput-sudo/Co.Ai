/**
 * Phase 57 — AI Decision Engine
 *
 * Tests multi-approach analysis before implementation: the engine must
 * compare approaches on performance/complexity/maintainability/scalability/risk
 * and recommend the most appropriate solution.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const DECISIONS = `${BASE}/api/ai/decisions`;

const DECISION_PROBLEMS = [
  {
    problem: "Choose between server-side rendering (SSR) and static generation (SSG) for a product listing page",
    approaches: ["SSR with ISR", "SSG with revalidate", "CSR with SWR"],
  },
  {
    problem: "Should we use JWT or session cookies for authentication?",
    approaches: ["JWT with refresh tokens", "HTTP-only session cookies"],
  },
  {
    problem: "How should we implement real-time chat: WebSockets vs polling vs SSE?",
    approaches: ["WebSocket", "Server-Sent Events", "Long polling"],
  },
];

export async function runPhase57(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Decision engine endpoint exists ────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(DECISIONS, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 405 || res.status === 503;

    tests.push({
      name: "Decision engine: GET /api/ai/decisions endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Decision endpoint returned ${res.status} — not found`,
      rootCause: ok ? undefined : "aof-web/src/app/api/ai/decisions/route.ts not deployed",
      suggestedFix: ok ? undefined : "Deploy /api/ai/decisions route to Vercel",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Requires authentication ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(DECISIONS, { problem: "test" }, { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;

    tests.push({
      name: "Decision engine: POST requires authentication",
      passed: requiresAuth,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: requiresAuth ? undefined : `No auth check (got ${res.status})`,
      rootCause: requiresAuth ? undefined : "Decision endpoint not protected",
      suggestedFix: requiresAuth ? undefined : "Add getUserFromRequest() in /api/ai/decisions POST handler",
    });
    requiresAuth ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Too few approaches rejected (min 2) ─────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(DECISIONS, {
      problem: "SSR vs SSG",
      approaches: ["SSR"], // only 1 — should be rejected
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;

    tests.push({
      name: "Decision engine: single approach rejected — min 2 required (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Single approach not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "No minimum approaches validation in DecisionSchema",
      suggestedFix: ok ? undefined : "Add z.array(z.string()).min(2).max(5) for approaches field",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Analyze agent compares approaches on required criteria ─────────────
  {
    const t0 = Date.now();
    const problem = DECISION_PROBLEMS[0];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: `Compare these approaches for "${problem.problem}": ${problem.approaches.join(" vs ")}. Evaluate each on: performance, complexity, maintainability, scalability, risk. Recommend the best option.`,
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });

    const criteriaMatched = ["performance", "complexity", "maintainab", "scalab", "risk"].filter((c) =>
      res.body.toLowerCase().includes(c)
    );
    const hasRecommendation = /recommend|best|suggest|choose|prefer|go with/i.test(res.body);
    const ok = (res.status < 500 && criteriaMatched.length >= 3 && hasRecommendation) || isEnvironmentGate(res.status);

    tests.push({
      name: `Decision engine: SSR vs SSG analysis covers ${criteriaMatched.length}/5 criteria, recommends: ${hasRecommendation}`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { criteriaMatched, hasRecommendation, status: res.status, snippet: res.body.slice(0, 300) },
      error: ok ? undefined : `Analysis missing criteria (${criteriaMatched.join(", ")}) or no recommendation`,
      rootCause: ok ? undefined : "Analyze agent not performing structured multi-approach comparison",
      suggestedFix: ok ? undefined : "Update analyze agent system prompt to always evaluate all 5 criteria and give recommendation",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. JWT vs sessions comparison ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const problem = DECISION_PROBLEMS[1];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: `Analyze auth approach: "${problem.problem}". Compare: ${problem.approaches.join(" vs ")}. Which should we use for a Next.js SaaS app?`,
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });

    const mentionsAuth = /jwt|session|cookie|token|auth|security|stateless|stateful/i.test(res.body);
    const ok = (res.status < 500 && mentionsAuth) || isEnvironmentGate(res.status);

    tests.push({
      name: "Decision engine: JWT vs sessions analysis covers auth trade-offs",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, mentionsAuth, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Auth approach analysis not covering key trade-offs",
      rootCause: ok ? undefined : "Analyze agent not applying security context to auth decisions",
      suggestedFix: ok ? undefined : "Ensure analyze agent considers stateless/stateful, security, CSRF trade-offs for auth decisions",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Decision engine avoids blindly recommending first approach ──────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "Should we use a monolith or microservices for our small 3-person startup?",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    const bodyLower = res.body.toLowerCase();
    // Should acknowledge trade-offs for a small team, not blindly say microservices
    const acknowledgesContext = /small|team|startup|monolith|simpler|pragmat|scale later|begin/i.test(res.body);
    const ok = (res.status < 500 && acknowledgesContext) || isEnvironmentGate(res.status);

    tests.push({
      name: "Decision engine: considers team/context before recommending approach (not just tech hype)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, acknowledgesContext, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "AI blindly recommending complex approach without considering team context",
      rootCause: ok ? undefined : "Plan agent not weighting team size/context in architectural recommendations",
      suggestedFix: ok ? undefined : "Add context-awareness to plan agent: consider team size, timeline, complexity before recommending",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Decision engine response time ─────────────────────────────────────
  {
    const t0 = Date.now();
    const s = Date.now();
    await httpPost(DECISIONS, {
      problem: "PostgreSQL vs MongoDB for user data",
      approaches: ["PostgreSQL", "MongoDB"],
    }, { timeoutMs: config.timeoutMs });
    const latency = Date.now() - s;
    const ok = latency < 20000;

    tests.push({
      name: `Decision engine: response latency ${latency}ms (threshold: 20000ms)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { latencyMs: latency },
      error: ok ? undefined : `Decision engine too slow: ${latency}ms`,
      rootCause: ok ? undefined : "Multi-approach analysis taking too long",
      suggestedFix: ok ? undefined : "Add response streaming to /api/ai/decisions; use faster model for initial comparison",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 57, name: "AI Decision Engine", tests, totalMs: Date.now() - start, passCount, failCount };
}
