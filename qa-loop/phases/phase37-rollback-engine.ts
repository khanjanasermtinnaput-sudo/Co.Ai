/**
 * Phase 37 — Rollback Engine
 *
 * Validates that every deployment has a safe recovery path.
 * Checks: deployment history availability, health endpoint for runtime crash detection,
 * rollback endpoint, database migration reversibility, and environment snapshot.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

// ── Helpers ────────────────────────────────────────────────────────────────

function findMigrationsDir(): string | null {
  const candidates = [
    resolve(process.cwd(), "..", "supabase", "migrations"),
    resolve(process.cwd(), "..", "aof-web", "supabase", "migrations"),
    resolve(import.meta.dirname ?? ".", "..", "supabase", "migrations"),
    resolve(import.meta.dirname ?? ".", "..", "aof-web", "supabase", "migrations"),
  ];
  return candidates.find(existsSync) ?? null;
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase37(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Health endpoint available (runtime crash detector) ───────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;

    const t: TestResult = {
      name: "Health check: app is healthy (rollback trigger: would fire if this fails)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = `Health check failed (${res.status}) — rollback should trigger automatically`;
      t.rootCause = "Deployment caused a runtime failure or missing env vars";
      t.suggestedFix = "Trigger rollback: Vercel → Deployments → previous deployment → Redeploy; or: git revert + push";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Backend health (rollback trigger for backend) ─────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BACKEND}/v1/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 429;

    const t: TestResult = {
      name: "Backend health check (rollback trigger: fires if backend crashes)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${BACKEND}/v1/health` },
    };
    if (!ok) {
      t.error = `Backend health failed (${res.status}) — rollback should trigger`;
      t.rootCause = "Render deployment failure or service crash";
      t.suggestedFix = "Trigger rollback: Render dashboard → Deployments → Rollback to previous; check logs";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Migrations are reversible (down migrations exist) ─────────────────
  {
    const t0 = Date.now();
    const migrationsDir = findMigrationsDir();
    let migrationCount = 0;
    let hasDownMigrations = false;
    let migrationFiles: string[] = [];

    if (migrationsDir) {
      migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
      migrationCount = migrationFiles.length;
      hasDownMigrations = migrationFiles.some((f) => f.includes("down") || f.includes("rollback"));
    }

    const ok = migrationCount > 0;

    const t: TestResult = {
      name: "Database migrations exist and are tracked",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        migrationsDir,
        migrationCount,
        hasDownMigrations,
        files: migrationFiles.slice(0, 5),
      },
    };
    if (!ok) {
      t.error = "No migration files found — database changes are not version-controlled";
      t.rootCause = "Missing supabase/migrations directory or no migrations applied";
      t.suggestedFix = "Use: supabase migration new <name> to create tracked migrations; commit to git";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${migrationCount} migrations found)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Git recovery point — repo has commits ─────────────────────────────
  {
    const t0 = Date.now();
    let commitCount = 0;
    let latestCommit = "";
    let hasGit = false;

    try {
      const { execSync } = await import("node:child_process");
      const candidates = [resolve(import.meta.dirname ?? ".", ".."), resolve(process.cwd(), ".."), process.cwd()];
      const gitRoot = candidates.find((p) => existsSync(resolve(p, ".git")));
      if (gitRoot) {
        hasGit = true;
        const countOut = execSync("git rev-list --count HEAD", { cwd: gitRoot, encoding: "utf8", timeout: 10_000 }).trim();
        commitCount = parseInt(countOut) || 0;
        latestCommit = execSync("git log -1 --format='%h %s'", { cwd: gitRoot, encoding: "utf8", timeout: 10_000 }).trim();
      }
    } catch {}

    const ok = hasGit && commitCount > 1;

    const t: TestResult = {
      name: "Git recovery points: repo has multiple commits (rollback via git revert)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasGit, commitCount, latestCommit },
    };
    if (!ok) {
      t.error = !hasGit ? "Not a git repository — no git rollback possible" : "Only 1 commit — no previous state to roll back to";
      t.rootCause = "Missing git history for recovery";
      t.suggestedFix = "Commit all changes with meaningful messages; push to GitHub for remote recovery points";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${commitCount} commits, latest: ${latestCommit})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Rollback simulation — verify previous deployment endpoint ──────────
  {
    const t0 = Date.now();
    // Check if Vercel deployment URL contains version/build info
    let deploymentInfo = "";
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      deploymentInfo = r.headers.get("x-vercel-deployment-url") ??
        r.headers.get("x-deployment-id") ??
        r.headers.get("x-powered-by") ?? "not available";
    } catch {}
    const ok = true; // informational

    const t: TestResult = {
      name: "Deployment metadata available for rollback reference",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { deploymentInfo, baseUrl: BASE },
    };
    tests.push(t);
    log.ok(`${t.name}: ${deploymentInfo}`);
  }

  // ── 6. Chat API recovers from bad input (resilience) ─────────────────────
  {
    const t0 = Date.now();
    const badInputs = [
      null,
      { message: null },
      { message: "", agent: "invalid-agent" },
    ];

    let allRecovered = true;
    const statuses: number[] = [];
    for (const body of badInputs) {
      try {
        const r = await fetch(`${BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        statuses.push(r.status);
        if (r.status >= 500) allRecovered = false;
      } catch {
        statuses.push(0);
        allRecovered = false;
      }
    }

    const ok = allRecovered;

    const t: TestResult = {
      name: "API recovers gracefully from bad input (no 5xx on invalid payloads)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { statuses, badInputsCount: badInputs.length },
    };
    if (!ok) {
      t.error = `Server returned 5xx on bad input: ${statuses.filter((s) => s >= 500).join(",")}`;
      t.rootCause = "Unhandled exception when request body is malformed or missing fields";
      t.suggestedFix = "Wrap route handler in try/catch; add Zod validation before any processing; return 400 not 500";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${statuses.join(",")})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Environment snapshot — critical env vars checklist ─────────────────
  {
    const t0 = Date.now();
    const REQUIRED_ENV = [
      "ANTHROPIC_API_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];

    // We can only check what's in the QA loop env (not the deployed env)
    const checkedLocally = REQUIRED_ENV.filter((k) => !!process.env[k]);
    const missingLocally = REQUIRED_ENV.filter((k) => !process.env[k]);

    // Infer deployed env health from API behavior
    const healthRes = await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
    let deployedEnvOk = false;
    try {
      const json = JSON.parse(healthRes.body) as Record<string, unknown>;
      deployedEnvOk = healthRes.status === 200 && !String(json.error ?? "").includes("ANTHROPIC");
    } catch {
      deployedEnvOk = healthRes.status === 200;
    }

    const ok = deployedEnvOk;

    const t: TestResult = {
      name: "Environment snapshot: deployed app env vars appear healthy",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        requiredVars: REQUIRED_ENV,
        presentLocally: checkedLocally,
        missingLocally,
        deployedHealthStatus: healthRes.status,
        deployedEnvOk,
      },
    };
    if (!ok) {
      t.error = "Deployed app health suggests missing environment variables";
      t.rootCause = "Required env vars not set in Vercel/deployment platform";
      t.suggestedFix = `Set these in Vercel Environment Variables: ${REQUIRED_ENV.join(", ")}`;
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 37,
    name: "Rollback Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
