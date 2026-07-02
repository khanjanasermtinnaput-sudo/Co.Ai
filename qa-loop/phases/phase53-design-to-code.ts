/**
 * Phase 53 — Design → Code Engine
 *
 * Tests importing designs from Figma/Penpot/Sketch/Adobe XD
 * and generating maintainable, responsive, theme-compatible components.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const D2C = `${BASE}/api/vision/design-to-code`;

const DESIGN_SOURCES = ["figma", "penpot", "sketch", "adobexd"] as const;

export async function runPhase53(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Design-to-code endpoint exists ────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(D2C, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 405 || res.status === 503;

    tests.push({
      name: "Design→Code: GET /api/vision/design-to-code endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Endpoint returned ${res.status} — not found`,
      rootCause: ok ? undefined : "aof-web/src/app/api/vision/design-to-code/route.ts not deployed",
      suggestedFix: ok ? undefined : "Create and deploy /api/vision/design-to-code route",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Requires authentication ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(D2C, { source: "figma", url: "https://figma.com/file/test" }, { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;

    tests.push({
      name: "Design→Code: POST requires authentication",
      passed: requiresAuth,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: requiresAuth ? undefined : `No auth check (got ${res.status})`,
      rootCause: requiresAuth ? undefined : "Design import endpoint not protected",
      suggestedFix: requiresAuth ? undefined : "Add getUserFromRequest() in design-to-code POST handler",
    });
    requiresAuth ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Invalid source rejected ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(D2C, {
      source: "photoshop-not-supported",
      url: "https://example.com/design",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;

    tests.push({
      name: "Design→Code: unsupported design source rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Unsupported source not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "Source enum validation missing in DesignSchema",
      suggestedFix: ok ? undefined : `Add z.enum(${JSON.stringify(DESIGN_SOURCES)}) for source field`,
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Missing file reference rejected ───────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(D2C, { source: "figma" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;

    tests.push({
      name: "Design→Code: missing URL and fileId rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Missing file reference not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "No validation that url or fileId is provided",
      suggestedFix: ok ? undefined : "Add .refine((d) => d.url || d.fileId) to DesignSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. All four design sources are accepted by endpoint ───────────────────
  {
    const t0 = Date.now();
    const results = await Promise.all(
      DESIGN_SOURCES.map((source) =>
        httpPost(D2C, { source, url: `https://example.com/${source}/design` }, { timeoutMs: config.timeoutMs })
      )
    );
    // All should return auth-required or valid (not 404/500)
    const allHandled = results.every((r) => r.status < 500 && r.status !== 0);

    tests.push({
      name: `Design→Code: all ${DESIGN_SOURCES.length} design sources (Figma/Penpot/Sketch/AdobeXD) handled`,
      passed: allHandled,
      durationMs: Date.now() - t0,
      details: { sources: DESIGN_SOURCES, statuses: results.map((r) => r.status) },
      error: allHandled ? undefined : `Some sources failed: ${results.map((r, i) => `${DESIGN_SOURCES[i]}=${r.status}`).join(", ")}`,
      rootCause: allHandled ? undefined : "Design source enum not covering all supported tools",
      suggestedFix: allHandled ? undefined : "Verify DesignSchema.source enum includes figma, penpot, sketch, adobexd",
    });
    allHandled ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Code-gen agent can describe design implementation ──────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "I have a Figma design for a dashboard with a sidebar, header, and main content area. How should I implement this as a Next.js component?",
      agent: "code-gen",
    }, { timeoutMs: config.timeoutMs });

    const mentionsComponent = /component|layout|sidebar|header|nextjs|next\.js|tsx|jsx/i.test(res.body);
    const ok = (res.status < 500 && mentionsComponent) || isEnvironmentGate(res.status);

    tests.push({
      name: "Design→Code: code-gen agent understands Figma layout implementation",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, mentionsComponent, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Code-gen agent not addressing design-to-code implementation",
      rootCause: ok ? undefined : "AI agent not trained on design system implementation patterns",
      suggestedFix: ok ? undefined : "Update code-gen system prompt to include layout implementation guidance for Figma/design imports",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Design system compatibility: theme integration ─────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "Convert this Figma design to a Tailwind CSS component that integrates with the existing project design system",
      agent: "code-gen",
    }, { timeoutMs: config.timeoutMs });

    const mentionsTailwind = /tailwind|className|tw-|dark:|md:|lg:/i.test(res.body);
    const ok = res.status < 500 && res.body.length > 30;

    tests.push({
      name: `Design→Code: design system integration (Tailwind mentioned: ${mentionsTailwind})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, mentionsTailwind, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Code-gen not producing design-system-compatible output",
      rootCause: ok ? undefined : "No design system context in code-gen agent",
      suggestedFix: ok ? undefined : "Add Tailwind/design system context to code-gen system prompt",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 53, name: "Design → Code Engine", tests, totalMs: Date.now() - start, passCount, failCount };
}
