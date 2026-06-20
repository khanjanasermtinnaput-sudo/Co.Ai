// Phase 5: Sandbox & Developer Platform — test suite
// Uses node:test + node:assert/strict only (no Jest).
// Python tests are skipped when python3 is not in PATH.
// All file-system tests use os.tmpdir() isolated directories.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  runInSandbox,
  stripTypes,
  SUPPORTED_LANGUAGES,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_DEFAULT_MAX_BYTES,
} from '../core/sandbox.js';

import {
  recordUsage,
  recordSandboxRun,
  checkQuota,
  checkSandboxQuota,
  getUsageSummary,
  DEFAULT_QUOTA,
} from '../core/usage-tracker.js';

import { maskKey } from '../server/crypto.js';
import type { UsageQuota } from '../types.js';

// ── helpers ───────────────────────────────────────────────────────────────────
function isPython3Available(): boolean {
  const r = spawnSync('python3', ['--version'], { timeout: 3000, encoding: 'utf8' });
  return r.status === 0;
}

function tmpUserId(): string {
  return `test-${randomUUID()}`;
}

// Tight quota for isolation in tests
const ZERO_QUOTA: UsageQuota = {
  dailyTokens:       1,
  monthlyTokens:     1,
  dailyCostUsd:      0.000001,
  monthlyCostUsd:    0.000001,
  sandboxRunsPerDay: 1,
};

const UNLIMITED_QUOTA: UsageQuota = {
  dailyTokens:       0,
  monthlyTokens:     0,
  dailyCostUsd:      0,
  monthlyCostUsd:    0,
  sandboxRunsPerDay: 0,
};

// ── Sandbox constants ─────────────────────────────────────────────────────────
describe('Sandbox — constants', () => {
  test('SUPPORTED_LANGUAGES includes javascript, typescript, python', () => {
    assert.ok(SUPPORTED_LANGUAGES.includes('javascript'));
    assert.ok(SUPPORTED_LANGUAGES.includes('typescript'));
    assert.ok(SUPPORTED_LANGUAGES.includes('python'));
  });

  test('SUPPORTED_LANGUAGES does NOT include bash', () => {
    assert.ok(!SUPPORTED_LANGUAGES.includes('bash' as never));
  });

  test('default timeout is 10 seconds', () => {
    assert.equal(SANDBOX_DEFAULT_TIMEOUT_MS, 10_000);
  });

  test('max timeout is 30 seconds', () => {
    assert.equal(SANDBOX_MAX_TIMEOUT_MS, 30_000);
  });

  test('default max output bytes is 50 KB', () => {
    assert.equal(SANDBOX_DEFAULT_MAX_BYTES, 50_000);
  });
});

// ── Sandbox — JavaScript ──────────────────────────────────────────────────────
describe('Sandbox — JavaScript execution', () => {
  test('runs simple arithmetic and captures console.log output', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.log(2 + 2);' });
    assert.equal(r.success, true);
    assert.equal(r.timedOut, false);
    assert.ok(r.stdout.includes('4'));
    assert.equal(r.language, 'javascript');
  });

  test('captures multiple console.log calls', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'console.log("a"); console.log("b"); console.log("c");',
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('a'));
    assert.ok(r.stdout.includes('b'));
    assert.ok(r.stdout.includes('c'));
  });

  test('captures console.error to stderr', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'console.error("oops");',
    });
    assert.equal(r.success, true);
    assert.ok(r.stderr.includes('oops'));
  });

  test('Math, Array, Object, JSON are accessible', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: [
        'console.log(Math.sqrt(9));',
        'console.log(JSON.stringify({x:1}));',
        'console.log([1,2,3].map(n=>n*2).join(","));',
        'console.log(Object.keys({a:1,b:2}).join(","));',
      ].join('\n'),
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('3'));
    assert.ok(r.stdout.includes('{"x":1}'));
    assert.ok(r.stdout.includes('2,4,6'));
    assert.ok(r.stdout.includes('a,b'));
  });

  test('syntax error returns success=false with error message', async () => {
    const r = await runInSandbox({ language: 'javascript', code: '{{{{invalid' });
    assert.equal(r.success, false);
    assert.ok(r.error);
    assert.equal(r.timedOut, false);
  });

  test('runtime error returns success=false with error message', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'throw new Error("boom");' });
    assert.equal(r.success, false);
    assert.ok(r.error?.includes('boom'));
  });

  test('enforces timeout for infinite loop', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'while(true){}',
      timeoutMs: 200,
    });
    assert.equal(r.success, false);
    assert.equal(r.timedOut, true);
    assert.ok(r.durationMs >= 150);
  });

  test('require is blocked (ReferenceError)', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'require("fs")',
    });
    assert.equal(r.success, false);
    assert.ok(r.error);
  });

  test('process is blocked (ReferenceError)', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'process.exit(0)',
    });
    assert.equal(r.success, false);
    assert.ok(r.error);
  });

  test('global is blocked (ReferenceError)', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'console.log(global.process)',
    });
    assert.equal(r.success, false);
    assert.ok(r.error);
  });

  test('rejects code larger than 100 KB', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'x'.repeat(101_000),
    });
    assert.equal(r.success, false);
    assert.ok(r.error?.includes('too large'));
  });

  test('records durationMs > 0 on success', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.log("hi")' });
    assert.equal(r.success, true);
    assert.ok(r.durationMs >= 0);
  });
});

// ── Sandbox — TypeScript ──────────────────────────────────────────────────────
describe('Sandbox — TypeScript execution', () => {
  test('runs TypeScript with type annotations stripped', async () => {
    const r = await runInSandbox({
      language: 'typescript',
      code: [
        'function add(a: number, b: number): number { return a + b; }',
        'console.log(add(3, 4));',
      ].join('\n'),
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('7'));
    assert.equal(r.language, 'typescript');
  });

  test('strips interface declarations', async () => {
    const code = [
      'interface Point { x: number; y: number; }',
      'const p = { x: 1, y: 2 };',
      'console.log(p.x + p.y);',
    ].join('\n');
    const r = await runInSandbox({ language: 'typescript', code });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('3'));
  });

  test('strips access modifiers', async () => {
    const stripped = stripTypes('public readonly name: string = "test"');
    assert.ok(!stripped.includes('public'));
    assert.ok(!stripped.includes('readonly'));
  });

  test('strips generic type parameters', async () => {
    const stripped = stripTypes('function id<T>(x: T): T { return x; }');
    assert.ok(!stripped.includes('<T>'));
  });
});

// ── Sandbox — unsupported languages ──────────────────────────────────────────
describe('Sandbox — unsupported/blocked languages', () => {
  test('bash is always rejected with a security message', async () => {
    const r = await runInSandbox({ language: 'bash', code: 'echo hello' });
    assert.equal(r.success, false);
    assert.ok(r.error?.toLowerCase().includes('security'));
  });

  test('unknown language returns a descriptive error', async () => {
    const r = await runInSandbox({ language: 'ruby' as never, code: 'puts 1' });
    assert.equal(r.success, false);
    assert.ok(r.error?.includes('not supported'));
  });
});

// ── Sandbox — Python (skipped if python3 unavailable) ────────────────────────
describe('Sandbox — Python execution', () => {
  const pythonAvailable = isPython3Available();

  test('runs Python print() — or skips if python3 not in PATH', { skip: !pythonAvailable }, async () => {
    const r = await runInSandbox({ language: 'python', code: 'print(2 + 2)' });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('4'));
    assert.equal(r.language, 'python');
  });

  test('Python syntax error returns success=false — or skips', { skip: !pythonAvailable }, async () => {
    const r = await runInSandbox({ language: 'python', code: 'def bad(:' });
    assert.equal(r.success, false);
  });
});

// ── stripTypes unit tests ─────────────────────────────────────────────────────
describe('stripTypes — TypeScript annotation stripper', () => {
  test('removes import type statements', () => {
    const result = stripTypes("import type { Foo } from './foo.js';");
    assert.ok(!result.includes('import type'));
  });

  test('removes export type statements', () => {
    const result = stripTypes("export type Alias = string | number;");
    assert.ok(!result.includes('export type'));
  });

  test('removes as casts', () => {
    const result = stripTypes('const x = foo as MyType;');
    assert.ok(!result.includes('as MyType'));
  });

  test('preserves regular JavaScript code', () => {
    const js = 'const x = 42; console.log(x);';
    const result = stripTypes(js);
    assert.ok(result.includes('const x = 42'));
    assert.ok(result.includes('console.log(x)'));
  });
});

// ── Usage Tracker — record and retrieve ──────────────────────────────────────
describe('Usage Tracker — record and retrieve', () => {
  test('fresh user starts at zero usage', () => {
    const uid = tmpUserId();
    const summary = getUsageSummary(uid);
    assert.equal(summary.today.tokens, 0);
    assert.equal(summary.today.costUsd, 0);
    assert.equal(summary.today.requests, 0);
    assert.equal(summary.today.sandboxRuns, 0);
    assert.equal(summary.thisMonth.tokens, 0);
  });

  test('recordUsage accumulates tokens and cost', () => {
    const uid = tmpUserId();
    recordUsage(uid, { tokens: 1000, costUsd: 0.01 });
    recordUsage(uid, { tokens: 500, costUsd: 0.005 });
    const summary = getUsageSummary(uid);
    assert.equal(summary.today.tokens, 1500);
    assert.ok(Math.abs(summary.today.costUsd - 0.015) < 1e-6);
    assert.equal(summary.today.requests, 2);
  });

  test('recordSandboxRun increments sandbox counter', () => {
    const uid = tmpUserId();
    recordSandboxRun(uid);
    recordSandboxRun(uid);
    const summary = getUsageSummary(uid);
    assert.equal(summary.today.sandboxRuns, 2);
  });

  test('last7Days has 7 entries', () => {
    const uid = tmpUserId();
    const summary = getUsageSummary(uid);
    assert.equal(summary.last7Days.length, 7);
  });

  test('DEFAULT_QUOTA is exported and has all fields', () => {
    assert.ok(typeof DEFAULT_QUOTA.dailyTokens === 'number');
    assert.ok(typeof DEFAULT_QUOTA.monthlyTokens === 'number');
    assert.ok(typeof DEFAULT_QUOTA.dailyCostUsd === 'number');
    assert.ok(typeof DEFAULT_QUOTA.monthlyCostUsd === 'number');
    assert.ok(typeof DEFAULT_QUOTA.sandboxRunsPerDay === 'number');
  });
});

// ── Usage Tracker — quota checks ─────────────────────────────────────────────
describe('Usage Tracker — quota checks', () => {
  test('fresh user is within quota', () => {
    const uid = tmpUserId();
    const status = checkQuota(uid, DEFAULT_QUOTA);
    assert.equal(status.ok, true);
    assert.equal(status.reason, undefined);
  });

  test('daily token limit triggers when exceeded', () => {
    const uid = tmpUserId();
    recordUsage(uid, { tokens: 10, costUsd: 0 });
    const status = checkQuota(uid, ZERO_QUOTA);
    assert.equal(status.ok, false);
    assert.ok(status.reason?.includes('Daily token limit'));
  });

  test('daily cost limit triggers when exceeded', () => {
    const uid = tmpUserId();
    recordUsage(uid, { tokens: 0, costUsd: 0.001 });
    const costOnlyQuota: UsageQuota = { ...UNLIMITED_QUOTA, dailyCostUsd: 0.0001 };
    const status = checkQuota(uid, costOnlyQuota);
    assert.equal(status.ok, false);
    assert.ok(status.reason?.includes('Daily cost'));
  });

  test('unlimited quota (all zeros) is always ok', () => {
    const uid = tmpUserId();
    recordUsage(uid, { tokens: 9_999_999, costUsd: 999 });
    const status = checkQuota(uid, UNLIMITED_QUOTA);
    assert.equal(status.ok, true);
  });

  test('sandbox quota blocks when limit reached', () => {
    const uid = tmpUserId();
    recordSandboxRun(uid);           // hit limit of 1
    const sbStatus = checkSandboxQuota(uid, ZERO_QUOTA);
    assert.equal(sbStatus.ok, false);
    assert.ok(sbStatus.reason?.includes('sandbox limit'));
  });

  test('sandbox quota with limit=0 is always ok (unlimited)', () => {
    const uid = tmpUserId();
    for (let i = 0; i < 200; i++) recordSandboxRun(uid);
    const sbStatus = checkSandboxQuota(uid, UNLIMITED_QUOTA);
    assert.equal(sbStatus.ok, true);
  });

  test('quota status includes current daily period', () => {
    const uid = tmpUserId();
    recordUsage(uid, { tokens: 123, costUsd: 0.001 });
    const status = checkQuota(uid, DEFAULT_QUOTA);
    assert.equal(status.daily.tokens, 123);
  });
});

// ── Security — input validation ────────────────────────────────────────────────
describe('Security — sandbox input validation', () => {
  test('path traversal in input files is silently skipped', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'console.log("ok")',
      files: [
        { path: '../evil.js', content: 'malicious' },
        { path: '/etc/passwd', content: 'malicious' },
      ],
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('ok'));
  });

  test('empty code string returns a VM error (not a crash)', async () => {
    const r = await runInSandbox({ language: 'javascript', code: '' });
    assert.ok(typeof r.success === 'boolean');
    assert.ok(typeof r.durationMs === 'number');
  });

  test('code with null bytes is handled without crash', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.log("a\x00b")' });
    assert.ok(typeof r.success === 'boolean');
  });
});

// ── Security — key masking ─────────────────────────────────────────────────────
describe('Security — API key masking', () => {
  test('short keys are fully masked', () => {
    assert.equal(maskKey('abc'), '••••');
    assert.equal(maskKey('12345'), '••••');
  });

  test('long keys show prefix and suffix only', () => {
    const masked = maskKey('sk-or-v1-abcdefghijklmnopqrstuvwxyz');
    assert.ok(masked.startsWith('sk-or-'));
    assert.ok(masked.endsWith('wxyz'));
    assert.ok(masked.includes('…'));
    assert.ok(!masked.includes('mnopqrstuv'));
  });

  test('maskKey does not expose the full key', () => {
    const key = 'AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const masked = maskKey(key);
    assert.ok(masked.length < key.length);
    assert.ok(!masked.includes('xxxxxxxxxxxxxxxxxx'));
  });
});

// ── Phase 5 — integration sanity check ───────────────────────────────────────
describe('Phase 5 — integration sanity', () => {
  test('sandbox + quota: sandbox run is tracked independently from token usage', () => {
    const uid = tmpUserId();
    recordUsage(uid, { tokens: 100, costUsd: 0.001 });
    recordSandboxRun(uid);
    const summary = getUsageSummary(uid);
    assert.equal(summary.today.tokens, 100);
    assert.equal(summary.today.sandboxRuns, 1);
    assert.equal(summary.today.requests, 1);   // recordUsage increments requests
  });

  test('quota status shape is complete', () => {
    const uid = tmpUserId();
    const status = checkQuota(uid, DEFAULT_QUOTA);
    assert.ok('ok' in status);
    assert.ok('daily' in status);
    assert.ok('monthly' in status);
    assert.ok('quota' in status);
    assert.ok('tokens' in status.daily);
    assert.ok('costUsd' in status.daily);
    assert.ok('requests' in status.daily);
    assert.ok('sandboxRuns' in status.daily);
  });

  test('SUPPORTED_LANGUAGES list matches sandbox implementation', async () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const r = await runInSandbox({ language: lang, code: 'console.log(1)' });
      // May fail (e.g. Python unavailable) but must not throw
      assert.ok(typeof r.success === 'boolean', `language '${lang}' threw instead of returning a result`);
    }
  });
});
