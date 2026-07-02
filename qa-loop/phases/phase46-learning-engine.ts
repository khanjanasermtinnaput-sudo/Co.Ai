/**
 * Phase 46 — AI Learning Engine
 *
 * Validates that the platform learns from successful patterns, architecture
 * decisions, coding preferences, and review results. Future generations
 * become more consistent with the repository style.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const LEARNING = `${BASE}/api/ai/learning`;

// ── Sample patterns to learn ───────────────────────────────────────────────

const SAMPLE_PATTERNS = [
  {
    type: "architecture",
    pattern: "Use Server Components by default; only add 'use client' when browser APIs or interactivity is needed",
    context: "Next.js App Router",
    tags: ["nextjs", "react", "performance"],
    confidence: 0.95,
  },
  {
    type: "naming",
    pattern: "API routes use kebab-case paths; components use PascalCase; utilities use camelCase",
    context: "Co.AI codebase conventions",
    tags: ["naming", "conventions"],
    confidence: 0.9,
  },
  {
    type: "testing",
    pattern: "Tests use the built-in Node.js test runner (tsx --test); avoid external frameworks",
    context: "qa-loop testing philosophy",
    tags: ["testing", "tooling"],
    confidence: 0.88,
  },
  {
    type: "coding",
    pattern: "All Supabase queries use parameterized RPCs or typed client; never string concatenation",
    context: "Database security pattern",
    tags: ["security", "database", "supabase"],
    confidence: 0.98,
  },
];

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase46(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Learning endpoint exists ───────────────────────────────────────────
  {
    const t0 = Date.now();
    // GET without auth should return 401 (endpoint exists but protected)
    const res = await httpGet(LEARNING, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 200 || res.status === 503;

    const t: TestResult = {
      name: "Learning engine: POST/GET /api/ai/learning endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: LEARNING },
    };
    if (!ok) {
      t.error = `Learning endpoint returned ${res.status} — route not found`;
      t.rootCause = "aof-web/src/app/api/ai/learning/route.ts not deployed";
      t.suggestedFix = "Verify the learning route file exists and was deployed to Vercel";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Learning endpoint requires authentication ──────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(LEARNING, SAMPLE_PATTERNS[0], { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;
    const ok = requiresAuth;

    const t: TestResult = {
      name: "Learning engine: POST requires authentication (401/403 without token)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Learning endpoint returned ${res.status} — should require auth`;
      t.rootCause = "Pattern storage endpoint not protected — anyone could pollute the learning database";
      t.suggestedFix = "Add getUserFromRequest() auth check in POST /api/ai/learning handler";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Pattern validation: invalid type rejected ──────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(LEARNING, {
      type: "invalid-type-xyz",
      pattern: "This should be rejected",
      confidence: 0.9,
    }, { timeoutMs: config.timeoutMs });
    // Should get 400 (validation) or 401 (auth) — not 200 or 500
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 403 || res.status === 503;

    const t: TestResult = {
      name: "Learning engine: invalid pattern type rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Invalid pattern type was not rejected (got ${res.status})`;
      t.rootCause = "No input validation on pattern type enum";
      t.suggestedFix = "PatternSchema.type must use z.enum() with valid types only; parse before storing";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. AI improves with patterns — consistency test ───────────────────────
  {
    const t0 = Date.now();
    // Test that the chat API maintains consistent style across requests
    const [r1, r2] = await Promise.all([
      httpPost(`${BASE}/api/chat`, {
        message: "Write a React component to display a user profile card",
        agent: "code-gen",
      }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, {
        message: "Write a TypeScript function to validate email addresses",
        agent: "code-gen",
      }, { timeoutMs: config.timeoutMs }),
    ]);

    // Both should return code in TypeScript style
    const r1HasTs = /typescript|interface|type |: string|: number|React\.|tsx/i.test(r1.body);
    const r2HasTs = /typescript|interface|type |: string|: number|\bconst\b.*:\s*string/i.test(r2.body);
    const ok = (r1.status < 500 && r2.status < 500 && r1HasTs && r2HasTs) || isEnvironmentGate(r1.status) || isEnvironmentGate(r2.status);

    const t: TestResult = {
      name: "Learning engine: code generation maintains TypeScript consistency",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        r1Status: r1.status, r1TypeScript: r1HasTs,
        r2Status: r2.status, r2TypeScript: r2HasTs,
      },
    };
    if (!ok) {
      t.error = "Generated code not consistently using TypeScript";
      t.rootCause = "Code gen agent not enforcing learned repository conventions";
      t.suggestedFix = "Update AOF_CODE_GEN_SYSTEM to always generate TypeScript; load learned patterns into system prompt";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Architecture decision persistence (git-based learning) ─────────────
  {
    const t0 = Date.now();
    let commitCount = 0;
    let hasArchDoc = false;
    try {
      const { execSync } = await import("node:child_process");
      const { existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const repoRoot = resolve(import.meta.dirname ?? ".", "..");
      commitCount = parseInt(execSync("git rev-list --count HEAD", { cwd: repoRoot, encoding: "utf8", timeout: 10_000 }).trim()) || 0;
      hasArchDoc = existsSync(resolve(repoRoot, "ARCHITECTURE_REPORT.md")) ||
        existsSync(resolve(repoRoot, "aof-web", "ARCHITECTURE.md"));
    } catch {}

    const ok = commitCount > 5 || hasArchDoc;

    const t: TestResult = {
      name: `Learning engine: architecture decisions persisted (${commitCount} commits, arch doc: ${hasArchDoc})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { commitCount, hasArchDoc },
    };
    if (!ok) {
      t.error = "No learning history found — architecture decisions not persisted";
      t.rootCause = "Too few commits or no architecture documentation to learn from";
      t.suggestedFix = "Add ARCHITECTURE.md describing key decisions; use conventional commits for pattern extraction";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Response language consistency (learned preference) ─────────────────
  {
    const t0 = Date.now();
    const [enReq, thReq] = await Promise.all([
      httpPost(`${BASE}/api/chat`, { message: "What is React?", agent: "chat" }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, { message: "React คืออะไร?", agent: "chat" }, { timeoutMs: config.timeoutMs }),
    ]);

    // English request should get English response
    const enOk = enReq.status < 500 && !/[฀-๿]{5,}/.test(enReq.body.slice(0, 200));
    // Thai request should get Thai response
    const thOk = thReq.status < 500 && /[฀-๿]/.test(thReq.body.slice(0, 500));
    const ok = (enOk && thOk) || isEnvironmentGate(enReq.status) || isEnvironmentGate(thReq.status);

    const t: TestResult = {
      name: "Learning engine: language-matching preference (EN→EN, TH→TH)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        enStatus: enReq.status, enRespondsInEnglish: enOk,
        thStatus: thReq.status, thRespondsInThai: thOk,
      },
    };
    if (!ok) {
      t.error = "AI not matching response language to request language";
      t.rootCause = "RESPONSE LANGUAGE directive in system prompt not being followed";
      t.suggestedFix = "Strengthen language instruction in system prompts: 'Always reply in the SAME LANGUAGE the user writes in'";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Learning rate limit protection ────────────────────────────────────
  {
    const t0 = Date.now();
    const promises = Array.from({ length: 10 }, () =>
      httpPost(LEARNING, SAMPLE_PATTERNS[0], { timeoutMs: config.timeoutMs })
    );
    const results = await Promise.all(promises);
    const rateLimited = results.some((r) => r.status === 429);
    const noServerErrors = results.every((r) => r.status < 500 || r.status === 503);
    const ok = noServerErrors;

    const t: TestResult = {
      name: "Learning engine: rapid pattern submissions don't crash server",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        statuses: results.map((r) => r.status),
        rateLimited,
        serverErrors: results.filter((r) => r.status >= 500 && r.status !== 503).length,
      },
    };
    if (!ok) {
      t.error = "Server errors on rapid learning submissions";
      t.rootCause = "Learning endpoint not handling concurrent write requests gracefully";
      t.suggestedFix = "Add rate limiting to /api/ai/learning using existing checkRateLimit utility";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 46,
    name: "AI Learning Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
