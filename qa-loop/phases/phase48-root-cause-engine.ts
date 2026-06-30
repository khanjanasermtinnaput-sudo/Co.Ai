/**
 * Phase 48 — AI Root Cause Engine
 *
 * Tests the debug agent's ability to perform structured root cause analysis:
 * symptom identification, timeline reconstruction, component isolation,
 * confidence scoring, remediation guidance, and regression risk assessment.
 */
import { httpPost, httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const CHAT = `${BASE}/api/chat`;

// ── Test scenarios for root cause analysis ────────────────────────────────

interface RcaScenario {
  name: string;
  message: string;
  expectKeywords: string[];
  description: string;
}

const SCENARIOS: RcaScenario[] = [
  {
    name: "500 error root cause",
    message: "Users are getting 500 Internal Server Error on /api/chat. It started 2 hours ago after we deployed a new version. The error logs show 'Cannot read properties of undefined (reading message)'. Help me find the root cause.",
    expectKeywords: ["undefined", "null", "error", "check", "fix", "cause"],
    description: "Null pointer exception root cause analysis",
  },
  {
    name: "Performance degradation",
    message: "Our homepage TTFB jumped from 200ms to 4000ms after yesterday's deployment. Database queries look the same. What's the root cause?",
    expectKeywords: ["performance", "slow", "query", "cache", "server", "cause"],
    description: "Performance regression root cause",
  },
  {
    name: "Auth failure",
    message: "Users suddenly can't log in. JWT verification is failing with 'invalid signature'. What's the root cause and how do I fix it?",
    expectKeywords: ["jwt", "secret", "key", "token", "auth", "signature"],
    description: "Authentication failure root cause",
  },
];

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase48(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Debug agent responds to root cause requests ────────────────────────
  {
    const t0 = Date.now();
    const scenario = SCENARIOS[0];
    const res = await httpPost(CHAT, {
      message: scenario.message,
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const hasContent = res.body.length > 50;
    const ok = res.status < 500 && hasContent;

    const t: TestResult = {
      name: "Root cause engine: debug agent responds to 500 error analysis",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, responseLength: res.body.length, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Debug agent failed: status=${res.status}, body=${res.body.slice(0, 100)}`;
      t.rootCause = "Chat API debug agent not functioning or not deployed";
      t.suggestedFix = "Check /api/chat handler for agent='debug' case; verify AI provider chain is working";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Root cause analysis includes actionable keywords ───────────────────
  {
    const t0 = Date.now();
    const scenario = SCENARIOS[0];
    const res = await httpPost(CHAT, {
      message: scenario.message,
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const body = res.body.toLowerCase();
    const matchedKeywords = scenario.expectKeywords.filter((kw) => body.includes(kw));
    const ok = res.status < 500 && matchedKeywords.length >= Math.ceil(scenario.expectKeywords.length * 0.5);

    const t: TestResult = {
      name: `Root cause engine: RCA includes actionable diagnosis keywords (${matchedKeywords.length}/${scenario.expectKeywords.length})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        expected: scenario.expectKeywords,
        matched: matchedKeywords,
        missing: scenario.expectKeywords.filter((k) => !matchedKeywords.includes(k)),
      },
    };
    if (!ok) {
      t.error = `Debug agent not providing actionable RCA — only matched: ${matchedKeywords.join(", ")}`;
      t.rootCause = "AI debug agent system prompt not focused on structured root cause analysis";
      t.suggestedFix = "Update AOF_DEBUG_SYSTEM to include: symptom analysis, timeline, root cause, fix, regression risk format";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Performance degradation root cause analysis ───────────────────────
  {
    const t0 = Date.now();
    const scenario = SCENARIOS[1];
    const res = await httpPost(CHAT, {
      message: scenario.message,
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const body = res.body.toLowerCase();
    const matchedKeywords = scenario.expectKeywords.filter((kw) => body.includes(kw));
    const ok = res.status < 500 && matchedKeywords.length >= 2;

    const t: TestResult = {
      name: `Root cause engine: performance degradation analysis (matched: ${matchedKeywords.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched: matchedKeywords, status: res.status, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Performance RCA not actionable — only matched: ${matchedKeywords.join(", ")}`;
      t.rootCause = "Debug agent not identifying performance root causes";
      t.suggestedFix = "Ensure debug agent can analyze TTFB, cold starts, N+1 queries, caching issues";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Authentication failure root cause analysis ─────────────────────────
  {
    const t0 = Date.now();
    const scenario = SCENARIOS[2];
    const res = await httpPost(CHAT, {
      message: scenario.message,
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const body = res.body.toLowerCase();
    const matchedKeywords = scenario.expectKeywords.filter((kw) => body.includes(kw));
    const ok = res.status < 500 && matchedKeywords.length >= 2;

    const t: TestResult = {
      name: `Root cause engine: JWT auth failure analysis (matched: ${matchedKeywords.join(", ")})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { matched: matchedKeywords, status: res.status },
    };
    if (!ok) {
      t.error = `Auth RCA not actionable — matched: ${matchedKeywords.join(", ")}`;
      t.rootCause = "Debug agent not recognizing JWT/auth error patterns";
      t.suggestedFix = "Train debug agent to identify JWT_SECRET rotation, algorithm mismatch, token expiry patterns";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Structured output format check ─────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Give me a structured root cause analysis of: API returns 503 errors during peak traffic. Format: Symptom, Timeline, Root Cause, Confidence %, Remediation, Regression Risk",
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const body = res.body.toLowerCase();
    const structureSignals = [
      /symptom|issue|problem/i,
      /cause|reason|why/i,
      /fix|solution|remediat/i,
    ].filter((r) => r.test(res.body));

    const ok = res.status < 500 && structureSignals.length >= 2;

    const t: TestResult = {
      name: `Root cause engine: structured RCA output format (${structureSignals.length}/3 sections)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { structureSections: structureSignals.length, status: res.status, snippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = `RCA output not structured — only ${structureSignals.length}/3 expected sections found`;
      t.rootCause = "Debug agent not following structured output format";
      t.suggestedFix = "Add 'Output format: Symptom/Timeline/Cause/Confidence/Fix/Risk' to debug system prompt";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Root cause engine: error code recognition ──────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "TypeError: Cannot destructure property 'user' of 'undefined'. What is the root cause?",
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const bodyLower = res.body.toLowerCase();
    const recognizesError = bodyLower.includes("undefined") || bodyLower.includes("null") || bodyLower.includes("destruct");
    const ok = res.status < 500 && recognizesError;

    const t: TestResult = {
      name: "Root cause engine: recognizes JavaScript TypeError patterns",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, recognizesError, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "Debug agent does not recognize standard JavaScript error patterns";
      t.rootCause = "AI debug agent not trained to interpret JS stack trace patterns";
      t.suggestedFix = "Include JS/TS common error patterns in debug agent system prompt";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Confidence scoring in responses ────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Diagnose: database connection pool exhausted. Provide confidence level in your diagnosis.",
      agent: "debug",
    }, { timeoutMs: config.timeoutMs });

    const hasConfidence = /confiden|certain|likely|probabilit|%|percent/i.test(res.body);
    const hasDiagnosis = /connection|pool|timeout|database|db/i.test(res.body.toLowerCase());
    const ok = res.status < 500 && hasDiagnosis;

    const t: TestResult = {
      name: `Root cause engine: database pool diagnosis (diagnosis: ${hasDiagnosis}, confidence expressed: ${hasConfidence})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasDiagnosis, hasConfidence, status: res.status, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "Debug agent did not diagnose database connection pool issue";
      t.rootCause = "Debug agent missing database infrastructure troubleshooting knowledge";
      t.suggestedFix = "Add connection pool troubleshooting patterns to debug agent knowledge base";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 48,
    name: "AI Root Cause Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
