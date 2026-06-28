import { httpGet, httpPost, collectSSE } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const AGENT_COUNTS = [1, 2, 4, 8] as const;
const MODES = ["titan", "raa", "voting", "dynamic"] as const;

function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runPhase5(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const backendBase = config.backendUrl;

  // ── Test 1: Backend /v1/health ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${backendBase}/v1/health`, { timeoutMs: config.timeoutMs });
    // 429 = rate-limiter active on health endpoint (concerning; health should be exempt)
    const ok = res.status === 200 || res.status === 429;
    let parsedHealth: Record<string, unknown> = {};
    try { parsedHealth = JSON.parse(res.body); } catch {}

    const t: TestResult = {
      name: "TMAP /v1/health → 200 (or 429 rate-limited)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, health: parsedHealth },
    };
    if (!ok) {
      t.error = `HTTP ${res.status}${res.error ? ` — ${res.error}` : ""}`;
      t.rootCause = "Render service crashed or cold-starting";
      t.suggestedFix = "Wait 30 s for cold start. Check .github/workflows/keep-warm.yml is active.";
    } else if (res.status === 429) {
      t.suggestedFix = "FINDING: Rate limiter covers /v1/health — exempt health endpoints to avoid blocking keep-warm pings";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 2: /v2/health (if v2 active) ─────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${backendBase}/v2/health`, { timeoutMs: config.timeoutMs });
    // v2 may not have a separate health route — 404 is OK; 500 is not
    const ok = res.status !== 500 && res.status !== 503;
    const t: TestResult = {
      name: "TMAP /v2/health → no 5xx",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `v2 health returned ${res.status}`;
      t.rootCause = "v2 orchestration engine initialisation failure";
      t.suggestedFix = "Check COAGENTIX_V2 flag and v2/ module imports in server/index.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 3: /v1/run with a simple task ─────────────────────────────────
  {
    const agentCount = randomPick(AGENT_COUNTS);
    const mode = randomPick(MODES);
    log.info(`TMAP /v1/run — agents=${agentCount} mode=${mode}`);
    const t0 = Date.now();
    const payload = {
      task: "Write a function called add(a, b) that returns a + b.",
      agentCount,
      mode,
      stream: false,
      maxTokens: 200,
    };
    const res = await httpPost(`${backendBase}/v1/run`, payload, { timeoutMs: Math.max(config.timeoutMs, 90_000) });
    const ok =
      res.status === 200 ||
      res.status === 401 || // auth-required is valid
      res.status === 403 ||
      res.status === 402 || // no credits — expected on zero-budget
      res.status === 429;   // rate-limited — acceptable in rapid QA runs
    const t: TestResult = {
      name: `TMAP /v1/run agents=${agentCount} mode=${mode} → no 5xx`,
      passed: ok,
      durationMs: Date.now() - t0,
      request: { url: `${backendBase}/v1/run`, method: "POST", body: JSON.stringify(payload) },
      details: { status: res.status, body: res.body.slice(0, 400) },
    };
    if (!ok) {
      t.error = `HTTP ${res.status}: ${res.body.slice(0, 200)}`;
      t.rootCause = "Multi-agent pipeline crashed — check tmap-v2 server logs on Render";
      t.suggestedFix = "Review agent registry, model routing, and executor error boundaries in tmap-v2/src/v2/";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` [${res.durationMs}ms]`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 4: /v2/run with new orchestration engine ─────────────────────
  {
    log.info("TMAP /v2/run — v2 orchestration engine");
    const t0 = Date.now();
    const payload = {
      intent: "Create a hello world function in TypeScript",
      mode: "fast",
    };
    const res = await httpPost(`${backendBase}/v2/run`, payload, { timeoutMs: Math.max(config.timeoutMs, 90_000) });
    const ok =
      res.status === 200 ||
      res.status === 401 ||
      res.status === 403 ||
      res.status === 402 ||
      res.status === 404; // v2 route may not be exposed
    const t: TestResult = {
      name: "TMAP /v2/run → no 5xx",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 400) },
    };
    if (!ok) {
      t.error = `HTTP ${res.status}: ${res.body.slice(0, 200)}`;
      t.rootCause = "v2 orchestration crashed — check RAA decomposer, dag.ts, executor.ts";
      t.suggestedFix = "Run `npm run test:integration` in tmap-v2. Check for undefined dep fields in plan.";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` [${res.durationMs}ms]`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 5: Frontend proxy /v1/* works ────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${config.baseUrl}/v1/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 404; // 404 means proxy not configured yet
    const proxyWorking = res.status === 200;
    const t: TestResult = {
      name: "Frontend proxy /v1/health reachable",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, proxyWorking },
    };
    if (!proxyWorking && res.status !== 404) {
      t.error = `Frontend /v1/health proxy returned ${res.status}`;
      t.rootCause = "next.config.mjs rewrite for /v1/* may be broken or COAGENTIX_API_PROXY not set";
      t.suggestedFix = "Check Vercel env: COAGENTIX_API_PROXY=https://aof-code.onrender.com";
    }
    tests.push(t);
    proxyWorking ? log.ok(t.name + " (proxy active)")
      : log.warn(t.name + ` (status ${res.status} — proxy may need COAGENTIX_API_PROXY env var)`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 5, name: "Multi-Agent (TMAP)", tests, totalMs: Date.now() - start, passCount, failCount };
}
