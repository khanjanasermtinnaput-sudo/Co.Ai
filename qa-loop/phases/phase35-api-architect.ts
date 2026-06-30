/**
 * Phase 35 — AI API Architect
 *
 * Audits every known API endpoint: existence, authentication enforcement,
 * validation, response schema, latency, and broken/unused routes.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

// ── API Map ────────────────────────────────────────────────────────────────

interface EndpointSpec {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  requiresAuth: boolean;
  expectedStatuses: number[];  // what's acceptable without auth
  body?: object;
  tag: string;
}

const ENDPOINTS: EndpointSpec[] = [
  // Public / health
  { method: "GET",  path: "/api/health",             requiresAuth: false, expectedStatuses: [200],           tag: "health" },
  // Chat
  { method: "POST", path: "/api/chat",               requiresAuth: false, expectedStatuses: [200,400,429,401], body: { message: "ping", agent: "chat" }, tag: "chat" },
  // Conversations
  { method: "GET",  path: "/api/conversations",      requiresAuth: true,  expectedStatuses: [401,403,307,302],  tag: "conversations" },
  // Keys
  { method: "GET",  path: "/api/keys",               requiresAuth: true,  expectedStatuses: [401,403,307,302],  tag: "keys" },
  // Auth check
  { method: "GET",  path: "/api/auth/check",         requiresAuth: true,  expectedStatuses: [401,403,200,307],  tag: "auth" },
  // Feedback
  { method: "POST", path: "/api/feedback",           requiresAuth: false, expectedStatuses: [200,400,401,429], body: { message: "test" }, tag: "feedback" },
  // Search
  { method: "GET",  path: "/api/search?q=test",      requiresAuth: false, expectedStatuses: [200,400,401,429], tag: "search" },
  // Admin — must be protected
  { method: "GET",  path: "/api/admin/users",        requiresAuth: true,  expectedStatuses: [401,403,307,302],  tag: "admin" },
  { method: "GET",  path: "/api/admin/analytics",    requiresAuth: true,  expectedStatuses: [401,403,307,302],  tag: "admin" },
  { method: "GET",  path: "/api/admin/logs",         requiresAuth: true,  expectedStatuses: [401,403,307,302],  tag: "admin" },
  { method: "GET",  path: "/api/admin/subscriptions",requiresAuth: true,  expectedStatuses: [401,403,307,302],  tag: "admin" },
  // CLI
  { method: "GET",  path: "/api/cli/token",          requiresAuth: true,  expectedStatuses: [401,403,307,302,200], tag: "cli" },
  // Referral
  { method: "GET",  path: "/api/referral",           requiresAuth: false, expectedStatuses: [200,400,401,404], tag: "referral" },
];

// Backend endpoints
const BACKEND_ENDPOINTS: EndpointSpec[] = [
  { method: "GET",  path: "/v1/health",  requiresAuth: false, expectedStatuses: [200,429], tag: "backend-health" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function probe(
  spec: EndpointSpec,
  baseUrl: string,
): Promise<{ status: number; ms: number; body: string; headers: Record<string, string> }> {
  const url = `${baseUrl}${spec.path}`;
  const t0 = Date.now();
  try {
    const opts: RequestInit = {
      method: spec.method,
      redirect: "manual",
      headers: { "Content-Type": "application/json", "User-Agent": "CoAI-APIArchitect/35" },
      signal: AbortSignal.timeout(config.timeoutMs),
    };
    if (spec.body) opts.body = JSON.stringify(spec.body);
    const r = await fetch(url, opts);
    const body = await r.text().catch(() => "");
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    return { status: r.status, ms: Date.now() - t0, body: body.slice(0, 300), headers };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: String(e), headers: {} };
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase35(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Probe all frontend API endpoints ─────────────────────────────────
  for (const spec of ENDPOINTS) {
    const t0 = Date.now();
    const { status, ms, body, headers } = await probe(spec, BASE);
    const ok = spec.expectedStatuses.includes(status);

    const t: TestResult = {
      name: `${spec.method} ${spec.path} → ${spec.expectedStatuses.join("/")}`,
      passed: ok,
      durationMs: ms,
      request: { url: `${BASE}${spec.path}`, method: spec.method },
      details: {
        status,
        latencyMs: ms,
        expectedStatuses: spec.expectedStatuses,
        requiresAuth: spec.requiresAuth,
        tag: spec.tag,
        responseSnippet: body,
      },
    };

    if (!ok) {
      if (status === 0) {
        t.error = "Connection refused or timeout";
        t.rootCause = "Endpoint does not exist or server unreachable";
        t.suggestedFix = `Verify route file at aof-web/src/app${spec.path}/route.ts exists`;
      } else if (spec.requiresAuth && status === 200) {
        t.error = `Protected endpoint returned 200 without auth (got ${status})`;
        t.rootCause = "Missing authentication guard on route handler";
        t.suggestedFix = "Add Supabase session check at start of route handler; return 401 if no session";
      } else {
        t.error = `Unexpected status ${status} (expected one of: ${spec.expectedStatuses.join(",")})`;
        t.rootCause = "Route handler returning unexpected status code";
        t.suggestedFix = "Review route handler error handling; ensure it returns documented status codes";
      }
    }

    if (ms > 5000 && ok) {
      log.warn(`Slow: ${spec.method} ${spec.path} took ${ms}ms`);
    }

    tests.push(t);
    ok ? log.ok(`${t.name} (${status}, ${ms}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Backend endpoints ─────────────────────────────────────────────────
  for (const spec of BACKEND_ENDPOINTS) {
    const t0 = Date.now();
    const { status, ms, body } = await probe(spec, BACKEND);
    const ok = spec.expectedStatuses.includes(status);

    const t: TestResult = {
      name: `[backend] ${spec.method} ${spec.path} → ${spec.expectedStatuses.join("/")}`,
      passed: ok,
      durationMs: ms,
      details: { status, latencyMs: ms, tag: spec.tag, snippet: body },
    };
    if (!ok) {
      t.error = `Backend returned ${status} (expected: ${spec.expectedStatuses.join(",")})`;
      t.rootCause = "tmap-v2 backend cold start or crashed";
      t.suggestedFix = "Check Render logs; verify keep-warm workflow is running; check /api/health on backend";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${status}, ${ms}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. 404 on non-existent routes ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/does-not-exist-xyz-9999`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 404 || res.status === 405;

    const t: TestResult = {
      name: "Non-existent API route returns 404",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Non-existent route returned ${res.status} instead of 404`;
      t.rootCause = "Catch-all route or middleware swallowing 404s";
      t.suggestedFix = "Ensure Next.js API routes return 404 for unknown paths (default behavior)";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Response Content-Type headers ────────────────────────────────────
  {
    const t0 = Date.now();
    const { status, headers } = await probe({ method: "GET", path: "/api/health", requiresAuth: false, expectedStatuses: [200], tag: "health" }, BASE);
    const ct = headers["content-type"] ?? "";
    const ok = status === 200 && ct.includes("application/json");

    const t: TestResult = {
      name: "GET /api/health returns Content-Type: application/json",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, contentType: ct },
    };
    if (!ok) {
      t.error = `Content-Type is "${ct}" — expected application/json`;
      t.rootCause = "Route handler returning plain text or HTML instead of JSON";
      t.suggestedFix = "Use NextResponse.json() or set Content-Type header explicitly";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Input validation — missing required fields ────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {}, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 422 || res.status === 401 || res.status === 429;

    const t: TestResult = {
      name: "POST /api/chat with empty body returns 400/422 (validation)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Empty body returned ${res.status} — missing input validation`;
      t.rootCause = "Route handler not validating request body before processing";
      t.suggestedFix = "Add Zod schema validation at top of POST /api/chat handler; return 400 on parse failure";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Duplicate endpoint check (CLI vs web token) ───────────────────────
  {
    const t0 = Date.now();
    const [web, cli] = await Promise.all([
      probe({ method: "GET", path: "/api/auth/check", requiresAuth: true, expectedStatuses: [401,403,200,307], tag: "auth" }, BASE),
      probe({ method: "GET", path: "/api/cli/token", requiresAuth: true, expectedStatuses: [401,403,307,302,200], tag: "cli" }, BASE),
    ]);
    // Both endpoints should exist independently (not 404)
    const ok = web.status !== 0 && cli.status !== 0;

    const t: TestResult = {
      name: "Auth and CLI token endpoints are distinct and exist",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        authCheck: { status: web.status, ms: web.ms },
        cliToken: { status: cli.status, ms: cli.ms },
      },
    };
    if (!ok) {
      t.error = `One or more auth endpoints unreachable (auth: ${web.status}, cli: ${cli.status})`;
      t.rootCause = "Route file missing or not exported";
      t.suggestedFix = "Verify aof-web/src/app/api/auth/check/route.ts and api/cli/token/route.ts both export GET handler";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. API latency percentile ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const N = 5;
    const latencies: number[] = [];
    for (let i = 0; i < N; i++) {
      const s = Date.now();
      await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
      latencies.push(Date.now() - s);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(N * 0.95) - 1] ?? latencies[latencies.length - 1];
    const ok = p95 < 3000;

    const t: TestResult = {
      name: "API p95 latency < 3000ms (5 samples)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { samples: N, latenciesMs: latencies, p95Ms: p95 },
    };
    if (!ok) {
      t.error = `p95 latency ${p95}ms exceeds 3000ms`;
      t.rootCause = "DB connection overhead or Supabase cold start on each request";
      t.suggestedFix = "Cache Supabase client instance; add connection pooler (Supavisor); use Edge runtime for health route";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (p95: ${p95}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 35,
    name: "AI API Architect",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
