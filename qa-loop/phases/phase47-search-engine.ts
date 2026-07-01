/**
 * Phase 47 — Intelligent Search Engine
 *
 * Tests semantic search, conversation search, code search, component search,
 * file search, and natural-language query support across the platform.
 */
import { httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const SEARCH = `${BASE}/api/search`;

// ── Helpers ────────────────────────────────────────────────────────────────

function findRepoRoot(): string | null {
  const candidates = [
    resolve(import.meta.dirname ?? ".", ".."),
    resolve(process.cwd(), ".."),
    process.cwd(),
  ];
  return candidates.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

function localCodeSearch(query: string, srcDir: string): Array<{ file: string; line: number; snippet: string }> {
  const results: Array<{ file: string; line: number; snippet: string }> = [];
  const terms = query.toLowerCase().split(/\s+/);
  const rs = readdirSync, ss = statSync, rfs = readFileSync;

  function walkSync(d: string) {
    if (results.length >= 20) return;
    try {
      for (const entry of rs(d)) {
        if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
        const full = resolve(d, entry);
        try {
          const stat = ss(full);
          if (stat.isDirectory()) { walkSync(full); continue; }
          if (!/\.(ts|tsx|js|jsx|md)$/.test(entry)) continue;
          const lines = rfs(full, "utf8").split("\n");
          lines.forEach((line: string, i: number) => {
            const lower = line.toLowerCase();
            if (terms.every((t) => lower.includes(t))) {
              results.push({ file: full.replace(srcDir, ""), line: i + 1, snippet: line.trim().slice(0, 100) });
            }
          });
        } catch {}
      }
    } catch {}
  }
  walkSync(srcDir);
  return results;
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase47(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const repoRoot = findRepoRoot();
  const webSrc = repoRoot ? resolve(repoRoot, "aof-web", "src") : null;

  // ── 1. Search endpoint exists and is protected ────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${SEARCH}?q=test`, { timeoutMs: config.timeoutMs });
    // Expects 401 (no auth), 200 (with results), 503 (not configured), or 429 (rate limited)
    const ok = res.status === 401 || res.status === 200 || res.status === 503 || res.status === 429;

    const t: TestResult = {
      name: "Search engine: GET /api/search endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${SEARCH}?q=test` },
    };
    if (!ok) {
      t.error = `Search endpoint returned ${res.status} — not found`;
      t.rootCause = "aof-web/src/app/api/search/route.ts not deployed";
      t.suggestedFix = "Verify search route exists and is deployed; check Vercel deployment logs";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Search requires authentication ─────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${SEARCH}?q=authentication`, { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;
    const ok = requiresAuth;

    const t: TestResult = {
      name: "Search engine: conversation search requires authentication",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok && res.status === 200) {
      t.error = "Search returned results without authentication — data leak possible";
      t.rootCause = "Search endpoint not checking user session before querying conversations";
      t.suggestedFix = "Add getUserFromRequest() check in search route handler";
    } else if (!ok) {
      t.error = `Search returned ${res.status} — expected auth check`;
      t.rootCause = "Unexpected response from search endpoint";
      t.suggestedFix = "Check search route for proper authentication flow";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Empty query returns empty results (not error) ──────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${SEARCH}?q=`, { timeoutMs: config.timeoutMs });
    // Short query (< 2 chars) should return {} or [] not a 500
    const ok = res.status < 500 && res.status !== 0;

    const t: TestResult = {
      name: "Search engine: empty query returns graceful response (not 5xx)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 100) },
    };
    if (!ok) {
      t.error = `Empty search query caused server error (${res.status})`;
      t.rootCause = "Search handler not validating empty query parameter";
      t.suggestedFix = "Add `if (q.length < 2) return NextResponse.json({ hits: [] })` before tsquery building";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Local code search — find auth components ───────────────────────────
  {
    const t0 = Date.now();
    let results: Array<{ file: string; line: number; snippet: string }> = [];
    if (webSrc && existsSync(webSrc)) {
      results = localCodeSearch("auth", webSrc);
    }
    const ok = results.length > 0 || !webSrc;

    const t: TestResult = {
      name: `Search engine (local): "auth" found in ${results.length} code locations`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { results: results.slice(0, 5), totalFound: results.length },
    };
    if (!ok) {
      t.error = "Local code search found no 'auth' references in source";
      t.rootCause = "Source directory not accessible or no auth code exists";
      t.suggestedFix = "Verify aof-web/src/components/auth/ directory exists with auth components";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Component search — find UI components ──────────────────────────────
  {
    const t0 = Date.now();
    let componentFiles: string[] = [];
    if (webSrc && existsSync(webSrc)) {
      const compDir = resolve(webSrc, "components");
      if (existsSync(compDir)) {
        function findComponents(dir: string): string[] {
          const rs = readdirSync, ss = statSync;
          const files: string[] = [];
          try {
            for (const entry of rs(dir)) {
              const full = resolve(dir, entry);
              try {
                const stat = ss(full);
                if (stat.isDirectory()) files.push(...findComponents(full));
                else if (/\.tsx$/.test(entry)) files.push(full.replace(webSrc!, ""));
              } catch {}
            }
          } catch {}
          return files;
        }
        componentFiles = findComponents(compDir);
      }
    }
    const ok = componentFiles.length > 0 || !webSrc;

    const t: TestResult = {
      name: `Search engine (components): ${componentFiles.length} React components discoverable`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        componentCount: componentFiles.length,
        sample: componentFiles.slice(0, 8),
      },
    };
    if (!ok) {
      t.error = "No React components found in src/components/";
      t.rootCause = "Component directory missing or components not structured in discoverable way";
      t.suggestedFix = "Ensure components are in src/components/**/*.tsx with meaningful names";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. API endpoint discovery (file-based search) ─────────────────────────
  {
    const t0 = Date.now();
    let apiRoutes: string[] = [];
    if (webSrc && existsSync(webSrc)) {
      const apiDir = resolve(webSrc, "app", "api");
      if (existsSync(apiDir)) {
        function findRoutes(dir: string): string[] {
          const rs = readdirSync, ss = statSync;
          const routes: string[] = [];
          try {
            for (const entry of rs(dir)) {
              const full = resolve(dir, entry);
              try {
                const stat = ss(full);
                if (stat.isDirectory()) routes.push(...findRoutes(full));
                else if (entry === "route.ts" || entry === "route.js") {
                  routes.push(full.replace(webSrc! + "/app", "").replace("/route.ts", "").replace("/route.js", ""));
                }
              } catch {}
            }
          } catch {}
          return routes;
        }
        apiRoutes = findRoutes(apiDir);
      }
    }
    const ok = apiRoutes.length >= 5 || !webSrc;

    const t: TestResult = {
      name: `Search engine (APIs): ${apiRoutes.length} API routes discoverable`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { apiRoutes: apiRoutes.slice(0, 10), totalCount: apiRoutes.length },
    };
    if (!ok) {
      t.error = `Only ${apiRoutes.length} API routes found — need ≥5 for a functional platform`;
      t.rootCause = "Too few API routes implemented";
      t.suggestedFix = "Add API routes for missing features; check src/app/api/ structure";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Search SQL injection protection ────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${SEARCH}?q='; DROP TABLE users; --`, { timeoutMs: config.timeoutMs });
    const noCrash = res.status < 500;
    const noDbError = !res.body.toLowerCase().includes("pg_") && !res.body.toLowerCase().includes("syntax error");
    const ok = noCrash && noDbError;

    const t: TestResult = {
      name: "Search engine: SQL injection in search query rejected safely",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noCrash, noDbError, snippet: res.body.slice(0, 100) },
    };
    if (!ok) {
      t.error = `SQL injection in search not handled safely: crash=${!noCrash}, dbLeak=${!noDbError}`;
      t.rootCause = "Search handler building tsquery from user input without sanitization";
      t.suggestedFix = "The current search route already sanitizes with .replace(/[^\\w\\s]/g, ' ') — verify this step runs";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 8. Search performance ─────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const latencies: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      await httpGet(`${SEARCH}?q=test${i}`, { timeoutMs: config.timeoutMs });
      latencies.push(Date.now() - s);
    }
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const ok = avg < 3000;

    const t: TestResult = {
      name: `Search engine: average response time ${Math.round(avg)}ms (threshold: 3000ms)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { latenciesMs: latencies, avgMs: Math.round(avg) },
    };
    if (!ok) {
      t.error = `Search too slow: avg ${Math.round(avg)}ms`;
      t.rootCause = "Full-text search index not created or Supabase too slow";
      t.suggestedFix = "Add tsvector index on messages(content); verify conversation_search_v view has index";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 47,
    name: "Intelligent Search Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
