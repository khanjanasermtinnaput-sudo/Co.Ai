import { openPage, navigate, screenshot } from "../utils/browser.ts";
import { httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

export async function runPhase1(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── Test 1: HTTP health check (no browser) ─────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${config.baseUrl}/api/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;
    const t: TestResult = {
      name: "GET /api/health returns 200",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 200, got ${res.status}${res.error ? ` (${res.error})` : ""}`;
      t.rootCause = "Health endpoint unreachable or service down";
      t.suggestedFix = "Check Vercel deployment status and NEXT_PUBLIC_* env vars";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 2: Backend /v1/health ──────────────────────────────────────────
  {
    const t0 = Date.now();
    // Render free tier spins down when idle; the FIRST request wakes the
    // instance and can exceed the timeout (HTTP 0 / abort). Retry once with a
    // longer budget — a real outage still fails both attempts.
    let res = await httpGet(`${config.backendUrl}/v1/health`, { timeoutMs: config.timeoutMs });
    let attempts = 1;
    if (res.status !== 200 && res.status !== 429) {
      await new Promise((r) => setTimeout(r, 15_000));
      res = await httpGet(`${config.backendUrl}/v1/health`, { timeoutMs: config.timeoutMs * 2 });
      attempts = 2;
    }
    // 429 on a health endpoint = rate-limiter incorrectly covers health checks (real finding, warn not fail)
    const ok = res.status === 200 || res.status === 429;
    const t: TestResult = {
      name: "GET /v1/health (backend) responds (200 or rate-limited)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, attempts, body: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = `Backend health check failed: HTTP ${res.status}${res.error ? ` — ${res.error}` : ""}`;
      t.rootCause = "Render service may be sleeping (cold start) or crashed";
      t.suggestedFix = "Wait 30 s for Render cold start or check keep-warm workflow";
    } else if (res.status === 429) {
      log.warn("Backend /v1/health is being rate-limited — health endpoints should be exempt from rate limiting");
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 3: Homepage loads in browser ──────────────────────────────────
  {
    const t0 = Date.now();
    const sess = await openPage();
    let loadMs = 0;
    let screenshotPath: string | undefined;
    try {
      loadMs = await navigate(sess.page, config.baseUrl, config.timeoutMs);
      screenshotPath = await screenshot(sess.page, runDir, "phase1-homepage");
      const title = await sess.page.title();
      const hasTitle = title.length > 0;
      const consoleErrors = sess.errors.filter(
        (e) => !e.includes("favicon") && !e.includes("hydration"),
      );
      const failedReqs = sess.failedRequests.filter((r) => r.status >= 500);
      const ok = hasTitle && consoleErrors.length === 0 && failedReqs.length === 0;

      const t: TestResult = {
        name: "Homepage loads in browser (no console errors)",
        passed: ok,
        durationMs: Date.now() - t0,
        screenshot: screenshotPath,
        details: {
          loadMs,
          title,
          consoleErrors,
          failedRequests: failedReqs,
        },
      };

      if (!ok) {
        t.error = consoleErrors.length
          ? `Console errors: ${consoleErrors.slice(0, 3).join("; ")}`
          : failedReqs.length
          ? `Failed requests: ${failedReqs.map((r) => `${r.status} ${r.url}`).join(", ")}`
          : "Page loaded but title missing";
        t.rootCause = "JavaScript runtime error or missing resource";
        t.suggestedFix = "Check browser console on aof-web.vercel.app and fix reported errors";
      }

      if (loadMs > 5000) {
        log.warn(`Page load slow: ${loadMs}ms`);
      }

      tests.push(t);
      ok ? log.ok(t.name + ` (${loadMs}ms)`) : log.fail(t.name + " — " + t.error);
    } finally {
      await sess.close();
    }
  }

  // ── Test 4: Page load time < 5 s ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(config.baseUrl, { timeoutMs: config.timeoutMs });
    const loadMs = res.durationMs;
    const ok = loadMs < 5000 && res.ok;
    const t: TestResult = {
      name: "Homepage HTTP response time < 5000 ms",
      passed: ok,
      durationMs: loadMs,
      details: { loadMs, status: res.status },
    };
    if (!ok) {
      t.error = `Load time ${loadMs}ms (threshold: 5000ms)`;
      t.rootCause = ok ? undefined : "Slow server response, possible cold start or heavy SSR";
      t.suggestedFix = "Check Vercel function duration, enable ISR/SSG where possible";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${loadMs}ms)`) : log.warn(t.name + ` — ${loadMs}ms`);
  }

  // ── Test 5: /login page accessible ─────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${config.baseUrl}/login`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200;
    const t: TestResult = {
      name: "GET /login returns 200",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 200, got ${res.status}`;
      t.rootCause = "Login page route broken or auth redirect loop";
      t.suggestedFix = "Check Next.js middleware and login route configuration";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 1, name: "Homepage", tests, totalMs: Date.now() - start, passCount, failCount };
}
