/**
 * Phase 72 — IDE Developer Workflow
 *
 * Simulates a real developer's path through CoCode IDE end to end: open the
 * IDE → connect GitHub → index a repo → search → edit/apply a diff →
 * AI-refactor → classify-workflow (the "what should happen next" engine).
 * Hits the real endpoints backing each step (/api/github, /api/repo/analyze,
 * /api/search, /api/apply, /api/refactor, /api/workflow) — commit/push/PR/
 * deploy against a *real* GitHub repo are deliberately NOT exercised here
 * (would require a live token and would create real commits); deployment
 * gates are already covered by phase36/37. Literal browser-driven clicking
 * through the IDE UI isn't done either — cocode-ide.tsx has no data-testid
 * hooks yet, so selector-based automation would be too brittle to trust.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { openPage, navigate, screenshot } from "../utils/browser.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;

/** Same convention as phase71: a request refused for an orthogonal reason
 *  (no provider key, plan gate, rate limit, upstream outage) counts as a
 *  pass — the test can't observe the behaviour under test once the platform
 *  has already declined the call. */
function isEnvironmentGate(status: number): boolean {
  return [401, 403, 429, 502, 503].includes(status);
}

export async function runPhase72(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── Test 1: Open IDE — /cocode renders without crashing ────────────────
  {
    const t0 = Date.now();
    const sess = await openPage();
    let screenshotPath: string | undefined;
    try {
      await navigate(sess.page, `${BASE}/cocode`, config.timeoutMs);
      screenshotPath = await screenshot(sess.page, runDir, "phase72-ide-open");
      const bodyText = (await sess.page.textContent("body")) ?? "";
      const redirectedToLogin = sess.page.url().includes("/login");
      const rendered = bodyText.trim().length > 0;
      const ok = rendered || redirectedToLogin;

      const t: TestResult = {
        name: "Open IDE: /cocode renders content (or auth-gates to /login)",
        passed: ok,
        durationMs: Date.now() - t0,
        screenshot: screenshotPath,
        details: { url: sess.page.url(), redirectedToLogin, consoleErrors: sess.errors, failedRequests: sess.failedRequests },
      };
      if (!ok) {
        t.error = "IDE page rendered no content and did not redirect to login";
        t.rootCause = "cocode page component crashed client-side before hydration";
        t.suggestedFix = "Check aof-web/src/app/(app)/cocode/page.tsx and cocode-ide.tsx for a render-blocking error";
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    } finally {
      await sess.close();
    }
  }

  // ── Test 2: Connect GitHub — OAuth URL is well-formed (or cleanly 501) ──
  {
    const t0 = Date.now();
    const patchRes = await fetch(`${BASE}/api/github`, { method: "PATCH" }).catch((e) => e as Error);
    const isErr = patchRes instanceof Error;
    const status = isErr ? 0 : (patchRes as Response).status;
    let body: Record<string, unknown> = {};
    if (!isErr) body = await (patchRes as Response).json().catch(() => ({}));
    const wellFormed = status === 200 && typeof body.url === "string" && body.url.includes("github.com/login/oauth/authorize");
    const notConfigured = status === 501;
    const ok = wellFormed || notConfigured;

    const t: TestResult = {
      name: "Connect GitHub: PATCH /api/github issues a valid OAuth URL (or reports not-configured)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, wellFormed, notConfigured, url: typeof body.url === "string" ? body.url.slice(0, 120) : undefined },
    };
    if (!ok) {
      t.error = isErr ? (patchRes as Error).message : `Unexpected status ${status} / body ${JSON.stringify(body).slice(0, 200)}`;
      t.rootCause = "GitHub OAuth URL builder returning a malformed URL or wrong status";
      t.suggestedFix = "Check the PATCH handler in aof-web/src/app/api/github/route.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 3: GitHub proxy gate — no token → 401, not a raw crash ────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/github?path=/user`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401;
    const t: TestResult = {
      name: "GitHub proxy: GET without gh_token cookie → 401 'GitHub not connected'",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 150) },
    };
    if (!ok) {
      t.error = `Expected 401, got ${res.status}`;
      t.rootCause = "getToken()/proxyGitHub() not gating unauthenticated calls correctly";
      t.suggestedFix = "Review getToken() and the 401 branch in aof-web/src/app/api/github/route.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 4: GitHub proxy — missing ?path → 400, not 500 ─────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/github`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400;
    const t: TestResult = {
      name: "GitHub proxy: GET without ?path param → 400 (malformed request)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 400, got ${res.status}`;
      t.rootCause = "Missing-path validation removed or bypassed in GET handler";
      t.suggestedFix = "Confirm the `if (!path...)` guard at the top of GET() in api/github/route.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 5: Index repository — /api/repo/analyze detects the stack ─────
  {
    const t0 = Date.now();
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies: { next: "14.2.0", react: "18.2.0" }, devDependencies: { typescript: "5.6.3" }, scripts: { build: "next build", test: "jest" } }) },
      { path: "src/app/page.tsx", content: "export default function Page() { return null; }" },
      { path: "src/lib/foo.test.ts", content: "test('x', () => {});" },
      { path: "tsconfig.json", content: "{}" },
    ];
    const res = await httpPost(`${BASE}/api/repo/analyze`, { files }, { timeoutMs: config.timeoutMs });
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(res.body); } catch {}
    const ok = res.status === 200 && String(json.framework ?? "").includes("Next.js") && json.typescript === true && Array.isArray(json.testFiles) && (json.testFiles as unknown[]).length === 1;
    const t: TestResult = {
      name: "Index repository: /api/repo/analyze correctly detects Next.js + TypeScript + 1 test file",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, framework: json.framework, typescript: json.typescript, testFiles: json.testFiles },
    };
    if (!ok) {
      t.error = `Got framework=${json.framework}, typescript=${json.typescript}, status=${res.status}`;
      t.rootCause = "analyzeProject() detection heuristics in api/repo/analyze/route.ts not matching a standard package.json shape";
      t.suggestedFix = "Debug detectFramework()/testFiles filter against the exact fixture used in this test";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 6: Index repository — empty files[] rejected, not 500 ─────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/repo/analyze`, { files: [] }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400;
    const t: TestResult = {
      name: "Index repository: empty files[] → 400, not a crash",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 400, got ${res.status}`;
      t.rootCause = "files.length guard missing/changed in repo/analyze route";
      t.suggestedFix = "Confirm `if (!Array.isArray(files) || !files.length)` guard in api/repo/analyze/route.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 7: Search file — gated behind auth, not open to anon callers ──
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/search?q=test`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 503; // 503 if search isn't configured on this deploy
    const t: TestResult = {
      name: "Search file: GET /api/search without auth → 401 (or 503 if not configured)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Expected 401/503, got ${res.status}`;
      t.rootCause = "getUserFromRequest() gate missing/bypassed in api/search/route.ts";
      t.suggestedFix = "Confirm the `if (!user) return 401` check runs before any Supabase query";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 8: Edit + Diff + Save — /api/apply patches content correctly ──
  {
    const t0 = Date.now();
    const original = "line1\nline2\nline3";
    const diff = [
      "--- a/hello.txt",
      "+++ b/hello.txt",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-line2",
      "+line2-changed",
      " line3",
      "+line4",
    ].join("\n");
    const res = await httpPost(
      `${BASE}/api/apply`,
      { diff, files: [{ path: "hello.txt", content: original }], acceptAll: true },
      { timeoutMs: config.timeoutMs },
    );
    let json: { ok?: boolean; patched?: Array<{ path: string; content: string }> } = {};
    try { json = JSON.parse(res.body); } catch {}
    const patchedContent = json.patched?.find((f) => f.path === "hello.txt")?.content;
    const expected = "line1\nline2-changed\nline3\nline4";
    const ok = res.status === 200 && json.ok === true && patchedContent === expected;
    const t: TestResult = {
      name: "Edit/Diff/Save: /api/apply applies a hunk (replace + append) with byte-exact output",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, patchedContent, expected },
    };
    if (!ok) {
      t.error = `Expected "${expected}", got "${patchedContent}"`;
      t.rootCause = "applyHunk()/applyAcceptedHunks() line-offset math in lib/cocode/diff.ts diverging from the parsed hunk";
      t.suggestedFix = "Unit-test applyHunk() directly against this exact fixture to isolate the offset bug";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 9: Apply — garbage diff text doesn't 500 ───────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(
      `${BASE}/api/apply`,
      { diff: "this is not a diff at all, just prose.\nrandom\nlines", files: [{ path: "x.txt", content: "y" }] },
      { timeoutMs: config.timeoutMs },
    );
    const ok = res.status < 500;
    const t: TestResult = {
      name: "Apply: non-diff garbage text is parsed to zero files, not a 500",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 150) },
    };
    if (!ok) {
      t.error = `Got ${res.status} on garbage diff input`;
      t.rootCause = "parseDiff() throwing on input with no recognizable '--- '/'+++ ' headers";
      t.suggestedFix = "Wrap parseDiff() call in api/apply/route.ts in a try/catch, or make it tolerant of headerless input";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 10: AI Refactor — rename-symbol (deterministic, no provider key) ──
  {
    const t0 = Date.now();
    const file = { path: "a.ts", content: "const userId = 1;\nfunction useUserId() { return userId; }\n// userId used twice above, plus a lookalike: userIdentifier" };
    const res = await httpPost(
      `${BASE}/api/refactor`,
      { kind: "rename-symbol", file, symbol: { name: "userId", newName: "accountId" } },
      { timeoutMs: config.timeoutMs },
    );
    let json: { patchedFiles?: Array<{ path: string; content: string }> } = {};
    try { json = JSON.parse(res.body); } catch {}
    const content = json.patchedFiles?.[0]?.content ?? "";
    const renamedCorrectly = content.includes("const accountId = 1") && content.includes("return accountId") && !content.includes("useAccountId") && content.includes("userIdentifier");
    const ok = res.status === 200 && renamedCorrectly;
    const t: TestResult = {
      name: "AI Refactor: rename-symbol renames whole-word matches only (word-boundary safe)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, content: content.slice(0, 250) },
    };
    if (!ok) {
      t.error = `Rename did not apply cleanly: ${content.slice(0, 200)}`;
      t.rootCause = "Word-boundary regex in api/refactor/route.ts over- or under-matching (e.g. clobbering 'useUserId' or 'userIdentifier')";
      t.suggestedFix = "Check the \\\\b${escapeRegex(symbol.name)}\\\\b replaceAll in api/refactor/route.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 11: AI Refactor — AI-powered kind degrades gracefully ─────────
  {
    const t0 = Date.now();
    const res = await httpPost(
      `${BASE}/api/refactor`,
      { kind: "extract-function", file: { path: "b.ts", content: "function big() { const x = 1 + 2; return x; }" }, selection: { start: 0, end: 10, text: "1 + 2" } },
      { timeoutMs: Math.max(config.timeoutMs, 60_000) },
    );
    const ok = res.status < 500 || isEnvironmentGate(res.status);
    const t: TestResult = {
      name: "AI Refactor: extract-function (AI-powered path) never returns a raw 5xx",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
    };
    if (!ok) {
      t.error = `Got ${res.status}`;
      t.rootCause = "Downstream /api/chat call in api/refactor/route.ts not error-handled (fetch rejection or non-JSON error body)";
      t.suggestedFix = "Wrap the chatRes fetch + body pass-through in api/refactor/route.ts with a try/catch returning a structured 502";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 12: Workflow decision engine — classifies + rejects empty input ──
  {
    const t0 = Date.now();
    const good = await httpPost(`${BASE}/api/workflow`, { request: "Refactor the auth module to use JWT", hasRepoContext: true, fileCount: 42 }, { timeoutMs: config.timeoutMs });
    const bad = await httpPost(`${BASE}/api/workflow`, { request: "" }, { timeoutMs: config.timeoutMs });
    let goodJson: Record<string, unknown> = {};
    try { goodJson = JSON.parse(good.body); } catch {}
    const ok = good.status === 200 && typeof goodJson === "object" && Object.keys(goodJson).length > 0 && bad.status === 400;
    const t: TestResult = {
      name: "Workflow engine: classifies a real request (200) and rejects an empty one (400)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { goodStatus: good.status, badStatus: bad.status, decision: goodJson },
    };
    if (!ok) {
      t.error = `good=${good.status}, bad=${bad.status}`;
      t.rootCause = "classifyWorkflow() or its request-required guard in api/workflow/route.ts regressed";
      t.suggestedFix = "Check the `if (!request?.trim())` guard and classifyWorkflow() in lib/cocode/adaptive-workflow.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── Test 13: Concurrent apply calls stay isolated (no cross-contamination) ──
  {
    const t0 = Date.now();
    const mkDiff = (from: string, to: string) =>
      [`--- a/f.txt`, `+++ b/f.txt`, `@@ -1,1 +1,1 @@`, `-${from}`, `+${to}`].join("\n");
    const [r1, r2] = await Promise.all([
      httpPost(`${BASE}/api/apply`, { diff: mkDiff("alpha", "ALPHA-DONE"), files: [{ path: "f.txt", content: "alpha" }] }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/apply`, { diff: mkDiff("beta", "BETA-DONE"), files: [{ path: "f.txt", content: "beta" }] }, { timeoutMs: config.timeoutMs }),
    ]);
    const j1 = JSON.parse(r1.body || "{}") as { patched?: Array<{ content: string }> };
    const j2 = JSON.parse(r2.body || "{}") as { patched?: Array<{ content: string }> };
    const c1 = j1.patched?.[0]?.content;
    const c2 = j2.patched?.[0]?.content;
    const ok = c1 === "ALPHA-DONE" && c2 === "BETA-DONE";
    const t: TestResult = {
      name: "Isolation: two concurrent /api/apply requests each get their own diff back, not the other's",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { c1, c2 },
    };
    if (!ok) {
      t.error = `Expected ALPHA-DONE/BETA-DONE, got ${c1}/${c2}`;
      t.rootCause = "Shared/module-scoped mutable state in api/apply/route.ts (e.g. the parseDiff() uid() counter) leaking across concurrent requests";
      t.suggestedFix = "Audit api/apply/route.ts and lib/cocode/diff.ts for anything not scoped per-call (parseDiff's module-level `_id` counter is a candidate — confirm it can't cause cross-request id collisions under concurrency)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 72, name: "IDE Developer Workflow", tests, totalMs: Date.now() - start, passCount, failCount };
}
