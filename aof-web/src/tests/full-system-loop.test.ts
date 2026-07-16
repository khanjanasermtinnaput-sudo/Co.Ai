// ── Full-system loop test suite ───────────────────────────────────────────────
// Exercises every major subsystem (tier×effort matrix, all API routes, CoCode,
// and any other user-facing surface) 10x per test case, per the QA loop-test
// requirement. Route handlers use next/headers `cookies()`, which throws
// outside a real Next.js request context, so this spins up a real `next dev`
// child process (helpers/server-lifecycle.ts) and drives it over HTTP rather
// than importing route.ts modules directly. No production code, effort.ts,
// model-workflow.ts, route.ts, or any other *.test.ts file is touched by this
// suite — see the plan doc for the full environment trace this is built on.
//
// No LLM provider keys or Supabase keys are configured in aof-web/.env.local
// in this environment, so live generation and DB-backed paths are verified
// against their documented missing-config behavior (specific status codes),
// not fake-mocked — this IS the "skip cleanly, name the missing var" contract
// the app itself already implements for a missing key.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  runLoop,
  runOnce,
  printSubsystemTable,
  printFinalScore,
  type LoopResult,
} from "./helpers/loop-harness";
import { startDevServer, type DevServer } from "./helpers/server-lifecycle";
import { PUBLIC_CASES, DIRECT_401_CASES, CONFIG_GATED_503_CASES, type RouteCase } from "./helpers/expected-status";

import { effortLevelsFor } from "../lib/effort";
import { parseDiff, applyAcceptedHunks, diffStats, extractDiffs } from "../lib/cocode/diff";
import { analyzeText, analyzeFiles, parseConsoleMessage } from "../lib/cocode/diagnostics";
import {
  buildTree,
  flattenFiles,
  findFile,
  upsertFile,
  deleteFile,
  renameFile,
  detectLanguage,
} from "../lib/cocode/virtual-fs";
import { buildPreview, isNextProject, injectRelay, inlineSources } from "../lib/cocode/preview-runtime";

let server: DevServer;
const allResults: LoopResult[] = [];

before(async () => {
  server = await startDevServer();
}, { timeout: 90_000 });

after(async () => {
  await server?.stop();
});

async function fetchJson(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${server.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON or empty body — leave as null
  }
  return { status: res.status, headers: res.headers, body };
}

function requestInit(method: string, body?: unknown): RequestInit {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return init;
}

async function runRouteCase(rc: RouteCase): Promise<LoopResult> {
  return runLoop(rc.name, async () => {
    const { status, body } = await fetchJson(rc.path, requestInit(rc.method, rc.body));
    assert.ok(
      rc.expectedStatus.includes(status),
      `expected status in [${rc.expectedStatus.join(",")}], got ${status} body=${JSON.stringify(body)}`,
    );
  });
}

/** For the one live external network call (GitHub token exchange): treat a
 *  genuine network-unreachable error as a skip, not a failure — this hits
 *  github.com, outside the repo's control. */
async function runNetworkDependent(name: string, fn: () => Promise<void>): Promise<LoopResult> {
  try {
    await fn();
    return {
      name, iterations: 1, attempted: 1, passed: 1, failed: 0, skipped: false,
      avgLatencyMs: 0, p95LatencyMs: 0, outcomes: [{ status: "pass", latencyMs: 0 }],
      classification: "reliable",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg)) {
      return {
        name, iterations: 1, attempted: 0, passed: 0, failed: 0, skipped: true,
        skipReason: `network unreachable: ${msg}`, avgLatencyMs: null, p95LatencyMs: null,
        outcomes: [], classification: "skipped",
      };
    }
    return {
      name, iterations: 1, attempted: 1, passed: 0, failed: 1, skipped: false,
      avgLatencyMs: 0, p95LatencyMs: 0, outcomes: [{ status: "fail", latencyMs: 0, error: msg }],
      classification: "failing", firstError: msg,
    };
  }
}

// ── 1. Tier × Effort matrix ───────────────────────────────────────────────────
// Wire-level model ids: ChatModel = "lite"|"normal" (CoChat), CoCode's own
// selector additionally allows "1.0"|"pro"; modelTierFromId() maps "1.0" onto
// the same "normal" tier, so a wire request never sends "1.0" literally — the
// /api/chat body schema itself only accepts model: "lite"|"normal"|"pro"
// (route.ts's WorkflowModelId). Ypertatos ("pro") is only reachable with
// agent: "code-chat" (verified in route.ts's tierEligible gate).
//
// Each combo runs ONCE (not looped 10x): they share one 10-request/day
// anonymous quota (rate-limit.ts guest_daily), so a 10x loop here would either
// exhaust it after ~1 combo or need per-iteration quota accounting for no
// reliability signal beyond what a single call already gives on this
// config-only code path (already exhaustively unit-tested for policy
// correctness by effort.test.ts / model-workflow.test.ts).
test("Tier x Effort matrix", async () => {
  const combos: Array<{ name: string; body: Record<string, unknown> }> = [];
  for (const effort of effortLevelsFor("lite")) {
    combos.push({ name: `lite/${effort} (Mikros)`, body: { message: "hello", model: "lite", effort } });
  }
  for (const effort of effortLevelsFor("normal")) {
    combos.push({ name: `normal/${effort} (Kanon / "1.0")`, body: { message: "hello", model: "normal", effort } });
  }
  for (const effort of effortLevelsFor("pro")) {
    combos.push({
      name: `pro/${effort} (Ypertatos)`,
      body: { message: "hello", model: "pro", effort, agent: "code-chat" },
    });
  }

  const results: LoopResult[] = [];
  for (const combo of combos) {
    const r = await runOnce(combo.name, async () => {
      const { status, body, headers } = await fetchJson("/api/chat", requestInit("POST", combo.body));
      const isMissingKey = status === 503 && headers.get("x-coagentix-error") === "AOF_ERROR_001";
      const isQuotaExceeded = status === 429;
      assert.ok(
        isMissingKey || isQuotaExceeded,
        `expected 503 AOF_ERROR_001 (missing key) or 429 (guest quota exceeded), got ${status} body=${JSON.stringify(body)}`,
      );
    });
    results.push(r);
  }

  allResults.push(...results);
  printSubsystemTable("Tier x Effort Matrix (/api/chat, no keys configured)", results);
});

// ── 2. API routes ─────────────────────────────────────────────────────────────
test("API routes: public / no-auth-required", async () => {
  const results: LoopResult[] = [];
  for (const rc of PUBLIC_CASES) results.push(await runRouteCase(rc));
  allResults.push(...results);
  printSubsystemTable("API Routes - Public / No Auth", results);
});

test("API routes: direct 401 (getUserFromRequest, no config gate)", async () => {
  const results: LoopResult[] = [];
  for (const rc of DIRECT_401_CASES) results.push(await runRouteCase(rc));
  allResults.push(...results);
  printSubsystemTable("API Routes - Direct 401", results);
});

test("API routes: isAdminConfigured()-gated (503 in this unconfigured env)", async () => {
  const results: LoopResult[] = [];
  for (const rc of CONFIG_GATED_503_CASES) results.push(await runRouteCase(rc));
  allResults.push(...results);
  printSubsystemTable("API Routes - Config-Gated 503 (incl. all 13 /api/admin/*)", results);
});

// ── 3. GitHub OAuth, CSRF, feedback ───────────────────────────────────────────
test("Misc: GitHub OAuth callback, CSRF gate, feedback", async () => {
  const results: LoopResult[] = [];

  results.push(
    await runLoop("GET /api/github/callback (no code -> redirect, no network)", async () => {
      const res = await fetch(`${server.baseUrl}/api/github/callback`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      // NextResponse.redirect() defaults to 307 (temporary, method-preserving)
      // when no status is passed — not 302.
      assert.equal(res.status, 307);
      const loc = res.headers.get("location") ?? "";
      assert.ok(loc.includes("/code?error=github_no_code"), `unexpected redirect target: ${loc}`);
    }),
  );

  results.push(
    await runNetworkDependent("GET /api/github/callback (fake code, live network to github.com)", async () => {
      const res = await fetch(`${server.baseUrl}/api/github/callback?code=fake&state=x`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(res.status, 307);
      const loc = res.headers.get("location") ?? "";
      assert.ok(loc.includes("/code?error=github_"), `unexpected redirect target: ${loc}`);
    }),
  );

  results.push(
    await runOnce("POST /api/feedback with forged cross-origin Origin (CSRF gate)", async () => {
      const res = await fetch(`${server.baseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ type: "bug", message: "csrf probe message" }),
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(res.status, 403);
    }),
  );

  results.push(
    await runLoop("POST /api/feedback (normal, 5/min rate limit)", async () => {
      const res = await fetch(`${server.baseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bug", message: "loop test feedback message" }),
        signal: AbortSignal.timeout(10_000),
      });
      assert.ok([200, 429].includes(res.status), `expected 200 or 429 (rate-limited), got ${res.status}`);
    }),
  );

  allResults.push(...results);
  printSubsystemTable("Misc - GitHub OAuth / CSRF / Feedback", results);
});

// ── 4. CoCode subsystem (function/module-level, no browser) ──────────────────
test("CoCode: diff engine", async () => {
  const results: LoopResult[] = [];
  const sampleDiff =
    "--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+lineTwo\n line3\n" +
    "--- a/y.ts\n+++ b/y.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";

  results.push(
    await runLoop("parseDiff: multi-file unified diff", async () => {
      const parsed = parseDiff(sampleDiff);
      assert.equal(parsed.files.length, 2);
      assert.equal(parsed.files[0].hunks.length, 1);
      const kinds = parsed.files[0].hunks[0].lines.map((l) => l.kind);
      assert.ok(kinds.includes("added") && kinds.includes("removed") && kinds.includes("context"));
    }),
  );

  results.push(
    await runLoop("applyAcceptedHunks: patches content to the expected result", async () => {
      const parsed = parseDiff(sampleDiff);
      const file = parsed.files[0];
      file.hunks.forEach((h) => { h.accepted = true; });
      const patched = applyAcceptedHunks("line1\nline2\nline3", file);
      assert.equal(patched, "line1\nlineTwo\nline3");
    }),
  );

  results.push(
    await runLoop("diffStats: counts additions/removals/files", async () => {
      const parsed = parseDiff(sampleDiff);
      const stats = diffStats(parsed);
      assert.equal(stats.files, 2);
      assert.equal(stats.added, 2);
      assert.equal(stats.removed, 2);
    }),
  );

  results.push(
    await runLoop("extractDiffs: pulls a fenced diff block out of markdown", async () => {
      const md = "Here is the fix:\n```diff\n" + sampleDiff + "```\nDone.";
      const extracted = extractDiffs(md);
      assert.equal(extracted.length, 1);
      assert.ok(extracted[0].includes("@@"));
    }),
  );

  allResults.push(...results);
  printSubsystemTable("CoCode - Diff Engine", results);
});

test("CoCode: diagnostics engine", async () => {
  const results: LoopResult[] = [];

  results.push(
    await runLoop("analyzeText: detects a known TS diagnostic pattern", async () => {
      const diags = analyzeText("Property 'foo' does not exist on type 'Bar'.", "a.ts", 5);
      assert.equal(diags.length, 1);
      assert.equal(diags[0].severity, "error");
      assert.equal(diags[0].category, "typescript");
      assert.equal(diags[0].autoFixable, true);
    }),
  );

  results.push(
    await runLoop("analyzeFiles: dedupes an identical diagnostic across duplicate file entries", async () => {
      const files = [
        { path: "a.ts", content: "Cannot find module 'left-pad'" },
        { path: "a.ts", content: "Cannot find module 'left-pad'" },
      ];
      const diags = analyzeFiles(files);
      assert.equal(diags.length, 1);
    }),
  );

  results.push(
    await runLoop("parseConsoleMessage: log/info never produce diagnostics", async () => {
      assert.deepEqual(parseConsoleMessage("log", "Cannot find module 'x'"), []);
      assert.deepEqual(parseConsoleMessage("info", "Cannot find module 'x'"), []);
    }),
  );

  results.push(
    await runLoop("parseConsoleMessage: error produces a severity=error diagnostic", async () => {
      const diags = parseConsoleMessage("error", "Cannot find module 'left-pad'", "a.ts");
      assert.equal(diags.length, 1);
      assert.equal(diags[0].severity, "error");
    }),
  );

  allResults.push(...results);
  printSubsystemTable("CoCode - Diagnostics Engine", results);
});

test("CoCode: virtual file system", async () => {
  const results: LoopResult[] = [];
  const seed = [
    { path: "src/App.tsx", content: "export default function App() { return null; }" },
    { path: "src/index.ts", content: "console.log(1);" },
  ];

  results.push(
    await runLoop("buildTree + flattenFiles round-trip", async () => {
      const tree = buildTree(seed);
      const flat = flattenFiles(tree);
      assert.equal(flat.length, 2);
      assert.ok(flat.some((f) => f.path === "src/App.tsx"));
    }),
  );

  results.push(
    await runLoop("findFile: locates a nested file by path", async () => {
      const tree = buildTree(seed);
      const found = findFile(tree, "src/index.ts");
      assert.ok(found);
      assert.equal(found!.content, "console.log(1);");
    }),
  );

  results.push(
    await runLoop("upsertFile: creates a new file", async () => {
      const tree = buildTree(seed);
      const next = upsertFile(tree, "src/new.ts", "export const x = 1;");
      assert.ok(findFile(next, "src/new.ts"));
    }),
  );

  results.push(
    await runLoop("deleteFile: removes a file", async () => {
      const tree = buildTree(seed);
      const next = deleteFile(tree, "src/index.ts");
      assert.equal(findFile(next, "src/index.ts"), null);
    }),
  );

  results.push(
    await runLoop("renameFile: moves a file to a new path", async () => {
      const tree = buildTree(seed);
      const next = renameFile(tree, "src/index.ts", "src/main.ts");
      assert.equal(findFile(next, "src/index.ts"), null);
      assert.ok(findFile(next, "src/main.ts"));
    }),
  );

  results.push(
    await runLoop("detectLanguage: table-driven extension mapping", async () => {
      assert.equal(detectLanguage("a.ts"), "typescript");
      assert.equal(detectLanguage("a.tsx"), "tsx");
      assert.equal(detectLanguage("a.py"), "python");
      assert.equal(detectLanguage("a.unknownext"), "plaintext");
    }),
  );

  allResults.push(...results);
  printSubsystemTable("CoCode - Virtual File System", results);
});

test("CoCode: preview runtime", async () => {
  const results: LoopResult[] = [];

  results.push(
    await runLoop("buildPreview: html project (real index.html, non-module script)", async () => {
      const files = [
        { path: "index.html", content: '<html><head></head><body><script src="app.js"></script></body></html>' },
        { path: "app.js", content: "console.log('hi');" },
      ];
      const result = buildPreview(files);
      assert.equal(result.kind, "html");
      assert.ok(result.html && result.html.includes("console.log('hi')"));
    }),
  );

  results.push(
    await runLoop("buildPreview: spa project (App component, no index.html)", async () => {
      const files = [{ path: "src/App.tsx", content: "export default function App(){return null;}" }];
      const result = buildPreview(files);
      assert.equal(result.kind, "spa");
      assert.ok(result.html);
    }),
  );

  results.push(
    await runLoop("buildPreview: next.js project (honest null, iframe can't run it)", async () => {
      const files = [
        { path: "next.config.js", content: "module.exports = {};" },
        { path: "src/app/page.tsx", content: "export default function Page(){return null;}" },
      ];
      const result = buildPreview(files);
      assert.equal(result.kind, "nextjs");
      assert.equal(result.html, null);
    }),
  );

  results.push(
    await runLoop("buildPreview: empty project", async () => {
      const result = buildPreview([]);
      assert.equal(result.kind, "empty");
      assert.equal(result.html, null);
    }),
  );

  results.push(
    await runLoop("isNextProject: detects next.config.js and app-router dirs", async () => {
      assert.equal(isNextProject([{ path: "next.config.js", content: "" }]), true);
      assert.equal(isNextProject([{ path: "src/App.tsx", content: "" }]), false);
    }),
  );

  results.push(
    await runLoop("injectRelay: inserts the console relay right after <head>", async () => {
      const html = injectRelay("<html><head></head><body></body></html>");
      assert.ok(html.includes("parent.postMessage"));
      assert.ok(html.indexOf("<head>") < html.indexOf("parent.postMessage"));
    }),
  );

  results.push(
    await runLoop("inlineSources: inlines a local script, leaves a remote one untouched", async () => {
      const html = '<script src="a.js"></script><script src="https://cdn.example/x.js"></script>';
      const out = inlineSources(html, new Map([["a.js", "console.log('inline');"]]));
      assert.ok(out.includes("console.log('inline')"));
      assert.ok(out.includes('src="https://cdn.example/x.js"'));
    }),
  );

  allResults.push(...results);
  printSubsystemTable("CoCode - Preview Runtime", results);
});

// ── 5. Known gaps + final score ───────────────────────────────────────────────
test("Known gaps (not covered by this suite)", () => {
  console.log("\n=== Known gaps (require a browser/DOM harness the user opted out of) ===");
  console.table([
    { Area: "buildPreview() HTML actually rendered in a browser iframe", Reason: "Function-level CoCode testing only — no Playwright/browser automation" },
    { Area: "error-boundary.tsx / global-error.tsx React rendering", Reason: "Requires a DOM/browser test harness" },
  ]);
});

test("Final score", () => {
  printFinalScore(allResults);
});
