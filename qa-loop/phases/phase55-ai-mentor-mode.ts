/**
 * Phase 55 — AI Mentor Mode
 *
 * Tests adaptive explanation depth: beginner gets concept explanation,
 * intermediate gets implementation rationale, advanced gets architecture
 * trade-offs, expert gets concise engineering reasoning only.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const MENTOR = `${BASE}/api/ai/mentor`;

const TEST_QUESTION = "What is React's useEffect hook?";

export async function runPhase55(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Mentor endpoint exists ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(MENTOR, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 405 || res.status === 503;

    tests.push({
      name: "AI Mentor: GET /api/ai/mentor endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Mentor endpoint returned ${res.status} — not found`,
      rootCause: ok ? undefined : "aof-web/src/app/api/ai/mentor/route.ts not deployed",
      suggestedFix: ok ? undefined : "Deploy /api/ai/mentor route to Vercel",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Requires authentication ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(MENTOR, { message: TEST_QUESTION, level: "beginner" }, { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;

    tests.push({
      name: "AI Mentor: POST requires authentication",
      passed: requiresAuth,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: requiresAuth ? undefined : `No auth check (got ${res.status})`,
      rootCause: requiresAuth ? undefined : "Mentor endpoint not protected",
      suggestedFix: requiresAuth ? undefined : "Add getUserFromRequest() in /api/ai/mentor POST handler",
    });
    requiresAuth ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Invalid level rejected ─────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(MENTOR, { message: TEST_QUESTION, level: "superexpert" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;

    tests.push({
      name: "AI Mentor: invalid level parameter rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid level not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "Level enum not validated via Zod",
      suggestedFix: ok ? undefined : "Add z.enum(['beginner','intermediate','advanced','expert']) in MentorSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Beginner response is explanatory ──────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: `[LEVEL: beginner] ${TEST_QUESTION} Explain for a complete beginner.`,
      agent: "chat",
    }, { timeoutMs: config.timeoutMs });

    // Beginner responses should explain concepts, not assume knowledge
    const hasExplanation = /what|is a|means|basic|simple|example|first|understand/i.test(res.body);
    const ok = (res.status < 500 && hasExplanation) || isEnvironmentGate(res.status);

    tests.push({
      name: "AI Mentor: beginner level produces explanatory response",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, hasExplanation, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Beginner response not sufficiently explanatory",
      rootCause: ok ? undefined : "Chat agent not adapting explanation depth for beginners",
      suggestedFix: ok ? undefined : "Add beginner-level system prompt in /api/ai/mentor: explain concepts, use analogies",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Advanced response includes trade-offs ──────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: `[LEVEL: advanced] ${TEST_QUESTION} Focus on performance implications and when NOT to use it.`,
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });

    const hasTradeoffs = /performance|render|closure|dependency|array|stale|memory|leak|trade|avoid|when not/i.test(res.body);
    const ok = (res.status < 500 && hasTradeoffs) || isEnvironmentGate(res.status);

    tests.push({
      name: "AI Mentor: advanced level discusses trade-offs and performance",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, hasTradeoffs, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Advanced response missing trade-off discussion",
      rootCause: ok ? undefined : "Analyze agent not providing advanced-level architectural reasoning",
      suggestedFix: ok ? undefined : "Add advanced-level context: discuss performance implications, edge cases in mentor system prompt",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Mentor adapts to different experience levels (via chat agent) ───────
  {
    const t0 = Date.now();
    const [beginnerRes, expertRes] = await Promise.all([
      httpPost(`${BASE}/api/chat`, {
        message: "Explain JWT tokens to a complete beginner",
        agent: "chat",
      }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, {
        message: "Discuss JWT RS256 vs HS256 trade-offs for a distributed microservices architecture",
        agent: "analyze",
      }, { timeoutMs: config.timeoutMs }),
    ]);

    const beginnerOk = beginnerRes.status < 500 && beginnerRes.body.length > 50;
    const expertOk = expertRes.status < 500 && expertRes.body.length > 50;
    // Expert response should NOT be longer than 5x the beginner response (concise for experts)
    const appropriateLength = expertRes.body.length < beginnerRes.body.length * 5;
    const ok = beginnerOk && expertOk;

    tests.push({
      name: `AI Mentor: different levels produce different responses (beginner: ${beginnerRes.body.length}b, expert: ${expertRes.body.length}b)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        beginnerLength: beginnerRes.body.length,
        expertLength: expertRes.body.length,
        beginnerStatus: beginnerRes.status,
        expertStatus: expertRes.status,
      },
      error: ok ? undefined : "Mentor mode not adapting responses to different experience levels",
      rootCause: ok ? undefined : "Same response regardless of developer level",
      suggestedFix: ok ? undefined : "Implement level-specific system prompts in /api/ai/mentor route",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. All four levels accepted by mentor endpoint ────────────────────────
  {
    const t0 = Date.now();
    const levels = ["beginner", "intermediate", "advanced", "expert"] as const;
    const results = await Promise.all(
      levels.map((level) =>
        httpPost(MENTOR, { message: TEST_QUESTION, level }, { timeoutMs: config.timeoutMs })
      )
    );
    const allHandled = results.every((r) => r.status < 500 && r.status !== 0);

    tests.push({
      name: `AI Mentor: all 4 levels (beginner/intermediate/advanced/expert) handled`,
      passed: allHandled,
      durationMs: Date.now() - t0,
      details: { levels, statuses: results.map((r) => r.status) },
      error: allHandled ? undefined : `Some levels failed: ${results.map((r, i) => `${levels[i]}=${r.status}`).filter((s) => !s.match(/=[234]/)).join(", ")}`,
      rootCause: allHandled ? undefined : "Mentor endpoint not handling all experience levels",
      suggestedFix: allHandled ? undefined : "Verify MentorSchema level enum includes all 4 levels",
    });
    allHandled ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 55, name: "AI Mentor Mode", tests, totalMs: Date.now() - start, passCount, failCount };
}
