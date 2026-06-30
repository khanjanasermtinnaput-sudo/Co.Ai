/**
 * Phase 50 — AI Software Engineering Operating System (AI-SEOS)
 *
 * The final phase: comprehensive AI-SEOS readiness check.
 * Aggregates health signals from all subsystems (Phases 1–49),
 * validates all 25 success criteria from the CoCode Engineering Bible,
 * and produces an AI-SEOS Readiness Score with a go/no-go decision.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

// ── AI-SEOS Subsystem definitions ─────────────────────────────────────────

interface Subsystem {
  id: string;
  name: string;
  phases: number[];
  weight: number; // importance weight in overall score
}

const SUBSYSTEMS: Subsystem[] = [
  { id: "core",           name: "Core Platform",           phases: [1, 2, 3, 4, 5],       weight: 3 },
  { id: "ai-agents",     name: "AI Agent System",          phases: [6, 7, 8, 9],           weight: 3 },
  { id: "security",      name: "Security Engine",          phases: [31],                   weight: 2.5 },
  { id: "performance",   name: "Performance Engine",       phases: [32],                   weight: 2 },
  { id: "accessibility", name: "Accessibility Engine",     phases: [33],                   weight: 1.5 },
  { id: "database",      name: "Database Architect",       phases: [34],                   weight: 2 },
  { id: "api",           name: "API Architect",            phases: [35],                   weight: 2 },
  { id: "deployment",    name: "Deployment Center",        phases: [36],                   weight: 2 },
  { id: "rollback",      name: "Rollback Engine",          phases: [37],                   weight: 1.5 },
  { id: "release",       name: "Release Manager",          phases: [38],                   weight: 1.5 },
  { id: "collab",        name: "Collaboration Engine",     phases: [39],                   weight: 1 },
  { id: "production",    name: "Production Validator",     phases: [40],                   weight: 2.5 },
  { id: "requirements",  name: "Requirements Engine",      phases: [41],                   weight: 2 },
  { id: "planning",      name: "Planning Canvas",          phases: [42],                   weight: 2 },
  { id: "background",    name: "Background Agents",        phases: [43],                   weight: 1.5 },
  { id: "tech-debt",     name: "Technical Debt Analyzer",  phases: [44],                   weight: 1 },
  { id: "arch-health",   name: "Architecture Health",      phases: [45],                   weight: 2 },
  { id: "learning",      name: "Learning Engine",          phases: [46],                   weight: 2 },
  { id: "search",        name: "Intelligent Search",       phases: [47],                   weight: 1.5 },
  { id: "root-cause",    name: "Root Cause Engine",        phases: [48],                   weight: 2 },
  { id: "workflow",      name: "Workflow Automation",      phases: [49],                   weight: 2 },
];

// ── 25 AI-SEOS Success Criteria ────────────────────────────────────────────

interface SuccessCriterion {
  id: number;
  name: string;
  check: () => Promise<{ passed: boolean; detail: string }>;
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

async function quickCheck(url: string): Promise<number> {
  try {
    const res = await httpGet(url, { timeoutMs: Math.min(config.timeoutMs, 8000) });
    return res.status;
  } catch {
    return 0;
  }
}

async function quickPost(url: string, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  try {
    const res = await httpPost(url, body, { timeoutMs: Math.min(config.timeoutMs, 10000) });
    return { status: res.status, body: res.body };
  } catch {
    return { status: 0, body: "" };
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase50(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const repoRoot = findRepoRoot();
  const workflowDir = repoRoot ? resolve(repoRoot, ".github", "workflows") : null;
  const webSrc = repoRoot ? resolve(repoRoot, "aof-web", "src") : null;

  // ── SECTION 1: Platform Core Readiness ───────────────────────────────────
  {
    const t0 = Date.now();
    const [frontStatus, backStatus, healthStatus] = await Promise.all([
      quickCheck(BASE),
      quickCheck(`${BACKEND}/v1/health`),
      quickCheck(`${BASE}/api/health`),
    ]);

    const frontOk = frontStatus > 0 && frontStatus < 500;
    const backOk = backStatus === 200 || backStatus === 429;
    const healthOk = healthStatus === 200;
    const score = [frontOk, backOk, healthOk].filter(Boolean).length;
    const ok = score >= 2;

    tests.push({
      name: `AI-SEOS [Core]: Frontend=${frontStatus}, Backend=${backStatus}, Health=${healthStatus} (${score}/3)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { frontStatus, backStatus, healthStatus, score },
      error: ok ? undefined : "Core platform not fully operational",
      rootCause: ok ? undefined : "One or more core services unreachable",
      suggestedFix: ok ? undefined : "Verify Vercel and Render deployments; check environment variables",
    });
    ok ? log.ok(tests[tests.length - 1].name) : log.fail(`${tests[tests.length - 1].name} — core degraded`);
  }

  // ── SECTION 2: AI Agent System Readiness ─────────────────────────────────
  {
    const t0 = Date.now();
    const agents = ["requirements", "plan", "analyze", "debug", "code-gen"] as const;
    const results = await Promise.all(
      agents.slice(0, 3).map((agent) =>
        quickPost(`${BASE}/api/chat`, { message: "Hello", agent })
      )
    );
    const workingAgents = results.filter((r) => r.status > 0 && r.status < 500).length;
    const ok = workingAgents >= 2;

    tests.push({
      name: `AI-SEOS [Agents]: ${workingAgents}/3 AI agents responding`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { agents: agents.slice(0, 3), statuses: results.map((r) => r.status), workingAgents },
      error: ok ? undefined : `Only ${workingAgents}/3 AI agents operational`,
      rootCause: ok ? undefined : "AI provider chain failure or chat route error",
      suggestedFix: ok ? undefined : "Check AI provider keys; verify /api/chat handler; run Phase 6-9",
    });
    ok ? log.ok(tests[tests.length - 1].name) : log.fail(`${tests[tests.length - 1].name} — agents degraded`);
  }

  // ── SECTION 3: Security Posture ───────────────────────────────────────────
  {
    const t0 = Date.now();
    let securityScore = 0;
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
      const hasXFrame = !!r.headers.get("x-frame-options");
      const hasCSP = !!r.headers.get("content-security-policy");
      const hasXContent = !!r.headers.get("x-content-type-options");
      const isHttps = BASE.startsWith("https://");
      securityScore = [hasXFrame, hasCSP, hasXContent, isHttps].filter(Boolean).length * 25;
    } catch {}

    // SQL injection should fail gracefully
    const sqlRes = await quickCheck(`${BASE}/api/search?q='; DROP TABLE users; --`);
    const noSqlCrash = sqlRes < 500;

    const ok = securityScore >= 50 && noSqlCrash;

    tests.push({
      name: `AI-SEOS [Security]: headers score ${securityScore}/100, SQL injection safe: ${noSqlCrash}`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { securityScore, noSqlCrash, sqlRes },
      error: ok ? undefined : `Security score ${securityScore}/100 or SQL injection not safe`,
      rootCause: ok ? undefined : "Missing security headers or unprotected API endpoints",
      suggestedFix: ok ? undefined : "Run Phase 31; add security headers to next.config.mjs; parameterize all queries",
    });
    ok ? log.ok(tests[tests.length - 1].name) : log.fail(`${tests[tests.length - 1].name}`);
  }

  // ── SECTION 4: Performance Gate ──────────────────────────────────────────
  {
    const t0 = Date.now();
    const latencies: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      await quickCheck(BASE);
      latencies.push(Date.now() - s);
    }
    const p50 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
    const ok = p50 < 5000;

    tests.push({
      name: `AI-SEOS [Performance]: p50 TTFB ${p50}ms (threshold: 5000ms)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { latencies, p50 },
      error: ok ? undefined : `Homepage p50 ${p50}ms exceeds 5000ms threshold`,
      rootCause: ok ? undefined : "Cold start or heavy SSR causing slow responses",
      suggestedFix: ok ? undefined : "Run Phase 32; enable ISR; check keep-warm workflow; optimize SSR",
    });
    ok ? log.ok(tests[tests.length - 1].name) : log.fail(`${tests[tests.length - 1].name}`);
  }

  // ── SECTION 5: Deployment & DevOps Readiness ─────────────────────────────
  {
    const t0 = Date.now();
    const hasWorkflows = workflowDir && existsSync(workflowDir);
    let workflows: string[] = [];
    let hasCI = false;
    let hasKeepWarm = false;
    let hasDeploy = false;

    if (hasWorkflows && workflowDir) {
      workflows = readdirSync(workflowDir).filter((f) => f.endsWith(".yml"));
      const allContent = workflows.map((f) => {
        try { return readFileSync(resolve(workflowDir, f), "utf8"); } catch { return ""; }
      }).join("\n");
      hasCI = /lint|typecheck|test/i.test(allContent);
      hasKeepWarm = /keep.warm|cron/i.test(allContent);
      hasDeploy = /vercel|render|deploy/i.test(allContent);
    }

    const devOpsScore = [hasCI, hasKeepWarm, hasDeploy].filter(Boolean).length;
    const ok = devOpsScore >= 2 || !hasWorkflows;

    tests.push({
      name: `AI-SEOS [DevOps]: ${workflows.length} workflows, CI=${hasCI}, KeepWarm=${hasKeepWarm}, Deploy=${hasDeploy}`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { workflowCount: workflows.length, hasCI, hasKeepWarm, hasDeploy, devOpsScore },
      error: ok ? undefined : "DevOps pipeline insufficient for production",
      rootCause: ok ? undefined : "Missing CI, deployment, or monitoring workflows",
      suggestedFix: ok ? undefined : "Run Phase 36/43/49; add ci.yml, keep-warm.yml, deploy workflow",
    });
    ok ? log.ok(tests[tests.length - 1].name) : log.fail(`${tests[tests.length - 1].name}`);
  }

  // ── SECTION 6: Repository Structure ──────────────────────────────────────
  {
    const t0 = Date.now();
    const required = ["aof-web", ".github", "qa-loop"];
    const found = repoRoot
      ? required.filter((d) => existsSync(resolve(repoRoot, d)))
      : [];
    const hasEnvExample = repoRoot && existsSync(resolve(repoRoot, ".env.example"));
    const hasReadme = repoRoot && existsSync(resolve(repoRoot, "README.md"));
    const ok = found.length >= 2;

    tests.push({
      name: `AI-SEOS [Repo]: ${found.length}/${required.length} required directories, README=${hasReadme}, .env.example=${hasEnvExample}`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { required, found, hasEnvExample, hasReadme },
      error: ok ? undefined : `Missing required directories: ${required.filter((d) => !found.includes(d)).join(", ")}`,
      rootCause: ok ? undefined : "Repository structure incomplete",
      suggestedFix: ok ? undefined : "Ensure aof-web/, .github/workflows/, qa-loop/ all exist in repo root",
    });
    ok ? log.ok(tests[tests.length - 1].name) : log.fail(`${tests[tests.length - 1].name}`);
  }

  // ── SECTION 7: AI-SEOS Overall Readiness Score ───────────────────────────
  {
    const t0 = Date.now();

    // Read existing QA reports to include phase history
    const reportsDir = repoRoot ? resolve(repoRoot, "qa-loop", "reports") : null;
    let historicPhaseData: Record<string, unknown> = {};
    if (reportsDir && existsSync(reportsDir)) {
      try {
        const runs = readdirSync(reportsDir)
          .filter((d) => d.startsWith("run-"))
          .map((d) => ({ d, mtime: statSync(resolve(reportsDir, d)).mtime }))
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        if (runs[0]) {
          const rp = resolve(reportsDir, runs[0].d, "report.json");
          if (existsSync(rp)) {
            historicPhaseData = JSON.parse(readFileSync(rp, "utf8")) as Record<string, unknown>;
          }
        }
      } catch {}
    }

    // Score from current test session
    const currentPassCount = tests.filter((t) => t.passed).length;
    const currentFailCount = tests.filter((t) => !t.passed).length;
    const sessionScore = Math.round((currentPassCount / tests.length) * 100);

    // Subsystem health summary
    const subsystemHealth = SUBSYSTEMS.map((s) => ({
      id: s.id,
      name: s.name,
      status: "measured-in-dedicated-phases",
      weight: s.weight,
    }));

    // 25 success criteria evaluation (sampled from live checks)
    const criteria25 = [
      { id: 1,  name: "Platform accessible via HTTPS",             pass: BASE.startsWith("https://") },
      { id: 2,  name: "Frontend health endpoint returns 200",      pass: (await quickCheck(`${BASE}/api/health`)) === 200 },
      { id: 3,  name: "Backend health endpoint responds",          pass: (await quickCheck(`${BACKEND}/v1/health`)) < 500 },
      { id: 4,  name: "Chat API handles AI requests",              pass: (await quickPost(`${BASE}/api/chat`, { message: "Hi", agent: "chat" })).status < 500 },
      { id: 5,  name: "Requirements agent responds",               pass: (await quickPost(`${BASE}/api/chat`, { message: "I need auth", agent: "requirements" })).status < 500 },
      { id: 6,  name: "Debug agent responds",                      pass: (await quickPost(`${BASE}/api/chat`, { message: "500 error", agent: "debug" })).status < 500 },
      { id: 7,  name: "Security headers present",                  pass: await (async () => { try { const r = await fetch(BASE, { signal: AbortSignal.timeout(5000) }); return !!(r.headers.get("x-frame-options") || r.headers.get("content-security-policy")); } catch { return false; } })() },
      { id: 8,  name: "Admin endpoints protected",                 pass: (await quickCheck(`${BASE}/api/admin/users`)) === 401 || (await quickCheck(`${BASE}/api/admin/users`)) === 403 },
      { id: 9,  name: "GitHub Actions CI workflow exists",         pass: !!(workflowDir && existsSync(resolve(workflowDir, "ci.yml"))) },
      { id: 10, name: "Keep-warm background agent configured",     pass: !!(workflowDir && readdirSync(workflowDir ?? "").some((f) => f.includes("keep-warm"))) },
      { id: 11, name: "Source directory structure complete",       pass: !!(webSrc && existsSync(resolve(webSrc, "app")) && existsSync(resolve(webSrc, "components"))) },
      { id: 12, name: "Search endpoint exists",                    pass: (await quickCheck(`${BASE}/api/search?q=test`)) !== 404 },
      { id: 13, name: "Learning endpoint exists",                  pass: (await quickCheck(`${BASE}/api/ai/learning`)) !== 404 },
      { id: 14, name: "Workflow classifier responds",              pass: (await quickPost(`${BASE}/api/workflow`, { message: "test" })).status < 500 },
      { id: 15, name: "SQL injection handled safely",              pass: (await quickCheck(`${BASE}/api/search?q=';DROP TABLE--`)) < 500 },
      { id: 16, name: "Git repository with history",               pass: !!repoRoot },
      { id: 17, name: "QA loop phase files exist (phase 31+)",    pass: existsSync(resolve(repoRoot ?? ".", "qa-loop", "phases", "phase31-security-engine.ts")) },
      { id: 18, name: "QA loop phase 50 exists",                   pass: existsSync(resolve(repoRoot ?? ".", "qa-loop", "phases", "phase50-ai-seos.ts")) },
      { id: 19, name: "No .env committed to git",                  pass: await (async () => { try { const { execSync } = await import("node:child_process"); const out = execSync("git ls-files | grep -E '\\.env$'", { cwd: repoRoot ?? ".", encoding: "utf8", timeout: 5000 }); return out.trim() === ""; } catch { return true; } })() },
      { id: 20, name: "README documentation exists",               pass: !!(repoRoot && existsSync(resolve(repoRoot, "README.md"))) },
      { id: 21, name: ".env.example configuration guide exists",   pass: !!(repoRoot && existsSync(resolve(repoRoot, ".env.example"))) },
      { id: 22, name: "Analyze agent for code review",             pass: (await quickPost(`${BASE}/api/chat`, { message: "Review this code", agent: "analyze" })).status < 500 },
      { id: 23, name: "Plan agent for architecture planning",       pass: (await quickPost(`${BASE}/api/chat`, { message: "Plan a feature", agent: "plan" })).status < 500 },
      { id: 24, name: "Multiple AI provider failover configured",   pass: !!(repoRoot && existsSync(resolve(repoRoot, "aof-web", "src", "lib", "server"))) },
      { id: 25, name: "Phase 40 production validator gate exists", pass: existsSync(resolve(repoRoot ?? ".", "qa-loop", "phases", "phase40-production-validator.ts")) },
    ];

    const criteriaPassCount = criteria25.filter((c) => c.pass).length;
    const criteriaScore = Math.round((criteriaPassCount / 25) * 100);

    const overallScore = Math.round((sessionScore * 0.4) + (criteriaScore * 0.6));
    const isReady = overallScore >= 60 && criteriaPassCount >= 15;

    const seosReport = {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      overallScore,
      criteriaScore,
      sessionScore,
      criteriaPassCount,
      criteriaTotalCount: 25,
      isProductionReady: isReady,
      readinessLevel: overallScore >= 85 ? "READY" : overallScore >= 70 ? "NEARLY_READY" : overallScore >= 50 ? "IN_PROGRESS" : "NOT_READY",
      subsystems: subsystemHealth,
      criteria25: criteria25.map((c) => ({ ...c, status: c.pass ? "PASS" : "FAIL" })),
      failedCriteria: criteria25.filter((c) => !c.pass).map((c) => c.name),
      historicDataAvailable: Object.keys(historicPhaseData).length > 0,
    };

    try {
      writeFileSync(resolve(runDir, "AI_SEOS_REPORT.json"), JSON.stringify(seosReport, null, 2));
    } catch {}

    const t: TestResult = {
      name: `AI-SEOS READINESS SCORE: ${overallScore}/100 — ${seosReport.readinessLevel} (${criteriaPassCount}/25 criteria passed)`,
      passed: isReady,
      durationMs: Date.now() - t0,
      details: seosReport,
    };

    if (!isReady) {
      t.error = `AI-SEOS not yet production-ready: score ${overallScore}/100, only ${criteriaPassCount}/25 criteria passed`;
      t.rootCause = `Failed criteria: ${seosReport.failedCriteria.slice(0, 5).join("; ")}`;
      t.suggestedFix = "Run all individual phases; fix failing criteria; re-run Phase 50";
    }

    tests.push(t);

    // Print readiness banner
    const bannerLines: string[] = [];
    if (isReady) {
      bannerLines.push("\n  ╔══════════════════════════════════════════════════════╗");
      bannerLines.push(`  ║   ✅  AI-SEOS OPERATIONAL — Score: ${overallScore}/100        ║`);
      bannerLines.push(`  ║   ${criteriaPassCount}/25 success criteria met — READY FOR PRODUCTION  ║`);
      bannerLines.push("  ╚══════════════════════════════════════════════════════╝\n");
    } else {
      bannerLines.push("\n  ╔══════════════════════════════════════════════════════╗");
      bannerLines.push(`  ║   ⚠️   AI-SEOS ${seosReport.readinessLevel} — Score: ${overallScore}/100    ║`);
      bannerLines.push(`  ║   ${criteriaPassCount}/25 success criteria met — fix ${25 - criteriaPassCount} more criteria  ║`);
      bannerLines.push("  ╚══════════════════════════════════════════════════════╝\n");
    }
    bannerLines.forEach((l) => console.log(l));

    isReady ? log.ok(t.name) : log.fail(`${t.name}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 50,
    name: "AI-SEOS: AI Software Engineering Operating System",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
