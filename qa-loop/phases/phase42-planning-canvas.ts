/**
 * Phase 42 — AI Planning Canvas
 *
 * Validates that large tasks begin with a structured planning document:
 * milestones, architecture, task breakdown, timeline, risk analysis, and
 * acceptance criteria — before any implementation begins.
 */
import { httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const CHAT = `${BASE}/api/chat`;

// ── Plan quality scorers ───────────────────────────────────────────────────

function scoresPlanStructure(text: string): { score: number; found: string[] } {
  const components = [
    { key: "goal",        pattern: /goal|objective|aim|purpose|ต้องการ/i },
    { key: "milestone",   pattern: /milestone|phase|stage|sprint|ขั้น/i },
    { key: "architecture",pattern: /architect|structure|component|layer|stack|tech/i },
    { key: "tasks",       pattern: /task|step|subtask|todo|implement|build/i },
    { key: "timeline",    pattern: /timeline|week|day|schedule|deadline|เวลา/i },
    { key: "risk",        pattern: /risk|challenge|issue|concern|problem|ความเสี่ยง/i },
    { key: "acceptance",  pattern: /acceptance|criteri|success|done|definition|เกณฑ์/i },
    { key: "dependency",  pattern: /depend|require|prerequisit|before|need/i },
  ];

  const found = components.filter((c) => c.pattern.test(text)).map((c) => c.key);
  return { score: found.length / components.length, found };
}

function isStructured(text: string): boolean {
  // Check for markdown structure (headers, lists, numbered items)
  const hasHeaders = /^#{1,3}\s/m.test(text);
  const hasLists = /^[-*]\s/m.test(text) || /^\d+\.\s/m.test(text);
  return hasHeaders || hasLists;
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase42(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Plan agent responds ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Create a plan for building a full-stack e-commerce platform with Next.js, Supabase, and Stripe",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status < 500 && res.body.length > 100;

    const t: TestResult = {
      name: "Planning canvas: plan agent responds with content",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, length: res.body.length },
    };
    if (!ok) {
      t.error = `Plan agent returned ${res.status} or empty`;
      t.rootCause = "Plan agent or AI provider not configured";
      t.suggestedFix = "Set AI provider keys; verify agent: 'plan' in /api/chat route handler";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Plan contains required components ─────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Plan a mobile-first social media dashboard with real-time notifications, user profiles, and content feed",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    const { score, found } = res.status < 500 ? scoresPlanStructure(res.body) : { score: 0, found: [] };
    const ok = res.status < 500 && score >= 0.5; // At least 4 of 8 components

    const t: TestResult = {
      name: `Planning canvas: plan contains ≥50% required components (got ${Math.round(score * 100)}%)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { score, found, missing: ["goal","milestone","architecture","tasks","timeline","risk","acceptance","dependency"].filter((k) => !found.includes(k)) },
    };
    if (!ok) {
      t.error = `Plan only covers ${Math.round(score * 100)}% of required structure — missing: ${["goal","milestone","architecture","tasks","timeline","risk","acceptance","dependency"].filter((k) => !found.includes(k)).join(", ")}`;
      t.rootCause = "AOF_PLAN_SYSTEM prompt not structured to cover all planning canvas sections";
      t.suggestedFix = "Update AOF_PLAN_SYSTEM to always include: Goal, Milestones, Architecture, Tasks, Timeline, Risks, Acceptance Criteria, Dependencies";
    }
    tests.push(t);
    ok ? log.ok(`${t.name}: ${found.join(", ")}`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Plan is structured (uses markdown) ────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Create a technical implementation plan for a multi-tenant SaaS billing system",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    const structured = res.status < 500 && isStructured(res.body);
    const ok = structured;

    const t: TestResult = {
      name: "Planning canvas: plan uses structured markdown (headers + lists)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasHeaders: /^#{1,3}\s/m.test(res.body), hasLists: /^[-*]\s/m.test(res.body) || /^\d+\.\s/m.test(res.body) },
    };
    if (!ok) {
      t.error = "Plan is unstructured — no markdown headers or lists";
      t.rootCause = "Plan agent not formatting output as structured document";
      t.suggestedFix = "Update AOF_PLAN_SYSTEM: 'Always use markdown headers (##) and bullet lists; structure as a proper planning document'";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Plan includes complexity estimate ──────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Plan building a Slack-like real-time messaging platform with channels, threads, and file sharing",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    const estimatesComplexity = res.status < 500 && (
      /complex|simple|medium|hard|small|large|hours|days|weeks|effort|estimate|sprint|ซับซ้อน|ง่าย|ยาก/i.test(res.body)
    );
    const ok = estimatesComplexity;

    const t: TestResult = {
      name: "Planning canvas: plan estimates complexity/effort",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { estimatesComplexity, snippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = "Plan does not estimate complexity or effort";
      t.rootCause = "Plan agent not trained to estimate project complexity";
      t.suggestedFix = "Add 'Estimated Complexity' section to AOF_PLAN_SYSTEM output format";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Plan specifies acceptance criteria ─────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Plan a user authentication system with OAuth2, 2FA, and role-based permissions",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    const hasAcceptanceCriteria = res.status < 500 && (
      /acceptance|success criteri|definition of done|done when|must pass|should work|verif/i.test(res.body)
    );
    const ok = hasAcceptanceCriteria;

    const t: TestResult = {
      name: "Planning canvas: plan defines acceptance criteria",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasAcceptanceCriteria, snippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = "Plan does not define acceptance criteria";
      t.rootCause = "Missing acceptance criteria section in plan agent system prompt";
      t.suggestedFix = "Add 'Acceptance Criteria' section to AOF_PLAN_SYSTEM: what must be true for the feature to be considered complete";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Plan decomposes into subtasks ──────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Plan a CI/CD pipeline with automated testing, staging deployment, and production rollout",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    // Count distinct task items (numbered or bullet)
    const taskItems = (res.body.match(/^\s*[-*\d]+[.)]\s/gm) ?? []).length;
    const hasEnoughTasks = taskItems >= 3;
    const ok = res.status < 500 && hasEnoughTasks;

    const t: TestResult = {
      name: `Planning canvas: task breakdown has ≥3 concrete subtasks (got ${taskItems})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { taskItems, snippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = `Only ${taskItems} task items found — need ≥3 for actionable breakdown`;
      t.rootCause = "Plan agent not decomposing project into concrete subtasks";
      t.suggestedFix = "Update AOF_PLAN_SYSTEM to always break the project into at least 3-5 numbered implementation phases";
    }
    tests.push(t);
    ok ? log.ok(`${t.name}`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Analyze agent exists for codebase analysis ────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(CHAT, {
      message: "Analyze the architecture of a Next.js app with Supabase. What are the main considerations?",
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status < 500 && res.body.length > 50;

    const t: TestResult = {
      name: "Planning canvas: analyze agent works for architecture review",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, length: res.body.length },
    };
    if (!ok) {
      t.error = `Analyze agent returned ${res.status} or empty`;
      t.rootCause = "Analyze agent not configured or AI provider missing";
      t.suggestedFix = "Verify AOF_ANALYZE_SYSTEM in raa.ts; check /api/chat with agent='analyze'";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 42,
    name: "AI Planning Canvas",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
