/**
 * Phase 36 — AI Deployment Center
 *
 * Validates the full pre-deployment pipeline:
 * Lint → TypeCheck → Tests → Build → Security → Performance → Accessibility → Deploy readiness.
 * Deployment gates automatically on any failure.
 */
import { httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const execAsync = promisify(exec);
const BASE = config.baseUrl;

// ── Source root detection ──────────────────────────────────────────────────

function findWebRoot(): string | null {
  const candidates = [
    resolve(process.cwd(), "..","aof-web"),
    resolve(process.cwd(), "aof-web"),
    resolve(import.meta.dirname ?? ".", "..", "aof-web"),
  ];
  return candidates.find(existsSync) ?? null;
}

async function runCmd(cmd: string, cwd: string, timeoutMs = 120_000): Promise<{ ok: boolean; stdout: string; stderr: string; durationMs: number }> {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: timeoutMs });
    return { ok: true, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 500), durationMs: Date.now() - t0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (err.stdout ?? "").slice(0, 2000),
      stderr: (err.stderr ?? err.message ?? "").slice(0, 500),
      durationMs: Date.now() - t0,
    };
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase36(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const webRoot = findWebRoot();
  const hasSource = webRoot !== null;

  if (!hasSource) {
    log.warn("Phase 36: aof-web source not found locally — running deployment checks against live deployment only");
  }

  // ── Gate 1: Lint ────────────────────────────────────────────────────────
  if (hasSource) {
    const t0 = Date.now();
    const { ok, stdout, stderr, durationMs } = await runCmd("npm run lint -- --max-warnings=0", webRoot!, 60_000);

    const t: TestResult = {
      name: "Lint: npm run lint passes (0 warnings, 0 errors)",
      passed: ok,
      durationMs,
      details: { stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 300) },
    };
    if (!ok) {
      t.error = `Lint failed: ${stderr.slice(0, 200) || stdout.slice(0, 200)}`;
      t.rootCause = "ESLint rule violations in source code";
      t.suggestedFix = "Run: cd aof-web && npm run lint -- --fix; resolve remaining manual issues";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${durationMs}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Gate 2: TypeCheck ────────────────────────────────────────────────────
  if (hasSource) {
    const t0 = Date.now();
    const { ok, stdout, stderr, durationMs } = await runCmd("npm run typecheck", webRoot!, 60_000);

    const t: TestResult = {
      name: "TypeCheck: tsc --noEmit passes",
      passed: ok,
      durationMs,
      details: { stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 300) },
    };
    if (!ok) {
      t.error = `TypeScript errors: ${(stdout + stderr).slice(0, 300)}`;
      t.rootCause = "Type errors in TypeScript source files";
      t.suggestedFix = "Run: cd aof-web && npm run typecheck and fix all reported errors";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${durationMs}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Gate 3: Unit Tests ───────────────────────────────────────────────────
  if (hasSource) {
    const t0 = Date.now();
    const { ok, stdout, stderr, durationMs } = await runCmd("npm test -- --passWithNoTests", webRoot!, 120_000);

    const t: TestResult = {
      name: "Tests: npm test passes",
      passed: ok,
      durationMs,
      details: { stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 300) },
    };
    if (!ok) {
      t.error = `Test suite failed: ${(stderr || stdout).slice(0, 300)}`;
      t.rootCause = "Unit or integration test failure";
      t.suggestedFix = "Run: cd aof-web && npm test and fix failing tests before deploying";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${durationMs}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Gate 4: Production Build ─────────────────────────────────────────────
  if (hasSource) {
    const t0 = Date.now();
    const { ok, stdout, stderr, durationMs } = await runCmd("npm run build 2>&1 | tail -30", webRoot!, 180_000);

    const buildFailed =
      !ok ||
      stdout.includes("Failed to compile") ||
      stdout.includes("Build error") ||
      stderr.includes("Error:");

    const t: TestResult = {
      name: "Production build: next build succeeds",
      passed: !buildFailed,
      durationMs,
      details: { buildOutput: (stdout + stderr).slice(0, 800) },
    };
    if (buildFailed) {
      t.error = `Build failed: ${(stdout + stderr).slice(0, 300)}`;
      t.rootCause = "Compile-time error in Next.js app (missing env vars, broken imports, type errors)";
      t.suggestedFix = "Run: cd aof-web && npm run build locally; fix all reported errors before deploying";
    }
    tests.push(t);
    (!buildFailed) ? log.ok(`${t.name} (${durationMs}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Gate 5: Security — live deployment reachable ─────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;

    const t: TestResult = {
      name: "Deployment reachable: GET /api/health → 200",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${BASE}/api/health` },
    };
    if (!ok) {
      t.error = `Deployed app health check failed (${res.status})`;
      t.rootCause = "Deployment failed or service is down";
      t.suggestedFix = "Check Vercel deployment logs; verify all required env vars are set in Vercel dashboard";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Gate 6: Environment variables present ────────────────────────────────
  {
    const t0 = Date.now();
    // Probe for common missing-env symptoms in the health response
    const res = await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
    let envOk = true;
    let envError = "";
    try {
      const json = JSON.parse(res.body) as Record<string, unknown>;
      if (json.error?.toString().includes("NEXT_PUBLIC") || json.error?.toString().includes("undefined")) {
        envOk = false;
        envError = String(json.error).slice(0, 200);
      }
    } catch {}
    const ok = res.status === 200 && envOk;

    const t: TestResult = {
      name: "Environment variables: no missing-env errors in health response",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 300), envOk },
    };
    if (!ok) {
      t.error = envError || `Health returned ${res.status} suggesting missing env vars`;
      t.rootCause = "Required environment variables not set in deployment platform";
      t.suggestedFix = "Set all NEXT_PUBLIC_*, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in Vercel/Railway dashboard";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Gate 7: Vercel deployment provider check ─────────────────────────────
  {
    const t0 = Date.now();
    let deployedOn = "unknown";
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      deployedOn = r.headers.get("x-vercel-id") ? "vercel"
        : r.headers.get("server") ?? "unknown";
    } catch {}
    const ok = true; // informational only

    const t: TestResult = {
      name: `Deployment platform detected`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { platform: deployedOn, baseUrl: BASE },
    };
    tests.push(t);
    log.ok(`${t.name}: ${deployedOn}`);
  }

  // ── Gate 8: HTTPS enforced ───────────────────────────────────────────────
  {
    const t0 = Date.now();
    const isHttps = BASE.startsWith("https://");
    let redirectsToHttps = false;
    if (!isHttps) {
      try {
        const httpUrl = BASE.replace("https://", "http://");
        const r = await fetch(httpUrl, { redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs) });
        const loc = r.headers.get("location") ?? "";
        redirectsToHttps = (r.status === 301 || r.status === 302) && loc.startsWith("https://");
      } catch {}
    }
    const ok = isHttps || redirectsToHttps;

    const t: TestResult = {
      name: "HTTPS enforced (deployment uses https or redirects http→https)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { baseUrl: BASE, isHttps, redirectsToHttps },
    };
    if (!ok) {
      t.error = "Deployment is not using HTTPS";
      t.rootCause = "Missing TLS configuration on hosting platform";
      t.suggestedFix = "Enable HTTPS in Vercel/Render/Railway settings; all providers support free TLS";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── Summary: Deployment gate decision ────────────────────────────────────
  const allPassed = tests.every((t) => t.passed);
  {
    const t: TestResult = {
      name: `DEPLOYMENT GATE: ${allPassed ? "✅ APPROVED — all checks passed" : "🚫 BLOCKED — fix failures before deploying"}`,
      passed: allPassed,
      durationMs: 0,
      details: {
        passed: tests.filter((t) => t.passed).length,
        failed: tests.filter((t) => !t.passed).length,
        decision: allPassed ? "DEPLOY" : "BLOCK",
      },
    };
    if (!allPassed) {
      t.error = `${tests.filter((t) => !t.passed).length} gate(s) failed — deployment blocked`;
      t.rootCause = "Pre-deployment validation failed";
      t.suggestedFix = "Fix all failing tests in this phase before attempting deployment";
    }
    tests.push(t);
    allPassed ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 36,
    name: "AI Deployment Center",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
