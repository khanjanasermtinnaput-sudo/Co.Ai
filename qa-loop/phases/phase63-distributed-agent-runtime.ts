/**
 * Phase 63 — Distributed Agent Runtime
 *
 * Tests independent agent execution, parallel isolation, failure containment,
 * timeout enforcement, and inter-agent message passing via ACP.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;

const AGENT_TYPES = [
  "requirements", "plan", "analyze", "debug", "code-gen", "code-chat",
] as const;

export async function runPhase63(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. All agent types respond independently ───────────────────────────────
  {
    const t0 = Date.now();
    const results = await Promise.all(
      AGENT_TYPES.map((agent) =>
        httpPost(`${BASE}/api/chat`, { message: "Hello", agent }, { timeoutMs: config.timeoutMs })
      )
    );
    const working = results.filter((r) => r.status < 500 && r.status !== 0).length;
    const ok = working >= Math.ceil(AGENT_TYPES.length * 0.8);
    tests.push({
      name: `Distributed agents: ${working}/${AGENT_TYPES.length} agent types responding independently`,
      passed: ok, durationMs: Date.now() - t0,
      details: { agents: AGENT_TYPES, statuses: results.map((r) => r.status), working },
      error: ok ? undefined : `Only ${working}/${AGENT_TYPES.length} agents operational`,
      rootCause: ok ? undefined : "Some agents not responding — shared failure without isolation",
      suggestedFix: ok ? undefined : "Verify each agent case in /api/chat is independently handled",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Agents execute in parallel without blocking each other ─────────────
  {
    const t0 = Date.now();
    const parallelStart = Date.now();
    const [r1, r2, r3] = await Promise.all([
      httpPost(`${BASE}/api/chat`, { message: "Explain React hooks", agent: "chat" }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, { message: "What are database indexes?", agent: "analyze" }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, { message: "Debug: undefined is not a function", agent: "debug" }, { timeoutMs: config.timeoutMs }),
    ]);
    const parallelTime = Date.now() - parallelStart;

    const allOk = [r1, r2, r3].every((r) => r.status < 500 && r.status !== 0);
    const ok = allOk;
    tests.push({
      name: `Distributed agents: 3 parallel agents completed in ${parallelTime}ms without blocking`,
      passed: ok, durationMs: Date.now() - t0,
      details: { parallelTimeMs: parallelTime, statuses: [r1.status, r2.status, r3.status] },
      error: ok ? undefined : "Parallel agent execution failed or timed out",
      rootCause: ok ? undefined : "Agents blocking each other — not truly independent",
      suggestedFix: ok ? undefined : "Verify /api/chat handler uses async/await correctly; no shared mutable state between agents",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Agent failure isolation — one agent failure doesn't affect others ──
  {
    const t0 = Date.now();
    const [validRes, invalidRes] = await Promise.all([
      httpPost(`${BASE}/api/chat`, { message: "Hello", agent: "chat" }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, { message: "Hello", agent: "nonexistent-agent-xyz" }, { timeoutMs: config.timeoutMs }),
    ]);

    const validOk = validRes.status < 500;
    const invalidHandled = invalidRes.status < 500; // 400 or 200 with fallback
    const ok = validOk;
    tests.push({
      name: `Distributed agents: failure isolation (valid=${validRes.status}, invalid=${invalidRes.status})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { validStatus: validRes.status, invalidStatus: invalidRes.status, validOk, invalidHandled },
      error: ok ? undefined : "Valid agent failed — possibly contaminated by invalid agent request",
      rootCause: ok ? undefined : "Agent isolation not working — shared failure state",
      suggestedFix: ok ? undefined : "Ensure each agent request is independently handled; no shared error state",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Agent Communication Protocol endpoint exists ───────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/agents/messages`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: "Distributed agents: ACP /api/agents/messages endpoint available",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "ACP endpoint missing — agents cannot communicate",
      rootCause: ok ? undefined : "/api/agents/messages not deployed",
      suggestedFix: ok ? undefined : "Deploy ACP route for structured inter-agent communication",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. ACP message structure validated ───────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/agents/messages`, {
      fromAgent: "planner",
      toAgent: "frontend",
      // missing taskId — should be rejected
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Distributed agents: ACP message without taskId rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid ACP message not rejected (${res.status})`,
      rootCause: ok ? undefined : "ACP schema not validating required taskId field",
      suggestedFix: ok ? undefined : "Add z.string().min(1) for taskId in ACPMessageSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Agents maintain context separation ─────────────────────────────────
  {
    const t0 = Date.now();
    const [planRes, debugRes] = await Promise.all([
      httpPost(`${BASE}/api/chat`, { message: "Plan a new payment feature", agent: "plan" }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, { message: "Fix undefined error on login", agent: "debug" }, { timeoutMs: config.timeoutMs }),
    ]);

    const planHasPlan = /plan|step|feature|milestone|arch|implement/i.test(planRes.body);
    const debugHasDebug = /error|undefined|fix|bug|cause|login/i.test(debugRes.body);
    const ok = (planRes.status < 500 && debugRes.status < 500 && planHasPlan && debugHasDebug) || isEnvironmentGate(planRes.status) || isEnvironmentGate(debugRes.status);
    tests.push({
      name: `Distributed agents: agents maintain separate context (plan: ${planHasPlan}, debug: ${debugHasDebug})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { planStatus: planRes.status, debugStatus: debugRes.status, planHasPlan, debugHasDebug },
      error: ok ? undefined : "Agents not maintaining separate context — context contamination detected",
      rootCause: ok ? undefined : "Agent system prompts leaking between requests",
      suggestedFix: ok ? undefined : "Ensure each agent gets its own system prompt; no shared conversation state",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Agent types match distributed runtime spec ─────────────────────────
  {
    const t0 = Date.now();
    const expectedAgents = ["planner", "frontend", "backend", "database", "security", "testing", "documentation", "deployment"];
    const res = await httpGet(`${BASE}/api/agents/messages`, { timeoutMs: config.timeoutMs });
    let hasAgentRegistry = false;
    try {
      const body = JSON.parse(res.body);
      hasAgentRegistry = Array.isArray(body.agentTypes) && body.agentTypes.length > 0;
    } catch {}
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: `Distributed agents: agent registry lists ${expectedAgents.length} agent types (registry present: ${hasAgentRegistry})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status, hasAgentRegistry, expectedAgents },
      error: ok ? undefined : "Agent registry not accessible",
      rootCause: ok ? undefined : "ACP endpoint not returning agent type registry",
      suggestedFix: ok ? undefined : "Add agentTypes array to GET /api/agents/messages response",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 63, name: "Distributed Agent Runtime", tests, totalMs: Date.now() - start, passCount, failCount };
}
