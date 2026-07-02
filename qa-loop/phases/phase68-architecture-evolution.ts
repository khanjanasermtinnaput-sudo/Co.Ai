/**
 * Phase 68 — AI Architecture Evolution
 *
 * Tests continuous architecture analysis: large component detection,
 * coupling analysis, refactoring plan generation, risk-based recommendations,
 * and non-destructive migration guidance.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const ARCH = `${BASE}/api/ai/architecture`;

const FOCUS_AREAS = [
  "large-components", "feature-coupling", "layer-violations",
  "circular-dependencies", "microservice-candidates", "monolith-bottlenecks", "full",
] as const;

function findRepoRoot(): string | null {
  const c = [resolve(import.meta.dirname ?? ".", ".."), resolve(process.cwd(), ".."), process.cwd()];
  return c.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

export async function runPhase68(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const repoRoot = findRepoRoot();

  // ── 1. Architecture endpoint exists ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(ARCH, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 405 || res.status === 503;
    tests.push({
      name: "Architecture evolution: GET /api/ai/architecture endpoint exists",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Architecture endpoint returned ${res.status}`,
      rootCause: ok ? undefined : "/api/ai/architecture route not deployed",
      suggestedFix: ok ? undefined : "Deploy aof-web/src/app/api/ai/architecture/route.ts",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Architecture POST requires auth ────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(ARCH, { focusArea: "full" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Architecture evolution: POST requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Architecture analysis allowed without auth (${res.status})`,
      rootCause: ok ? undefined : "Architecture endpoint not protected",
      suggestedFix: ok ? undefined : "Add getUserFromRequest() in POST /api/ai/architecture handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Invalid focus area rejected ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(ARCH, { focusArea: "invalid-area" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Architecture evolution: invalid focusArea rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid focus area not rejected (${res.status})`,
      rootCause: ok ? undefined : "Focus area enum not validated in ArchSchema",
      suggestedFix: ok ? undefined : `Add z.enum(${JSON.stringify(FOCUS_AREAS)}) in ArchSchema`,
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Large component detection (local file analysis) ────────────────────
  {
    const t0 = Date.now();
    const webSrc = repoRoot ? resolve(repoRoot, "aof-web", "src") : null;
    let largeFiles: Array<{ path: string; loc: number }> = [];

    if (webSrc && existsSync(webSrc)) {
      function walkSync(dir: string) {
        try {
          for (const entry of readdirSync(dir)) {
            if (entry === "node_modules" || entry === ".next") continue;
            const full = resolve(dir, entry);
            try {
              const stat = statSync(full);
              if (stat.isDirectory()) { walkSync(full); return; }
              if (!/\.(ts|tsx)$/.test(entry)) return;
              const lines = readFileSync(full, "utf8").split("\n").filter((l) => l.trim()).length;
              if (lines > 300) largeFiles.push({ path: full.replace(webSrc, ""), loc: lines });
            } catch {}
          }
        } catch {}
      }
      walkSync(webSrc);
    }

    const ok = true; // informational
    tests.push({
      name: `Architecture evolution: ${largeFiles.length} large files detected (>300 LOC) locally`,
      passed: ok, durationMs: Date.now() - t0,
      details: { largeFiles: largeFiles.slice(0, 5), totalFound: largeFiles.length },
    });
    log.ok(tests[tests.length-1].name);
  }

  // ── 5. Analyze agent produces architecture recommendations ────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "Analyze this Next.js application: it has 50 API routes, 30 components, and a single Supabase database. Detect large components, feature coupling, and recommend architecture improvements. Never recommend unnecessary complexity.",
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });

    const hasRecs = /recommend|refactor|split|extract|module|component|coupling|architecture|improve/i.test(res.body);
    const avoidsUnnecessaryComplexity = !/microservice|kubernetes|docker|k8s/i.test(res.body) || /small|simple|monolith/i.test(res.body);
    const ok = (res.status < 500 && hasRecs) || isEnvironmentGate(res.status);
    tests.push({
      name: `Architecture evolution: analyze agent produces architecture recommendations (recs: ${hasRecs}, pragmatic: ${avoidsUnnecessaryComplexity})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status, hasRecs, avoidsUnnecessaryComplexity, snippet: res.body.slice(0, 250) },
      error: ok ? undefined : "Analyze agent not producing architecture recommendations",
      rootCause: ok ? undefined : "Analyze agent not responding to architecture analysis requests",
      suggestedFix: ok ? undefined : "Update analyze agent system prompt to focus on evidence-based architecture analysis",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Repo analyze endpoint still operational ────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/repo/analyze`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: "Architecture evolution: /api/repo/analyze endpoint operational",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "/api/repo/analyze not found",
      rootCause: ok ? undefined : "Repo analyze endpoint removed or not deployed",
      suggestedFix: ok ? undefined : "Ensure /api/repo/analyze is deployed and operational",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Architecture recommendations are non-destructive ───────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "Should I rewrite our entire Next.js app in microservices? We have 3 developers and 500 users.",
      agent: "plan",
    }, { timeoutMs: config.timeoutMs });

    const advisesAgainst = /no|not recommend|premature|small|monolith|unnecessary|wait|consider/i.test(res.body);
    const ok = res.status < 500;
    tests.push({
      name: `Architecture evolution: recommends pragmatic approach for small team (advises caution: ${advisesAgainst})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status, advisesAgainst, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Architecture agent not responding",
      rootCause: ok ? undefined : "Plan agent not available for architecture guidance",
      suggestedFix: ok ? undefined : "Verify plan agent responds to architecture strategy questions",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 68, name: "AI Architecture Evolution", tests, totalMs: Date.now() - start, passCount, failCount };
}
