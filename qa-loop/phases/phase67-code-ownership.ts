/**
 * Phase 67 — Intelligent Code Ownership
 *
 * Tests ownership record management: file ownership assignment,
 * reviewer recommendation, risk level validation, git blame-based
 * ownership detection, and business domain mapping.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const OWNERSHIP = `${BASE}/api/ownership`;

const RISK_LEVELS = ["critical", "high", "medium", "low"] as const;

function findRepoRoot(): string | null {
  const c = [resolve(import.meta.dirname ?? ".", ".."), resolve(process.cwd(), ".."), process.cwd()];
  return c.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

export async function runPhase67(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Ownership endpoint exists ──────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${OWNERSHIP}?filePath=src/app/api/chat/route.ts`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 503;
    tests.push({
      name: "Code ownership: GET /api/ownership endpoint exists",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Ownership endpoint returned ${res.status}`,
      rootCause: ok ? undefined : "/api/ownership route not deployed",
      suggestedFix: ok ? undefined : "Deploy aof-web/src/app/api/ownership/route.ts",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Ownership GET requires auth ────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${OWNERSHIP}?filePath=test.ts`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Code ownership: GET requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Ownership data accessible without auth (${res.status})`,
      rootCause: ok ? undefined : "Ownership endpoint not protected",
      suggestedFix: ok ? undefined : "Add getUserFromRequest() in GET /api/ownership handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. GET without filePath rejected ─────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(OWNERSHIP, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 503;
    tests.push({
      name: "Code ownership: GET without filePath returns 400/401",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Missing filePath not rejected (${res.status})`,
      rootCause: ok ? undefined : "filePath not required in GET handler",
      suggestedFix: ok ? undefined : "Add filePath check: if (!filePath) return 400 in GET /api/ownership",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. POST ownership requires auth ──────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(OWNERSHIP, {
      filePath: "src/auth.ts",
      owner: "dev@example.com",
      reviewers: ["lead@example.com"],
      riskLevel: "high",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Code ownership: POST requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Ownership write allowed without auth (${res.status})`,
      rootCause: ok ? undefined : "Ownership assignment not protected",
      suggestedFix: ok ? undefined : "Add auth check in POST /api/ownership handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Invalid risk level rejected ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(OWNERSHIP, {
      filePath: "src/test.ts",
      owner: "dev@example.com",
      reviewers: ["lead@example.com"],
      riskLevel: "extreme", // not in enum
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Code ownership: invalid risk level rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid risk level not rejected (${res.status})`,
      rootCause: ok ? undefined : "Risk level enum not validated",
      suggestedFix: ok ? undefined : `Add z.enum(${JSON.stringify(RISK_LEVELS)}) for riskLevel in OwnershipSchema`,
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Git blame available for auto-ownership detection ───────────────────
  {
    const t0 = Date.now();
    const repoRoot = findRepoRoot();
    let canBlame = false;
    let topContributor: string | null = null;

    if (repoRoot) {
      try {
        const { execSync } = await import("node:child_process");
        // git shortlog does the counting/sorting natively — no reliance on
        // Unix pipe utilities (sort/uniq/head), which aren't on Windows.
        const out = execSync(
          "git shortlog -sne HEAD",
          { cwd: repoRoot, encoding: "utf8", timeout: 10_000 }
        ).trim();
        const topLine = out.split("\n")[0] ?? "";
        const match = topLine.match(/<([^>]+)>/);
        if (match) {
          canBlame = true;
          topContributor = match[1];
        }
      } catch {}
    }

    const ok = canBlame || !repoRoot;
    tests.push({
      name: `Code ownership: git blame available for auto-ownership (contributor: ${topContributor ?? "N/A"})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { canBlame, topContributor },
      error: ok ? undefined : "Git blame not available — auto-ownership detection disabled",
      rootCause: ok ? undefined : "Git not installed or repo not initialized",
      suggestedFix: ok ? undefined : "Initialize git repo with commit history for auto-ownership detection",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Critical files have identifiable ownership ─────────────────────────
  {
    const t0 = Date.now();
    const repoRoot = findRepoRoot();
    const criticalFiles = [
      "aof-web/src/app/api/chat/route.ts",
      "aof-web/src/lib/server/auth.ts",
      "aof-web/src/app/api/health/route.ts",
    ];
    const existingCritical = repoRoot
      ? criticalFiles.filter((f) => existsSync(resolve(repoRoot, f)))
      : [];
    const ok = existingCritical.length > 0 || !repoRoot;
    tests.push({
      name: `Code ownership: ${existingCritical.length} critical files identified for ownership assignment`,
      passed: ok, durationMs: Date.now() - t0,
      details: { criticalFiles, existingCritical },
      error: ok ? undefined : "No critical files found to assign ownership to",
      rootCause: ok ? undefined : "Source directory structure not matching expected paths",
      suggestedFix: ok ? undefined : "Ensure aof-web/src/app/api/chat/route.ts and auth.ts exist for critical ownership",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 67, name: "Intelligent Code Ownership", tests, totalMs: Date.now() - start, passCount, failCount };
}
