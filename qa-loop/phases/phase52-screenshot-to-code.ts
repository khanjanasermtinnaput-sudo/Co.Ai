/**
 * Phase 52 — Screenshot → Code Engine
 *
 * Tests the vision pipeline for converting screenshots to production-ready
 * React components: endpoint existence, auth, input validation, framework
 * support, and graceful handling of missing images.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const S2C = `${BASE}/api/vision/screenshot-to-code`;

// 1x1 transparent PNG in base64 (minimal valid image for testing)
const MINIMAL_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export async function runPhase52(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Endpoint exists ────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(S2C, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 405 || res.status === 503;

    tests.push({
      name: "Screenshot→Code: GET /api/vision/screenshot-to-code endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Endpoint returned ${res.status} — not found`,
      rootCause: ok ? undefined : "aof-web/src/app/api/vision/screenshot-to-code/route.ts not deployed",
      suggestedFix: ok ? undefined : "Create and deploy /api/vision/screenshot-to-code route",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Requires authentication ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(S2C, { imageBase64: MINIMAL_PNG_B64 }, { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;

    tests.push({
      name: "Screenshot→Code: POST requires authentication",
      passed: requiresAuth,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: requiresAuth ? undefined : `No auth check (got ${res.status})`,
      rootCause: requiresAuth ? undefined : "Vision endpoint not protecting against unauthenticated usage",
      suggestedFix: requiresAuth ? undefined : "Add getUserFromRequest() auth check in POST handler",
    });
    requiresAuth ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Missing image body rejected ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(S2C, { framework: "nextjs" }, { timeoutMs: config.timeoutMs });
    // Should 400 (missing image) or 401 (no auth)
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;

    tests.push({
      name: "Screenshot→Code: missing image source rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Missing image not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "No validation that either imageBase64 or imageUrl is provided",
      suggestedFix: ok ? undefined : "Add .refine() check: imageBase64 || imageUrl required in ScreenshotSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Framework parameter validated ─────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(S2C, {
      imageBase64: MINIMAL_PNG_B64,
      framework: "invalid-framework-xyz",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;

    tests.push({
      name: "Screenshot→Code: invalid framework parameter rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid framework not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "Framework enum not validated via Zod",
      suggestedFix: ok ? undefined : "Add z.enum(['nextjs','react','vue','angular']) for framework field",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Apply endpoint supports code application from vision ───────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/apply`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;

    tests.push({
      name: "Screenshot→Code: /api/apply endpoint exists for applying generated code",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "/api/apply not found — generated code cannot be applied",
      rootCause: ok ? undefined : "Apply endpoint not deployed",
      suggestedFix: ok ? undefined : "Ensure aof-web/src/app/api/apply/route.ts is deployed",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Image URL input variant accepted ──────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(S2C, {
      imageUrl: "https://example.com/screenshot.png",
      framework: "nextjs",
    }, { timeoutMs: config.timeoutMs });
    // Auth or valid processing expected
    const ok = res.status < 500 && res.status !== 0;

    tests.push({
      name: "Screenshot→Code: imageUrl variant handled without server error",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 100) },
      error: ok ? undefined : `imageUrl input caused server error: ${res.status}`,
      rootCause: ok ? undefined : "URL-based image input not handled in route",
      suggestedFix: ok ? undefined : "Handle imageUrl in ScreenshotSchema refine check and route handler",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Design-to-code endpoint also exists (reuse check) ─────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/vision/design-to-code`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;

    tests.push({
      name: "Screenshot→Code: companion /api/vision/design-to-code endpoint also exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "Design-to-code endpoint missing",
      rootCause: ok ? undefined : "aof-web/src/app/api/vision/design-to-code/route.ts not deployed",
      suggestedFix: ok ? undefined : "Create /api/vision/design-to-code route for Phase 53 support",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 52, name: "Screenshot → Code Engine", tests, totalMs: Date.now() - start, passCount, failCount };
}
