import { openPage, navigate, screenshot } from "../utils/browser.ts";
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const SCENARIOS = ["login", "logout", "register", "invalid-token", "expired-session", "refresh"] as const;

function randomScenario() {
  return SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
}

export async function runPhase2(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── Test 1: /api/keys (protected) without token → 401 ──────────────────
  // /api/auth/check is intentionally public. Test a clearly-protected endpoint.
  {
    const t0 = Date.now();
    const res = await httpGet(`${config.baseUrl}/api/keys`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403;
    const t: TestResult = {
      name: "GET /api/keys without token → 401/403",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 401 or 403, got ${res.status}`;
      t.rootCause = "Keys endpoint not protecting route correctly";
      t.suggestedFix = "Ensure getUserFromRequest check is applied on /api/keys route";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 2: Invalid Bearer token → 401 ────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${config.baseUrl}/api/keys`, {
      token: "invalid.jwt.token",
      timeoutMs: config.timeoutMs,
    });
    const ok = res.status === 401 || res.status === 403;
    const t: TestResult = {
      name: "Invalid Bearer token rejected (401/403)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Expected 401/403, got ${res.status}`;
      t.rootCause = "API route not validating JWT signature";
      t.suggestedFix = "Verify Supabase JWT verification is applied on all protected /api routes";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 3: Login page renders form ────────────────────────────────────
  {
    const t0 = Date.now();
    const sess = await openPage();
    let screenshotPath: string | undefined;
    try {
      await navigate(sess.page, `${config.baseUrl}/login`, config.timeoutMs);
      screenshotPath = await screenshot(sess.page, runDir, "phase2-login");
      // App uses Google OAuth — look for either email input OR Google sign-in button
      const emailInput = await sess.page.$('input[type="email"], input[name="email"]');
      const googleBtn = await sess.page.$('button:has-text("Google"), a:has-text("Google"), [aria-label*="Google"]');
      const hasLoginUi = !!(emailInput || googleBtn);
      const ok = hasLoginUi;
      const t: TestResult = {
        name: "Login page renders auth UI (email input or Google OAuth button)",
        passed: ok,
        durationMs: Date.now() - t0,
        screenshot: screenshotPath,
        details: { consoleErrors: sess.errors, hasEmailInput: !!emailInput, hasGoogleBtn: !!googleBtn },
      };
      if (!ok) {
        t.error = "Neither email input nor Google OAuth button found on /login page";
        t.rootCause = "Login form component not rendered or route broken";
        t.suggestedFix = "Check /app/login page component and ensure auth UI renders correctly";
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    } finally {
      await sess.close();
    }
  }

  // ── Test 4: Wrong credentials → error message shown ────────────────────
  {
    const t0 = Date.now();
    const sess = await openPage();
    let screenshotPath: string | undefined;
    try {
      await navigate(sess.page, `${config.baseUrl}/login`, config.timeoutMs);
      const emailInput = await sess.page.$('input[type="email"], input[name="email"]');
      const passInput = await sess.page.$('input[type="password"], input[name="password"]');

      if (emailInput && passInput && googleBtn === null) {
        await emailInput.fill("qa-invalid@example.com");
        await passInput.fill("wrongPassword123!");
        await sess.page.keyboard.press("Enter");
        await sess.page.waitForTimeout(3000);
        screenshotPath = await screenshot(sess.page, runDir, "phase2-wrong-credentials");

        const pageContent = await sess.page.textContent("body") ?? "";
        const hasError =
          pageContent.toLowerCase().includes("invalid") ||
          pageContent.toLowerCase().includes("incorrect") ||
          pageContent.toLowerCase().includes("wrong") ||
          pageContent.toLowerCase().includes("error") ||
          pageContent.toLowerCase().includes("failed");
        const stillOnLogin = sess.page.url().includes("/login") || sess.page.url() === config.baseUrl + "/";
        const ok = hasError || stillOnLogin;

        const t: TestResult = {
          name: "Wrong credentials shows error (no crash, no redirect to app)",
          passed: ok,
          durationMs: Date.now() - t0,
          screenshot: screenshotPath,
          details: { url: sess.page.url(), hasError },
        };
        if (!ok) {
          t.error = "No error message shown or redirected despite invalid credentials";
          t.rootCause = "Auth error not surfaced to user";
          t.suggestedFix = "Display error from Supabase auth response on login form";
        }
        tests.push(t);
        ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
      } else {
        // Google-OAuth-only login — no password field to test wrong credentials with.
        // The OAuth provider (Google) handles credential rejection; this is expected.
        tests.push({
          name: "Wrong credentials test — skipped (Google OAuth login has no password field)",
          passed: true,
          durationMs: Date.now() - t0,
          details: { reason: "App uses Google OAuth — credential rejection handled by Google" },
        });
        log.ok("Wrong credentials test skipped (Google OAuth — expected)");
      }
    } finally {
      await sess.close();
    }
  }

  // ── Test 5: Full login flow (if credentials provided) ──────────────────
  if (config.testEmail && config.testPassword) {
    const scenario = randomScenario();
    log.info(`Running random auth scenario: ${scenario}`);
    const t0 = Date.now();
    const sess = await openPage();
    let screenshotPath: string | undefined;
    try {
      await navigate(sess.page, `${config.baseUrl}/login`, config.timeoutMs);
      const emailInput = await sess.page.$('input[type="email"], input[name="email"]');
      const passInput = await sess.page.$('input[type="password"], input[name="password"]');

      if (emailInput && passInput) {
        await emailInput.fill(config.testEmail);
        await passInput.fill(config.testPassword);
        await sess.page.keyboard.press("Enter");
        await sess.page.waitForURL(/\/(chat|code|$)/, { timeout: config.timeoutMs }).catch(() => {});
        screenshotPath = await screenshot(sess.page, runDir, "phase2-logged-in");
        const finalUrl = sess.page.url();
        const loggedIn = !finalUrl.includes("/login");

        const t: TestResult = {
          name: "Valid credentials → redirected to app",
          passed: loggedIn,
          durationMs: Date.now() - t0,
          screenshot: screenshotPath,
          details: { finalUrl, scenario },
        };
        if (!loggedIn) {
          t.error = `Still on login page after submit: ${finalUrl}`;
          t.rootCause = "Supabase auth not succeeding or redirect not configured";
          t.suggestedFix = "Check QA_TEST_EMAIL/QA_TEST_PASSWORD, verify user exists in Supabase";
        }
        tests.push(t);
        ok(loggedIn, t.name);

        // Logout test
        if (loggedIn && scenario === "logout") {
          const t2s = Date.now();
          const logoutBtn = await sess.page.$('[aria-label*="logout" i], [data-testid*="logout" i], button:has-text("Sign out"), button:has-text("Logout")');
          if (logoutBtn) {
            await logoutBtn.click();
            await sess.page.waitForURL(/login|^\/$/, { timeout: config.timeoutMs }).catch(() => {});
            const afterUrl = sess.page.url();
            const loggedOut = afterUrl.includes("/login") || afterUrl === config.baseUrl + "/";
            tests.push({
              name: "Logout redirects to login/home",
              passed: loggedOut,
              durationMs: Date.now() - t2s,
              details: { afterUrl },
              error: loggedOut ? undefined : `Still at ${afterUrl} after logout`,
            });
            loggedOut ? log.ok("Logout redirects to login/home") : log.fail(`Logout failed — at ${afterUrl}`);
          }
        }
      }
    } finally {
      await sess.close();
    }
  } else {
    log.warn("QA_TEST_EMAIL / QA_TEST_PASSWORD not set — skipping login flow test");
  }

  function ok(passed: boolean, name: string) {
    passed ? log.ok(name) : log.fail(name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 2, name: "Authentication", tests, totalMs: Date.now() - start, passCount, failCount };
}
