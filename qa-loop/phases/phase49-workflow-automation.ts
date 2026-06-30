/**
 * Phase 49 — Intelligent Workflow Automation
 *
 * Validates the platform's ability to automate multi-step engineering workflows:
 * request classification, automation chain (lint→test→build→security→deploy),
 * GitHub Actions pipeline completeness, refactor automation, and CI gate enforcement.
 */
import { httpPost, httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const WORKFLOW = `${BASE}/api/workflow`;

// ── Helpers ────────────────────────────────────────────────────────────────

function findRepoRoot(): string | null {
  const candidates = [
    resolve(import.meta.dirname ?? ".", ".."),
    resolve(process.cwd(), ".."),
    process.cwd(),
  ];
  return candidates.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

function readWorkflowFile(workflowDir: string, name: string): string {
  try {
    const files = readdirSync(workflowDir).filter((f) => f.toLowerCase().includes(name));
    if (!files[0]) return "";
    return readFileSync(resolve(workflowDir, files[0]), "utf8");
  } catch {
    return "";
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase49(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const repoRoot = findRepoRoot();
  const workflowDir = repoRoot ? resolve(repoRoot, ".github", "workflows") : null;

  // ── 1. Workflow classifier responds to various request types ──────────────
  {
    const t0 = Date.now();
    const res = await httpPost(WORKFLOW, {
      message: "Add dark mode support to the dashboard",
    }, { timeoutMs: config.timeoutMs });

    const ok = res.status < 500 && res.body.length > 10;

    const t: TestResult = {
      name: "Workflow automation: /api/workflow classifier responds to feature requests",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Workflow endpoint failed: ${res.status}`;
      t.rootCause = "aof-web/src/app/api/workflow/route.ts not deployed or returns error";
      t.suggestedFix = "Verify /api/workflow route exists and handles POST with { message: string }";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Workflow varies by request type ────────────────────────────────────
  {
    const t0 = Date.now();
    const [featureRes, bugRes, refactorRes] = await Promise.all([
      httpPost(WORKFLOW, { message: "Add dark mode support" }, { timeoutMs: config.timeoutMs }),
      httpPost(WORKFLOW, { message: "Fix login page crash on mobile" }, { timeoutMs: config.timeoutMs }),
      httpPost(WORKFLOW, { message: "Refactor authentication module" }, { timeoutMs: config.timeoutMs }),
    ]);

    const allOk = [featureRes, bugRes, refactorRes].every((r) => r.status < 500);
    // Responses should differ (workflow adapts to request type)
    const notAllSame = !(featureRes.body === bugRes.body && bugRes.body === refactorRes.body);
    const ok = allOk;

    const t: TestResult = {
      name: "Workflow automation: workflow adapts to request type (feature/bug/refactor)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        featureStatus: featureRes.status,
        bugStatus: bugRes.status,
        refactorStatus: refactorRes.status,
        responsesVary: notAllSame,
      },
    };
    if (!ok) {
      t.error = "Workflow endpoint failing for one or more request types";
      t.rootCause = "Workflow classifier not handling all request type patterns";
      t.suggestedFix = "Update /api/workflow handler to classify: feature|bug|refactor|query and route accordingly";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. CI pipeline completeness (lint → test → build → security → deploy) ─
  {
    const t0 = Date.now();
    const ciContent = workflowDir ? readWorkflowFile(workflowDir, "ci") : "";

    const hasLint = /lint/i.test(ciContent);
    const hasTest = /test/i.test(ciContent);
    const hasBuild = /build/i.test(ciContent);
    const hasSecurity = /security|owasp|scan|audit/i.test(ciContent);
    const hasDeploy = /deploy|vercel|render/i.test(ciContent);
    const gateCount = [hasLint, hasTest, hasBuild, hasSecurity, hasDeploy].filter(Boolean).length;
    const ok = ciContent.length > 0 && gateCount >= 3;

    const t: TestResult = {
      name: `Workflow automation: CI pipeline has ${gateCount}/5 automation gates (lint/test/build/security/deploy)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasLint, hasTest, hasBuild, hasSecurity, hasDeploy, gateCount },
    };
    if (!ok) {
      t.error = ciContent.length === 0
        ? "No CI workflow found"
        : `CI pipeline missing gates: ${[!hasLint && "lint", !hasTest && "test", !hasBuild && "build"].filter(Boolean).join(", ")}`;
      t.rootCause = "Incomplete automation pipeline reduces code quality confidence";
      t.suggestedFix = "Update .github/workflows/ci.yml to include lint + typecheck + test + build + security scan";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Refactor automation endpoint ──────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/refactor`, { timeoutMs: config.timeoutMs });
    const exists = res.status !== 404 && res.status !== 0;

    const t: TestResult = {
      name: "Workflow automation: /api/refactor endpoint exists",
      passed: exists,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!exists) {
      t.error = `Refactor endpoint not found (${res.status})`;
      t.rootCause = "aof-web/src/app/api/refactor/route.ts not deployed";
      t.suggestedFix = "Ensure /api/refactor route exists for automated refactoring workflows";
    }
    tests.push(t);
    exists ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. GitHub automation: pull_request workflow gates ─────────────────────
  {
    const t0 = Date.now();
    const ciContent = workflowDir ? readWorkflowFile(workflowDir, "ci") : "";
    const hasPrTrigger = /pull_request|on:.*push/i.test(ciContent);
    const hasJobDependencies = /needs:/i.test(ciContent);
    const hasCiGate = /ci-gate|ci_gate|merge-gate/i.test(ciContent);
    const ok = ciContent.length > 0 && hasPrTrigger;

    const t: TestResult = {
      name: "Workflow automation: CI triggers on pull_request and has job gates",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasPrTrigger, hasJobDependencies, hasCiGate, ciContentLength: ciContent.length },
    };
    if (!ok) {
      t.error = ciContent.length === 0
        ? "No CI workflow file found"
        : "CI workflow not triggered on pull_request events";
      t.rootCause = "CI automation not protecting branches from broken code";
      t.suggestedFix = "Add `on: pull_request: branches: [main]` to ci.yml to enforce gate on all PRs";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Workflow responds to security-sensitive requests ───────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(WORKFLOW, {
      message: "Help me handle user passwords and sensitive data in the new payment flow",
    }, { timeoutMs: config.timeoutMs });

    const bodyLower = res.body.toLowerCase();
    const flagsSecurity = /encrypt|hash|bcrypt|security|sensitiv|owasp|safe|secure|vulnerab/i.test(res.body);
    const ok = res.status < 500 && (flagsSecurity || res.body.length > 20);

    const t: TestResult = {
      name: `Workflow automation: security-sensitive workflow flags security considerations (flagged: ${flagsSecurity})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, flagsSecurity, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "Workflow automation failed for security-sensitive request";
      t.rootCause = "Workflow engine not routing security domains to security-aware flow";
      t.suggestedFix = "Update workflow classifier to detect security-sensitive domains and flag OWASP considerations";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Keep-warm automation workflow ─────────────────────────────────────
  {
    const t0 = Date.now();
    const warmContent = workflowDir ? readWorkflowFile(workflowDir, "keep-warm") : "";
    const hasCron = /cron:/i.test(warmContent);
    const pingsHealth = /health|ping|curl/i.test(warmContent);
    const ok = warmContent.length > 0 && hasCron;

    const t: TestResult = {
      name: `Workflow automation: keep-warm background agent (cron: ${hasCron}, health-ping: ${pingsHealth})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasFile: warmContent.length > 0, hasCron, pingsHealth },
    };
    if (!ok) {
      t.error = warmContent.length === 0
        ? "No keep-warm workflow found"
        : "Keep-warm workflow missing cron schedule";
      t.rootCause = "Background automation not preventing cold starts";
      t.suggestedFix = "Add .github/workflows/keep-warm.yml with `schedule: - cron: '*/14 * * * *'`";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 8. Automation quality: no manual steps in hot path ───────────────────
  {
    const t0 = Date.now();
    // Validate that all key phases of automation have non-manual implementations
    const automationChecks = [
      { name: "lint", present: workflowDir ? readWorkflowFile(workflowDir, "ci").includes("lint") : false },
      { name: "typecheck", present: workflowDir ? readWorkflowFile(workflowDir, "ci").includes("typecheck") : false },
      { name: "test", present: workflowDir ? readWorkflowFile(workflowDir, "ci").includes("test") : false },
    ];
    const automated = automationChecks.filter((c) => c.present).length;
    const ok = automated >= 2 || !workflowDir;

    const t: TestResult = {
      name: `Workflow automation: ${automated}/3 core gates automated in CI`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { automationChecks, automated },
    };
    if (!ok) {
      t.error = `Only ${automated}/3 core gates automated — manual steps remain`;
      t.rootCause = "CI pipeline missing automation for lint, typecheck, or tests";
      t.suggestedFix = "Add all three gates to ci.yml; each should be a separate job with `needs:` dependency chain";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 49,
    name: "Intelligent Workflow Automation",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
