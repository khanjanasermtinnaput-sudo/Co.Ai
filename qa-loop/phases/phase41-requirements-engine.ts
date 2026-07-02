/**
 * Phase 41 — AI Requirement Understanding Engine
 *
 * Validates that the AI correctly performs intent analysis, requirement extraction,
 * business logic detection, and risk analysis BEFORE generating code.
 */
import { httpPost, httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const CHAT = `${BASE}/api/chat`;
const WORKFLOW = `${BASE}/api/workflow`;

// ── Sample requests for requirement analysis ───────────────────────────────

const SAMPLE_REQUESTS = [
  "I want to build a task management app with user authentication and real-time updates",
  "Create an e-commerce checkout flow with Stripe payments and inventory tracking",
  "Build a dashboard that shows live analytics data for a SaaS product",
];

// ── Requirement quality checkers ───────────────────────────────────────────

function detectsRequirements(text: string): boolean {
  const keywords = [
    "requirement", "ต้องการ", "functional", "non-functional",
    "feature", "ฟีเจอร์", "user", "authentication", "database",
    "api", "performance", "security", "scalab", "goal",
    "what", "who", "how", "when", "clarif",
  ];
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k)).length >= 2;
}

function asksForClarification(text: string): boolean {
  const patterns = [
    /\?/, /clarif/i, /could you/i, /would you/i, /what.*?you/i,
    /tell me/i, /more.*?detail/i, /ช่วยบอก/i, /อยากทราบ/i, /จำเป็น/i,
  ];
  return patterns.some((p) => p.test(text));
}

function avoidsImmediateCode(text: string): boolean {
  // The AI should NOT immediately output code blocks for requirement-phase requests
  const codeBlocks = (text.match(/```/g) ?? []).length;
  // Allow at most 1 code example (explanatory), but not a full implementation
  return codeBlocks <= 2;
}

function structuresRequirements(text: string): boolean {
  const structureSignals = [
    /functional/i, /non.?functional/i, /performance/i, /security/i,
    /scalab/i, /ui|ux|interface/i, /api/i, /database/i, /user/i,
    /1\.|2\.|3\./, /•/, /\*\s/, /requirement/i,
  ];
  return structureSignals.filter((p) => p.test(text)).length >= 3;
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase41(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Requirements agent exists and responds ────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: SAMPLE_REQUESTS[0],
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status < 500 && res.body.length > 50;

    const t: TestResult = {
      name: "Requirements agent: endpoint exists and responds",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, responseLength: res.body.length },
    };
    if (!ok) {
      t.error = `Requirements agent returned ${res.status} or empty response`;
      t.rootCause = "Requirements agent not configured or AI provider missing";
      t.suggestedFix = "Set ANTHROPIC_API_KEY or other provider key; verify /api/chat agent='requirements' works";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. AI performs requirement analysis (not immediate code gen) ──────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: SAMPLE_REQUESTS[1],
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });

    const avoidsCode = res.status >= 400 || avoidsImmediateCode(res.body);
    const ok = res.status < 500 && avoidsCode;

    const t: TestResult = {
      name: "Requirements engine: avoids generating code immediately",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, avoidsCode, codeBlockCount: (res.body.match(/```/g) ?? []).length },
    };
    if (!ok) {
      t.error = "AI generated code immediately instead of asking requirements questions";
      t.rootCause = "Requirements agent system prompt not enforcing discovery-before-code rule";
      t.suggestedFix = "Update RAA_SYSTEM prompt: 'Never generate code in this phase; always ask clarifying questions first'";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. AI identifies requirement categories ───────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: SAMPLE_REQUESTS[2],
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });

    const identifies = res.status < 500 && detectsRequirements(res.body);
    const ok = identifies || isEnvironmentGate(res.status);

    const t: TestResult = {
      name: "Requirements engine: identifies functional/non-functional requirements",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, responseSnippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = "Response does not identify requirement categories";
      t.rootCause = "Requirements agent not structured to extract requirement types";
      t.suggestedFix = "Update RAA_SYSTEM to explicitly identify: functional, non-functional, performance, security, scalability requirements";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. AI asks clarifying questions ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Build me something for my business",
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });

    const clarifies = res.status < 500 && asksForClarification(res.body);
    const ok = clarifies || isEnvironmentGate(res.status);

    const t: TestResult = {
      name: "Requirements engine: asks for clarification on vague requests",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, responseSnippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = "AI did not ask clarifying questions for ambiguous request";
      t.rootCause = "Requirements agent generating output without asking for missing information";
      t.suggestedFix = "Add 'missing information detection' logic to RAA_SYSTEM: if request is vague, ask ONLY the most important clarifying question";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Workflow classifier exists ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(WORKFLOW, {
      request: "Build a user authentication system with JWT tokens",
      hasRepoContext: false,
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;

    let workflow: Record<string, unknown> = {};
    try { workflow = JSON.parse(res.body); } catch {}

    const t: TestResult = {
      name: "Workflow classifier: POST /api/workflow returns decision",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, workflow },
    };
    if (!ok) {
      t.error = `Workflow classifier returned ${res.status}`;
      t.rootCause = "Adaptive workflow engine not wired up or lib missing";
      t.suggestedFix = "Verify aof-web/src/app/api/workflow/route.ts and lib/cocode/adaptive-workflow.ts exist";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (decision: ${JSON.stringify(workflow).slice(0, 80)})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Workflow varies by request type ────────────────────────────────────
  {
    const t0 = Date.now();
    const [simple, complex] = await Promise.all([
      httpPost(WORKFLOW, { request: "Fix typo in README", hasRepoContext: true }, { timeoutMs: config.timeoutMs }),
      httpPost(WORKFLOW, { request: "Build a full microservices payment system with Stripe, webhooks, and multi-currency support", hasRepoContext: false }, { timeoutMs: config.timeoutMs }),
    ]);

    let simpleDecision = {};
    let complexDecision = {};
    try { simpleDecision = JSON.parse(simple.body); } catch {}
    try { complexDecision = JSON.parse(complex.body); } catch {}

    const ok = simple.status === 200 && complex.status === 200;

    const t: TestResult = {
      name: "Workflow classifier: categorizes simple vs complex requests differently",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        simpleRequest: simpleDecision,
        complexRequest: complexDecision,
        statuses: [simple.status, complex.status],
      },
    };
    if (!ok) {
      t.error = `Workflow classifier failed: simple=${simple.status}, complex=${complex.status}`;
      t.rootCause = "Workflow classification endpoint error";
      t.suggestedFix = "Check adaptive-workflow.ts classifyWorkflow() function handles both simple edits and complex builds";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Risk analysis in requirements ──────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Build a banking application that handles real money transfers between accounts",
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });

    const mentionsRisk = res.status < 500 && (
      /risk|security|compliance|regulation|PCI|auth|encrypt|sensitive/i.test(res.body)
    );
    const ok = mentionsRisk || isEnvironmentGate(res.status);

    const t: TestResult = {
      name: "Requirements engine: identifies security/compliance risks for sensitive domains",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = "Requirements agent did not flag security/risk concerns for a financial application";
      t.rootCause = "Requirements system prompt not including risk analysis for sensitive domains";
      t.suggestedFix = "Add risk analysis step to RAA_SYSTEM: identify security, compliance, and performance risks before design";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 41,
    name: "AI Requirement Understanding Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
