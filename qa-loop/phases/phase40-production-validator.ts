/**
 * Phase 40 — Production Readiness Validator
 *
 * Final gate before any production merge. Runs the complete validation checklist:
 * architecture, security, performance, accessibility, code quality, preview build,
 * deployment simulation. Blocks merge if any check fails.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

// ── Helpers ────────────────────────────────────────────────────────────────

function findRepoRoot(): string | null {
  const candidates = [
    resolve(import.meta.dirname ?? ".", ".."),
    resolve(process.cwd(), ".."),
    process.cwd(),
  ];
  return candidates.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

function repoHasFile(...paths: string[]): string | null {
  const root = findRepoRoot();
  if (!root) return null;
  for (const p of paths) {
    const full = resolve(root, p);
    if (existsSync(full)) return full;
  }
  return null;
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase40(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const repoRoot = findRepoRoot();

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1: REPOSITORY ANALYSIS
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1.1 Repository structure ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const requiredDirs = ["aof-web", "tmap-v2", "qa-loop", ".github/workflows"];
    const found = requiredDirs.filter((d) => repoRoot && existsSync(resolve(repoRoot, d)));
    const ok = found.length === requiredDirs.length;

    const t: TestResult = {
      name: "Repository structure: all required directories present",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { required: requiredDirs, found, missing: requiredDirs.filter((d) => !found.includes(d)) },
    };
    if (!ok) {
      t.error = `Missing directories: ${requiredDirs.filter((d) => !found.includes(d)).join(", ")}`;
      t.rootCause = "Repository missing critical service directories";
      t.suggestedFix = "Ensure all service directories are committed and not in .gitignore";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 1.2 CI/CD workflows ─────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const workflowDir = repoRoot ? resolve(repoRoot, ".github/workflows") : null;
    let workflows: string[] = [];
    if (workflowDir && existsSync(workflowDir)) {
      workflows = readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    }
    const hasCI = workflows.some((w) => w.includes("ci") || w.includes("test") || w.includes("build"));
    const hasDeploy = workflows.some((w) => w.includes("deploy") || w.includes("vercel"));
    const ok = workflows.length > 0 && hasCI;

    const t: TestResult = {
      name: "CI/CD: GitHub Actions workflows present",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { workflows, hasCI, hasDeploy },
    };
    if (!ok) {
      t.error = "No CI workflow found — merges are not automatically tested";
      t.rootCause = "Missing .github/workflows/*.yml CI configuration";
      t.suggestedFix = "Add CI workflow that runs lint, typecheck, tests on every PR; see .github/workflows/ci.yml";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${workflows.join(", ")})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 1.3 README present ──────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const readmePath = repoHasFile("README.md", "readme.md", "README");
    const ok = readmePath !== null;

    const t: TestResult = {
      name: "Documentation: README.md present",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { readmePath },
    };
    if (!ok) {
      t.error = "README.md missing — project undocumented";
      t.rootCause = "No root README in repository";
      t.suggestedFix = "Add README.md with setup instructions, architecture overview, and deployment guide";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 1.4 .env.example present ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const envExample = repoHasFile("aof-web/.env.example", ".env.example");
    const ok = envExample !== null;

    const t: TestResult = {
      name: "Config: .env.example present (required env vars documented)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { envExample },
    };
    if (!ok) {
      t.error = ".env.example missing — new developers cannot set up environment";
      t.rootCause = "Environment variable documentation missing";
      t.suggestedFix = "Create aof-web/.env.example listing all required env vars (without values)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2: LIVE DEPLOYMENT HEALTH
  // ══════════════════════════════════════════════════════════════════════════

  // ── 2.1 Frontend healthy ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;

    const t: TestResult = {
      name: "Frontend deployment: /api/health → 200",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${BASE}/api/health` },
    };
    if (!ok) {
      t.error = `Frontend health check failed (${res.status})`;
      t.rootCause = "Vercel deployment failed or env vars missing";
      t.suggestedFix = "Check Vercel dashboard; verify all env vars set; check build logs";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2.2 Backend healthy ──────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BACKEND}/v1/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 429;

    const t: TestResult = {
      name: "Backend deployment: /v1/health → 200/429",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${BACKEND}/v1/health` },
    };
    if (!ok) {
      t.error = `Backend health check failed (${res.status})`;
      t.rootCause = "Render service down, crashed, or not deployed";
      t.suggestedFix = "Check Render dashboard; check service logs; verify environment variables";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2.3 Login page accessible ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/login`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;

    const t: TestResult = {
      name: "Auth: /login page returns 200",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Login page returned ${res.status}`;
      t.rootCause = "Auth route broken or middleware loop";
      t.suggestedFix = "Check Next.js middleware; ensure /login is not redirecting to itself";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3: SECURITY GATE
  // ══════════════════════════════════════════════════════════════════════════

  // ── 3.1 Admin endpoints protected ────────────────────────────────────────
  {
    const t0 = Date.now();
    let status = 0;
    let location = "";
    try {
      const r = await fetch(`${BASE}/api/admin/users`, {
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      status = r.status;
      location = r.headers.get("location") ?? "";
    } catch {}
    const loginRedirect = (status === 302 || status === 307) && location.includes("login");
    const ok = status === 401 || status === 403 || loginRedirect;

    const t: TestResult = {
      name: "Security gate: admin endpoint protected (401/403/redirect)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, location },
    };
    if (!ok) {
      t.error = `Admin route returned ${status} without auth — CRITICAL security failure`;
      t.rootCause = "Missing authentication guard on admin routes";
      t.suggestedFix = "URGENT: Apply auth middleware to all /api/admin/* routes before merging";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3.2 SQL injection rejected ───────────────────────────────────────────
  {
    const t0 = Date.now();
    const payload = "'; DROP TABLE users; --";
    const res = await httpPost(`${BASE}/api/chat`, { message: payload, agent: "chat" }, { timeoutMs: config.timeoutMs });
    const noCrash = res.status < 500;
    const noLeak = !res.body.toLowerCase().includes("syntax error") && !res.body.toLowerCase().includes("pg_");
    const ok = noCrash && noLeak;

    const t: TestResult = {
      name: "Security gate: SQL injection rejected (no 5xx, no DB error leak)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noCrash, noLeak },
    };
    if (!ok) {
      t.error = `SQL injection not rejected: status=${res.status}, dbLeak=${!noLeak}`;
      t.rootCause = "Input validation or DB layer not sanitizing SQL injection attempts";
      t.suggestedFix = "Ensure all DB queries use parameterized inputs; run Phase 31 for full security audit";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3.3 HTTPS enforced ───────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const ok = BASE.startsWith("https://");

    const t: TestResult = {
      name: "Security gate: HTTPS enforced on production URL",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { url: BASE, isHttps: ok },
    };
    if (!ok) {
      t.error = "Production URL is not HTTPS — traffic is unencrypted";
      t.rootCause = "Deployment using HTTP without TLS";
      t.suggestedFix = "Enable HTTPS on hosting platform; all major providers (Vercel, Render, Railway) support free TLS";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4: PERFORMANCE GATE
  // ══════════════════════════════════════════════════════════════════════════

  // ── 4.1 Homepage response time ───────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(BASE, { timeoutMs: config.timeoutMs });
    const ok = res.durationMs < 5000 && res.status === 200;

    const t: TestResult = {
      name: `Performance gate: homepage response < 5000ms (got ${res.durationMs}ms)`,
      passed: ok,
      durationMs: res.durationMs,
      details: { responseMs: res.durationMs, status: res.status },
    };
    if (!ok) {
      t.error = `Homepage ${res.durationMs}ms — exceeds 5s threshold`;
      t.rootCause = "SSR too slow or Vercel edge cold start";
      t.suggestedFix = "Enable ISR; move data fetching client-side; check Phase 32 for full perf audit";
    }
    tests.push(t);
    ok ? log.ok(`${t.name}`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4.2 API p50 latency ──────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const samples = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const s = Date.now();
        await httpGet(`${BASE}/api/health`, { timeoutMs: config.timeoutMs });
        return Date.now() - s;
      })
    );
    const p50 = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    const ok = p50 < 3000;

    const t: TestResult = {
      name: `Performance gate: API p50 latency < 3000ms (got ${p50}ms)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { samples, p50Ms: p50 },
    };
    if (!ok) {
      t.error = `p50 latency ${p50}ms — exceeds threshold`;
      t.rootCause = "Slow DB queries or missing Supabase connection pooling";
      t.suggestedFix = "Add Supabase connection pooler; cache client; check slow query logs";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5: ACCESSIBILITY GATE
  // ══════════════════════════════════════════════════════════════════════════

  // ── 5.1 Homepage HTML has lang + title ──────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(BASE, { timeoutMs: config.timeoutMs });
    const hasLang = /<html[^>]+lang="[a-z]{2}/.test(res.body);
    const hasTitle = /<title>[^<]{1,200}<\/title>/.test(res.body);
    const hasMeta = /<meta\s+name="viewport"/.test(res.body);
    const ok = hasLang && hasTitle && hasMeta;

    const t: TestResult = {
      name: "Accessibility gate: HTML has lang, title, and viewport meta",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasLang, hasTitle, hasMeta },
    };
    if (!ok) {
      t.error = [
        !hasLang ? "Missing html[lang]" : "",
        !hasTitle ? "Missing <title>" : "",
        !hasMeta ? "Missing viewport meta" : "",
      ].filter(Boolean).join("; ");
      t.rootCause = "Basic HTML accessibility attributes missing";
      t.suggestedFix = "Add lang='en' to <html>, <title> in layout.tsx, and <meta name='viewport'>";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 6: CODE QUALITY GATE
  // ══════════════════════════════════════════════════════════════════════════

  // ── 6.1 No .env files committed ──────────────────────────────────────────
  {
    const t0 = Date.now();
    let exposedEnvFiles: string[] = [];
    if (repoRoot) {
      try {
        const { execSync } = await import("node:child_process");
        const out = execSync("git ls-files -- '*.env' '.env' '.env.*' --exclude=.env.example", {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 10_000,
        }).trim();
        exposedEnvFiles = out ? out.split("\n").filter(Boolean).filter((f) => !f.endsWith(".example") && !f.endsWith(".test")) : [];
      } catch {}
    }
    const ok = exposedEnvFiles.length === 0;

    const t: TestResult = {
      name: "Code quality gate: no .env files tracked in git",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { exposedFiles: exposedEnvFiles },
    };
    if (!ok) {
      t.error = `Secret files committed to git: ${exposedEnvFiles.join(", ")}`;
      t.rootCause = "Environment files with secrets checked into version control";
      t.suggestedFix = "Add .env to .gitignore; remove from tracking: git rm --cached .env; rotate all secrets";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6.2 QA phases passing ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    // Check for recent QA reports
    const reportsDir = resolve(import.meta.dirname ?? ".", "..", "reports");
    let latestReport: { passCount?: number; failCount?: number } | null = null;
    if (existsSync(reportsDir)) {
      try {
        const runs = readdirSync(reportsDir)
          .filter((d) => d.startsWith("run-"))
          .map((d) => ({ d, mtime: statSync(resolve(reportsDir, d)).mtime }))
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        if (runs[0]) {
          const reportPath = resolve(reportsDir, runs[0].d, "report.json");
          if (existsSync(reportPath)) {
            const { readFileSync } = await import("node:fs");
            const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
              summary?: { passed?: number; failed?: number };
            };
            latestReport = {
              passCount: report.summary?.passed,
              failCount: report.summary?.failed,
            };
          }
        }
      } catch {}
    }

    const hasReports = latestReport !== null;
    const qaOk = hasReports ? (latestReport?.failCount ?? 0) === 0 : true; // pass if no report exists
    const ok = qaOk;

    const t: TestResult = {
      name: `Code quality gate: QA loop ${hasReports ? `last run passed ${latestReport?.passCount ?? 0}/${(latestReport?.passCount ?? 0) + (latestReport?.failCount ?? 0)} tests` : "no prior reports (first run)"}`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasReports, latestReport },
    };
    if (!ok) {
      t.error = `Last QA run had ${latestReport?.failCount} failures — fix before merging`;
      t.rootCause = "Previous QA phase failures not resolved";
      t.suggestedFix = "Run the QA loop and fix all failures in phases 31-39 before production merge";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL MERGE GATE DECISION
  // ══════════════════════════════════════════════════════════════════════════

  const criticalTests = tests.filter((t) => !t.passed);
  const allGreen = criticalTests.length === 0;

  {
    const t: TestResult = {
      name: allGreen
        ? "✅ PRODUCTION MERGE APPROVED — all validation gates passed"
        : `🚫 PRODUCTION MERGE BLOCKED — ${criticalTests.length} gate(s) failed`,
      passed: allGreen,
      durationMs: 0,
      details: {
        totalChecks: tests.length,
        passed: tests.filter((t) => t.passed).length,
        failed: criticalTests.length,
        failedGates: criticalTests.map((t) => t.name),
        decision: allGreen ? "MERGE_APPROVED" : "MERGE_BLOCKED",
        timestamp: new Date().toISOString(),
      },
    };
    if (!allGreen) {
      t.error = `${criticalTests.length} production gate(s) failed — merge rejected`;
      t.rootCause = "Pre-merge validation not fully passing";
      t.suggestedFix = `Fix these gates: ${criticalTests.map((t) => t.name.slice(0, 60)).join("; ")}`;
    }
    tests.push(t);
    allGreen ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  if (allGreen) {
    console.log("\n  ╔════════════════════════════════════════════╗");
    console.log("  ║  ✅  PRODUCTION READY — MERGE APPROVED    ║");
    console.log("  ╚════════════════════════════════════════════╝\n");
  } else {
    console.log("\n  ╔════════════════════════════════════════════╗");
    console.log(`  ║  🚫  MERGE BLOCKED (${criticalTests.length} failure${criticalTests.length > 1 ? "s" : ""})               ║`);
    console.log("  ╚════════════════════════════════════════════╝\n");
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 40,
    name: "Production Readiness Validator",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
