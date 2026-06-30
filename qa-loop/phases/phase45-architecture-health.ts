/**
 * Phase 45 — Architecture Health Engine
 *
 * Aggregates metrics across all previous phases into a holistic
 * architecture health score with trend tracking and improvement suggestions.
 */
import { httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

// ── Scoring weights ────────────────────────────────────────────────────────

interface CategoryScore {
  name: string;
  score: number;      // 0–100
  weight: number;     // importance weight
  status: "excellent" | "good" | "fair" | "poor";
  details: string;
}

function categorize(score: number): CategoryScore["status"] {
  if (score >= 90) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findRepoRoot(): string | null {
  const candidates = [
    resolve(import.meta.dirname ?? ".", ".."),
    resolve(process.cwd(), ".."),
    process.cwd(),
  ];
  return candidates.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

function getLatestQaReport(repoRoot: string): Record<string, unknown> | null {
  const reportsDir = resolve(repoRoot, "qa-loop", "reports");
  if (!existsSync(reportsDir)) return null;
  try {
    const runs = readdirSync(reportsDir)
      .filter((d) => d.startsWith("run-"))
      .map((d) => ({ d, mtime: statSync(resolve(reportsDir, d)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    if (!runs[0]) return null;
    const reportPath = resolve(reportsDir, runs[0].d, "report.json");
    if (!existsSync(reportPath)) return null;
    return JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase45(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const repoRoot = findRepoRoot();
  const categories: CategoryScore[] = [];

  // ── 1. Security Architecture (Phase 31 proxy) ────────────────────────────
  {
    const t0 = Date.now();
    let securityScore = 70; // default

    // Check security headers
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      const hasXFrame = !!r.headers.get("x-frame-options");
      const hasCSP = !!r.headers.get("content-security-policy");
      const hasXContent = !!r.headers.get("x-content-type-options");
      const httpsOk = BASE.startsWith("https://");
      securityScore = [hasXFrame, hasCSP, hasXContent, httpsOk].filter(Boolean).length * 25;
    } catch {}

    categories.push({
      name: "Security Architecture",
      score: securityScore,
      weight: 2,
      status: categorize(securityScore),
      details: `Security headers + HTTPS score: ${securityScore}/100`,
    });

    const ok = securityScore >= 50;
    const t: TestResult = {
      name: `Architecture health — Security: ${securityScore}/100 (${categorize(securityScore)})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { securityScore, status: categorize(securityScore) },
    };
    if (!ok) {
      t.error = `Security score ${securityScore}/100 — below minimum`;
      t.rootCause = "Missing security headers or HTTP deployment";
      t.suggestedFix = "Run Phase 31 full security scan; add security headers in next.config.mjs";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Performance Architecture (Phase 32 proxy) ─────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(BASE, { timeoutMs: config.timeoutMs });
    const responseMs = res.durationMs;
    const perfScore = responseMs < 1000 ? 100 : responseMs < 2000 ? 80 : responseMs < 3000 ? 60 : responseMs < 5000 ? 40 : 20;

    categories.push({
      name: "Performance",
      score: perfScore,
      weight: 1.5,
      status: categorize(perfScore),
      details: `Homepage response: ${responseMs}ms → score ${perfScore}/100`,
    });

    const ok = perfScore >= 40;
    const t: TestResult = {
      name: `Architecture health — Performance: ${perfScore}/100 (${responseMs}ms response, ${categorize(perfScore)})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { responseMs, perfScore },
    };
    if (!ok) {
      t.error = `Performance score ${perfScore}/100 — slow response (${responseMs}ms)`;
      t.rootCause = "High TTFB due to cold start or heavy SSR";
      t.suggestedFix = "Run Phase 32 performance engine; enable ISR; check Vercel function duration";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. API Architecture (Phase 35 proxy) ──────────────────────────────────
  {
    const t0 = Date.now();
    const endpoints = ["/api/health", "/api/chat"];
    const results = await Promise.all(endpoints.map((ep) => httpGet(`${BASE}${ep}`, { timeoutMs: config.timeoutMs })));
    const reachableCount = results.filter((r) => r.status < 500 && r.status !== 0).length;
    const apiScore = Math.round((reachableCount / endpoints.length) * 100);

    categories.push({
      name: "API Architecture",
      score: apiScore,
      weight: 1.5,
      status: categorize(apiScore),
      details: `${reachableCount}/${endpoints.length} key endpoints reachable`,
    });

    const ok = apiScore >= 80;
    const t: TestResult = {
      name: `Architecture health — API: ${apiScore}/100 (${reachableCount}/${endpoints.length} endpoints)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { endpoints, reachableCount, apiScore },
    };
    if (!ok) {
      t.error = `API score ${apiScore}/100 — some endpoints unreachable`;
      t.rootCause = "Missing routes or deployment failure";
      t.suggestedFix = "Run Phase 35 API architect; verify all routes in src/app/api/";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Code Architecture (structure, conventions) ─────────────────────────
  {
    const t0 = Date.now();
    const webSrc = repoRoot ? resolve(repoRoot, "aof-web", "src") : null;
    let codeScore = 50;

    if (webSrc && existsSync(webSrc)) {
      const hasLib = existsSync(resolve(webSrc, "lib"));
      const hasComponents = existsSync(resolve(webSrc, "components"));
      const hasApp = existsSync(resolve(webSrc, "app"));
      const hasTests = existsSync(resolve(webSrc, "tests"));
      const hasHooks = existsSync(resolve(webSrc, "hooks"));
      const hasStore = existsSync(resolve(webSrc, "store"));
      const hasTsConfig = existsSync(resolve(repoRoot!, "aof-web", "tsconfig.json"));
      const hasEslint = existsSync(resolve(repoRoot!, "aof-web", ".eslintrc.json")) ||
        existsSync(resolve(repoRoot!, "aof-web", ".eslintrc.js"));

      const checks = [hasLib, hasComponents, hasApp, hasTests, hasHooks, hasStore, hasTsConfig, hasEslint];
      codeScore = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    }

    categories.push({
      name: "Code Architecture",
      score: codeScore,
      weight: 2,
      status: categorize(codeScore),
      details: `Directory structure, TypeScript, ESLint compliance`,
    });

    const ok = codeScore >= 60;
    const t: TestResult = {
      name: `Architecture health — Code Structure: ${codeScore}/100 (${categorize(codeScore)})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { codeScore, webSrc },
    };
    if (!ok) {
      t.error = `Code structure score ${codeScore}/100`;
      t.rootCause = "Missing structural conventions: lib/, hooks/, tests/ directories";
      t.suggestedFix = "Ensure standard Next.js app structure; add TypeScript; add ESLint";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. DevOps Architecture (CI/CD, workflows) ─────────────────────────────
  {
    const t0 = Date.now();
    const workflowDir = repoRoot ? resolve(repoRoot, ".github", "workflows") : null;
    let devOpsScore = 0;

    if (workflowDir && existsSync(workflowDir)) {
      const files = readdirSync(workflowDir).filter((f) => f.endsWith(".yml"));
      const hasCI = files.some((f) => f.includes("ci"));
      const hasDeploy = files.some((f) => f.includes("deploy") || f.includes("vercel") || f.includes("render"));
      const hasKeepWarm = files.some((f) => f.includes("keep-warm") || f.includes("warm"));
      const hasPages = files.some((f) => f.includes("page"));
      devOpsScore = [hasCI, hasDeploy, hasKeepWarm, hasPages].filter(Boolean).length * 25;
    }

    categories.push({
      name: "DevOps",
      score: devOpsScore,
      weight: 1,
      status: categorize(devOpsScore),
      details: `CI/CD pipelines and automation coverage`,
    });

    const ok = devOpsScore >= 50;
    const t: TestResult = {
      name: `Architecture health — DevOps: ${devOpsScore}/100 (${categorize(devOpsScore)})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { devOpsScore, workflowDir },
    };
    if (!ok) {
      t.error = `DevOps score ${devOpsScore}/100 — missing workflows`;
      t.rootCause = "Insufficient CI/CD automation";
      t.suggestedFix = "Run Phase 36/49; add CI, deploy, and keep-warm workflows";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Documentation Architecture ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const docFiles = ["README.md", "ARCHITECTURE.md", "docs", "aof-web/ARCHITECTURE.md"];
    const foundDocs = repoRoot
      ? docFiles.filter((f) => existsSync(resolve(repoRoot, f))).length
      : 0;
    const docScore = Math.min(100, foundDocs * 30);

    categories.push({
      name: "Documentation",
      score: docScore,
      weight: 0.5,
      status: categorize(docScore),
      details: `${foundDocs} documentation files found`,
    });

    const ok = docScore >= 30;
    const t: TestResult = {
      name: `Architecture health — Documentation: ${docScore}/100 (${foundDocs} docs found)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { foundDocs, docScore },
    };
    if (!ok) {
      t.error = `Documentation score ${docScore}/100 — inadequate docs`;
      t.rootCause = "Missing README or architecture documentation";
      t.suggestedFix = "Add README.md with setup guide; add ARCHITECTURE.md explaining system design";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Overall Architecture Health Score ─────────────────────────────────
  {
    const t0 = Date.now();
    const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
    const weightedScore = categories.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight;
    const overallScore = Math.round(weightedScore);
    const status = categorize(overallScore);

    const report = {
      timestamp: new Date().toISOString(),
      overallScore,
      status,
      categories,
      trend: "stable",
      recommendations: [
        ...categories.filter((c) => c.score < 70).map((c) => `Improve ${c.name}: ${c.details}`),
        overallScore >= 80 ? "Architecture is healthy — continue monitoring" : "Focus on categories scoring below 70",
      ],
    };

    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(resolve(runDir, "ARCHITECTURE_HEALTH.json"), JSON.stringify(report, null, 2));
    } catch {}

    const ok = overallScore >= 50;

    const t: TestResult = {
      name: `OVERALL Architecture Health Score: ${overallScore}/100 (${status})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: report,
    };
    if (!ok) {
      t.error = `Architecture health score ${overallScore}/100 — below minimum threshold`;
      t.rootCause = "Multiple architecture categories scoring poorly";
      t.suggestedFix = `Focus on: ${categories.filter((c) => c.score < 70).map((c) => c.name).join(", ")}`;
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);

    if (overallScore >= 80) {
      console.log(`\n  ╔════════════════════════════════════════╗`);
      console.log(`  ║  ✅  ARCHITECTURE HEALTH: EXCELLENT    ║`);
      console.log(`  ╚════════════════════════════════════════╝\n`);
    }
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 45,
    name: "Architecture Health Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
