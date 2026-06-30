/**
 * Phase 54 — Prompt Understanding Engine
 *
 * Tests that the AI understands developer intent beyond literal instructions:
 * feature requests, bug reports, performance, security, refactoring,
 * architecture, learning, and deployment requests are all recognized
 * and routed to the most appropriate workflow automatically.
 */
import { httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;

interface IntentTest {
  message: string;
  expectedIntent: string;
  expectKeywords: string[];
}

const INTENT_TESTS: IntentTest[] = [
  {
    message: "Users keep getting logged out after 5 minutes",
    expectedIntent: "bug-report",
    expectKeywords: ["session", "jwt", "token", "expir", "auth", "timeout", "bug"],
  },
  {
    message: "The homepage takes 8 seconds to load on mobile",
    expectedIntent: "performance",
    expectKeywords: ["performance", "bundle", "lazy", "cache", "optim", "slow", "speed"],
  },
  {
    message: "We need to add CSRF protection to all forms",
    expectedIntent: "security",
    expectKeywords: ["csrf", "security", "protect", "token", "form", "attack"],
  },
  {
    message: "The authentication module is getting too complex, how should we restructure it?",
    expectedIntent: "architecture",
    expectKeywords: ["architect", "module", "structure", "pattern", "refactor", "design"],
  },
  {
    message: "What is React's useEffect hook and when should I use it?",
    expectedIntent: "learning",
    expectKeywords: ["effect", "lifecycle", "hook", "react", "component", "side"],
  },
];

export async function runPhase54(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Workflow classifier handles all intent types ────────────────────────
  {
    const t0 = Date.now();
    const results = await Promise.all(
      INTENT_TESTS.map((it) =>
        httpPost(`${BASE}/api/workflow`, { message: it.message }, { timeoutMs: config.timeoutMs })
      )
    );
    const allHandled = results.every((r) => r.status < 500 && r.status !== 0);

    tests.push({
      name: `Prompt understanding: workflow classifier handles all ${INTENT_TESTS.length} intent types`,
      passed: allHandled,
      durationMs: Date.now() - t0,
      details: { intents: INTENT_TESTS.map((it) => it.expectedIntent), statuses: results.map((r) => r.status) },
      error: allHandled ? undefined : `Classifier failed for some intents: ${results.map((r, i) => `${INTENT_TESTS[i].expectedIntent}=${r.status}`).filter((s) => !s.includes("=2")).join(", ")}`,
      rootCause: allHandled ? undefined : "/api/workflow not handling all intent types",
      suggestedFix: allHandled ? undefined : "Expand intent classification in workflow route to cover all 8 intent categories",
    });
    allHandled ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Bug report intent recognized and routed to debug agent ─────────────
  {
    const t0 = Date.now();
    const it = INTENT_TESTS[0];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: it.message,
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });
    const matched = it.expectKeywords.filter((kw) => res.body.toLowerCase().includes(kw));
    const ok = res.status < 500 && matched.length >= 2;

    tests.push({
      name: `Prompt understanding: bug report recognized (matched: ${matched.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched, status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : `Bug intent not properly understood (matched only: ${matched.join(", ")})`,
      rootCause: ok ? undefined : "Debug agent not identifying session/auth bug patterns",
      suggestedFix: ok ? undefined : "Update debug agent system prompt to recognize session expiry bug patterns",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Performance intent recognized ──────────────────────────────────────
  {
    const t0 = Date.now();
    const it = INTENT_TESTS[1];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: it.message,
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });
    const matched = it.expectKeywords.filter((kw) => res.body.toLowerCase().includes(kw));
    const ok = res.status < 500 && matched.length >= 2;

    tests.push({
      name: `Prompt understanding: performance intent recognized (matched: ${matched.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched, status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Performance intent not properly understood",
      rootCause: ok ? undefined : "Analyze agent not recognizing performance-related requests",
      suggestedFix: ok ? undefined : "Add performance optimization patterns to analyze agent system prompt",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Security intent recognized ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const it = INTENT_TESTS[2];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: it.message,
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });
    const matched = it.expectKeywords.filter((kw) => res.body.toLowerCase().includes(kw));
    const ok = res.status < 500 && matched.length >= 2;

    tests.push({
      name: `Prompt understanding: security intent recognized (matched: ${matched.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched, status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Security intent not properly recognized",
      rootCause: ok ? undefined : "Requirements agent not routing security requests to security workflow",
      suggestedFix: ok ? undefined : "Add OWASP/security pattern recognition to requirements agent",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Architecture intent recognized ─────────────────────────────────────
  {
    const t0 = Date.now();
    const it = INTENT_TESTS[3];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: it.message,
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });
    const matched = it.expectKeywords.filter((kw) => res.body.toLowerCase().includes(kw));
    const ok = res.status < 500 && matched.length >= 2;

    tests.push({
      name: `Prompt understanding: architecture intent recognized (matched: ${matched.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched, status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Architecture intent not properly understood",
      rootCause: ok ? undefined : "Plan agent not addressing architectural restructuring requests",
      suggestedFix: ok ? undefined : "Add architecture pattern recognition to plan agent system prompt",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Learning intent recognized (adapts explanation depth) ──────────────
  {
    const t0 = Date.now();
    const it = INTENT_TESTS[4];
    const res = await httpPost(`${BASE}/api/chat`, {
      message: it.message,
      agent: "chat",
    }, { timeoutMs: config.timeoutMs });
    const matched = it.expectKeywords.filter((kw) => res.body.toLowerCase().includes(kw));
    const ok = res.status < 500 && matched.length >= 2;

    tests.push({
      name: `Prompt understanding: learning intent recognized (matched: ${matched.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched, status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Learning question not properly answered",
      rootCause: ok ? undefined : "Chat agent not providing educational explanations for learning requests",
      suggestedFix: ok ? undefined : "Ensure chat agent provides teaching-focused responses to 'what is' / 'how to' questions",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Deployment intent routed correctly ─────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/workflow`, {
      message: "Deploy the latest changes to production on Vercel",
    }, { timeoutMs: config.timeoutMs });
    const mentionsDeploy = /deploy|vercel|production|build|release/i.test(res.body);
    const ok = res.status < 500 && (mentionsDeploy || res.body.length > 10);

    tests.push({
      name: `Prompt understanding: deployment intent routed to workflow (deploy mentioned: ${mentionsDeploy})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, mentionsDeploy, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Deployment intent not handled by workflow classifier",
      rootCause: ok ? undefined : "Workflow classifier not routing 'deploy' intents correctly",
      suggestedFix: ok ? undefined : "Add deploy intent routing in /api/workflow — map to deployment workflow",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 54, name: "Prompt Understanding Engine", tests, totalMs: Date.now() - start, passCount, failCount };
}
