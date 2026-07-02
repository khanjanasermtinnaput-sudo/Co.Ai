import { httpGet, httpPost, httpPatch, httpDelete } from "../utils/http.ts";
import { openPage, navigate, screenshot } from "../utils/browser.ts";
import { authConfigured, mintSession } from "../utils/auth.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const SCENARIOS = ["enable", "disable", "clear", "recall"] as const;

export async function runPhase4(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  log.info(`Memory scenario: ${scenario}`);

  // ── Test 1: GET /api/conversations without auth → 401 ─────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${config.baseUrl}/api/conversations`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403;
    const t: TestResult = {
      name: "GET /api/conversations without auth → 401/403",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 401/403, got ${res.status}`;
      t.rootCause = "Conversations endpoint not protected";
      t.suggestedFix = "Ensure getUserFromRequest middleware applied on /api/conversations";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 2: POST /api/conversations without auth → 401 ────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(
      `${config.baseUrl}/api/conversations`,
      { title: "QA test conversation" },
      { timeoutMs: config.timeoutMs },
    );
    const ok = res.status === 401 || res.status === 403;
    const t: TestResult = {
      name: "POST /api/conversations without auth → 401/403",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 401/403, got ${res.status}`;
      t.rootCause = "Conversation creation endpoint not protected — memory could leak";
      t.suggestedFix = "Add auth guard to POST /api/conversations handler";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 3: Memory UI (browser) ────────────────────────────────────────
  {
    const t0 = Date.now();
    const sess = await openPage();
    let screenshotPath: string | undefined;
    try {
      await navigate(sess.page, `${config.baseUrl}/chat`, config.timeoutMs);
      screenshotPath = await screenshot(sess.page, runDir, "phase4-memory-chat");

      // Look for memory-related UI elements
      const bodyText = (await sess.page.textContent("body")) ?? "";
      const hasMemoryUi =
        bodyText.toLowerCase().includes("memory") ||
        bodyText.toLowerCase().includes("conversation") ||
        bodyText.toLowerCase().includes("history") ||
        (await sess.page.$('[data-testid*="memory"], [aria-label*="memory" i], button:has-text("memory")')) !== null;

      // If redirected to login that's expected without auth
      const redirectedToLogin = sess.page.url().includes("/login");
      const ok = hasMemoryUi || redirectedToLogin;

      const t: TestResult = {
        name: "Memory/conversation UI elements present on /chat (or auth gate works)",
        passed: ok,
        durationMs: Date.now() - t0,
        screenshot: screenshotPath,
        details: {
          url: sess.page.url(),
          redirectedToLogin,
          hasMemoryUi,
          consoleErrors: sess.errors,
        },
      };
      if (!ok) {
        t.error = "Neither memory UI found nor auth redirect happened";
        t.rootCause = "Chat page may have crashed or memory components not rendering";
        t.suggestedFix = "Check /app/(app)/chat page component for rendering errors";
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    } finally {
      await sess.close();
    }
  }

  // ── Test 4: Memory consistency — two requests return same shape ────────
  {
    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
      httpGet(`${config.baseUrl}/api/conversations`, { timeoutMs: config.timeoutMs }),
      httpGet(`${config.baseUrl}/api/conversations`, { timeoutMs: config.timeoutMs }),
    ]);
    // Both should return same HTTP status (either both 401 or both 200)
    const ok = r1.status === r2.status;
    const t: TestResult = {
      name: "Concurrent /api/conversations requests return consistent status",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status1: r1.status, status2: r2.status },
    };
    if (!ok) {
      t.error = `Inconsistent: first=${r1.status}, second=${r2.status}`;
      t.rootCause = "Race condition or session state corruption between concurrent requests";
      t.suggestedFix = "Check for global mutable state in the conversations route handler";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 5: Authenticated conversation CRUD roundtrip ──────────────────
  // Create → list contains it → rename → delete → list no longer contains it.
  // Exercises the real persistence path (Supabase `conversations` table) as a
  // signed-in user. The created row is always deleted, even on mid-test failure.
  if (authConfigured()) {
    const session = await mintSession();
    if ("token" in session) {
      const token = session.token;
      const t0 = Date.now();
      const title = `qa-loop e2e ${Date.now()}`;
      let convId: string | null = null;
      const steps: string[] = [];
      let error: string | undefined;

      try {
        const created = await httpPost(`${config.baseUrl}/api/conversations`, { title }, { token, timeoutMs: config.timeoutMs });
        const createdBody = JSON.parse(created.body || "{}") as { ok?: boolean; id?: string };
        if (created.status !== 200 || !createdBody.id) throw new Error(`create failed: HTTP ${created.status} ${created.body.slice(0, 100)}`);
        convId = createdBody.id;
        steps.push("create");

        const list = await httpGet(`${config.baseUrl}/api/conversations`, { token, timeoutMs: config.timeoutMs });
        const items = (JSON.parse(list.body || "{}") as { conversations?: Array<{ id: string; title: string }> }).conversations ?? [];
        if (!items.some((c) => c.id === convId)) throw new Error("created conversation missing from list");
        steps.push("list");

        const renamed = await httpPatch(`${config.baseUrl}/api/conversations/${convId}`, { title: `${title} renamed` }, { token, timeoutMs: config.timeoutMs });
        if (renamed.status !== 200) throw new Error(`rename failed: HTTP ${renamed.status}`);
        steps.push("rename");
      } catch (e: unknown) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (convId) {
          const del = await httpDelete(`${config.baseUrl}/api/conversations/${convId}`, { token, timeoutMs: config.timeoutMs });
          if (!error && del.status !== 200) error = `delete failed: HTTP ${del.status}`;
          else if (!error) {
            steps.push("delete");
            const after = await httpGet(`${config.baseUrl}/api/conversations`, { token, timeoutMs: config.timeoutMs });
            const remaining = (JSON.parse(after.body || "{}") as { conversations?: Array<{ id: string }> }).conversations ?? [];
            if (remaining.some((c) => c.id === convId)) error = "conversation still listed after delete";
            else steps.push("verify-gone");
          }
        }
      }

      const passed = !error && steps.length === 5;
      const t: TestResult = {
        name: "Authenticated conversation CRUD roundtrip (create→list→rename→delete)",
        passed,
        durationMs: Date.now() - t0,
        details: { steps },
      };
      if (!passed) {
        t.error = error ?? `incomplete: ${steps.join(",")}`;
        t.rootCause = "Conversation persistence path failing for an authenticated user";
        t.suggestedFix = "Check conversations routes + Supabase service-role config on Vercel";
      }
      tests.push(t);
      passed ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
    } else {
      log.warn(`Could not mint session for CRUD test: ${(session as { error: string }).error}`);
    }
  } else {
    log.warn("QA_SUPABASE_ANON_KEY not set — skipping authenticated CRUD test");
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 4, name: "Memory", tests, totalMs: Date.now() - start, passCount, failCount };
}
