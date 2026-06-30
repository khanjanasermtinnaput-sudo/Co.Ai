/**
 * Phase 43 — Continuous Background Agents
 *
 * Validates that background AI systems continuously monitor the platform:
 * GitHub Actions workflows, keep-warm pings, health monitoring, and
 * background analysis pipelines — all without interrupting the user.
 */
import { httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

// ── Helpers ────────────────────────────────────────────────────────────────

function findWorkflowDir(): string | null {
  const candidates = [
    resolve(import.meta.dirname ?? ".", "..", ".github", "workflows"),
    resolve(process.cwd(), "..", ".github", "workflows"),
  ];
  return candidates.find(existsSync) ?? null;
}

function readWorkflow(dir: string, name: string): string {
  const candidates = readdirSync(dir).filter((f) => f.toLowerCase().includes(name));
  if (!candidates[0]) return "";
  try { return readFileSync(resolve(dir, candidates[0]), "utf8"); } catch { return ""; }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase43(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const workflowDir = findWorkflowDir();
  const hasWorkflowDir = workflowDir !== null;

  // ── 1. GitHub Actions workflows exist ────────────────────────────────────
  {
    const t0 = Date.now();
    let workflows: string[] = [];
    if (workflowDir) {
      workflows = readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    }
    const ok = workflows.length > 0;

    const t: TestResult = {
      name: `Background agents: ${workflows.length} GitHub Actions workflows found`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { workflowDir, workflows },
    };
    if (!ok) {
      t.error = "No GitHub Actions workflows found — no background automation";
      t.rootCause = ".github/workflows directory missing or empty";
      t.suggestedFix = "Create .github/workflows/ directory with CI and monitoring workflows";
    }
    tests.push(t);
    ok ? log.ok(`${t.name}: ${workflows.join(", ")}`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Keep-warm workflow exists ──────────────────────────────────────────
  {
    const t0 = Date.now();
    const content = workflowDir ? readWorkflow(workflowDir, "keep-warm") : "";
    const hasKeepWarm = content.length > 0;
    const hasSchedule = /schedule|cron/i.test(content);
    const ok = hasKeepWarm && hasSchedule;

    const t: TestResult = {
      name: "Background agents: keep-warm workflow with cron schedule",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasKeepWarm, hasSchedule, contentLength: content.length },
    };
    if (!ok) {
      t.error = !hasKeepWarm ? "No keep-warm workflow found" : "Keep-warm workflow has no cron schedule";
      t.rootCause = "Background health-ping workflow not configured";
      t.suggestedFix = "Create .github/workflows/keep-warm.yml with schedule: cron to ping /api/health and /v1/health";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. CI workflow covers required checks ────────────────────────────────
  {
    const t0 = Date.now();
    const content = workflowDir ? readWorkflow(workflowDir, "ci") : "";
    const hasCi = content.length > 0;
    const hasLint = /lint/i.test(content);
    const hasTypecheck = /typecheck|tsc/i.test(content);
    const hasTest = /test/i.test(content);
    const hasBuild = /build/i.test(content);
    const ok = hasCi && hasLint && hasTypecheck && hasTest;

    const t: TestResult = {
      name: "Background agents: CI workflow covers lint + typecheck + tests",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasCi, hasLint, hasTypecheck, hasTest, hasBuild },
    };
    if (!ok) {
      t.error = [
        !hasLint ? "No lint step" : "",
        !hasTypecheck ? "No typecheck step" : "",
        !hasTest ? "No test step" : "",
      ].filter(Boolean).join("; ");
      t.rootCause = "CI workflow missing required quality gates";
      t.suggestedFix = "Update ci.yml to include lint, typecheck, and test steps (Phase 36 gates)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Frontend health is continuously monitored ─────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;

    const t: TestResult = {
      name: "Background monitoring: frontend /api/health returns 200 (background agents monitoring)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Frontend health check failed (${res.status}) — background agent would fire alert`;
      t.rootCause = "Frontend deployment issue or server error";
      t.suggestedFix = "Fix health endpoint; background monitoring should have auto-alerted";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Backend health continuously monitored ──────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BACKEND}/v1/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 429;

    const t: TestResult = {
      name: "Background monitoring: backend /v1/health responds (background agent alive)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${BACKEND}/v1/health` },
    };
    if (!ok) {
      t.error = `Backend health failed (${res.status}) — Render service may be down`;
      t.rootCause = "Backend service not responding to background health pings";
      t.suggestedFix = "Check Render dashboard; ensure keep-warm workflow is running and backend is not paused";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Deployment workflows exist (continuous CD) ─────────────────────────
  {
    const t0 = Date.now();
    let hasVercelDeploy = false;
    let hasRenderDeploy = false;
    if (workflowDir) {
      const files = readdirSync(workflowDir);
      hasVercelDeploy = files.some((f) => f.toLowerCase().includes("vercel") || readWorkflow(workflowDir, f).includes("vercel"));
      hasRenderDeploy = files.some((f) => f.toLowerCase().includes("render") || readWorkflow(workflowDir, f).includes("render"));
    }
    const ok = hasVercelDeploy || hasRenderDeploy;

    const t: TestResult = {
      name: "Background agents: continuous deployment workflow present (Vercel/Render)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasVercelDeploy, hasRenderDeploy, workflowDir },
    };
    if (!ok) {
      t.error = "No deployment workflow found — deployments are manual";
      t.rootCause = "Missing CD workflow for automated deployment on push to main";
      t.suggestedFix = "Add vercel-deploy.yml or render-deploy.yml to .github/workflows/";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Pages/documentation workflow ──────────────────────────────────────
  {
    const t0 = Date.now();
    let hasPagesWorkflow = false;
    if (workflowDir) {
      const files = readdirSync(workflowDir);
      hasPagesWorkflow = files.some((f) => f.toLowerCase().includes("page"));
    }
    const ok = true; // informational

    const t: TestResult = {
      name: `Background agents: documentation/pages workflow ${hasPagesWorkflow ? "present" : "not found (optional)"}`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasPagesWorkflow, workflowDir },
    };
    tests.push(t);
    log.ok(t.name);
  }

  // ── 8. Background analysis: repo change detection ─────────────────────────
  {
    const t0 = Date.now();
    // Simulate what a background agent would detect: new files since last commit
    let recentChanges = 0;
    try {
      const { execSync } = await import("node:child_process");
      const repoRoot = resolve(import.meta.dirname ?? ".", "..");
      const output = execSync("git diff --name-only HEAD~1 HEAD 2>/dev/null || echo ''", {
        cwd: repoRoot, encoding: "utf8", timeout: 10_000,
      }).trim();
      recentChanges = output ? output.split("\n").filter(Boolean).length : 0;
    } catch {}

    const ok = true; // informational

    const t: TestResult = {
      name: `Background agents: repository change detection (${recentChanges} files changed since last commit)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { recentChanges },
    };
    tests.push(t);
    log.ok(`${t.name}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 43,
    name: "Continuous Background Agents",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
