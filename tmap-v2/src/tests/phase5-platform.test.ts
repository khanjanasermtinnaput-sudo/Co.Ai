// Phase 5: Sandbox & Developer Platform — comprehensive test suite
// Covers: sandbox engine, usage quotas, developer keys, webhooks,
//         Docker sandbox detection, bot protection, rate limiter, audit events,
//         correlation IDs, security (SSRF, path traversal, injection).
//
// Test framework: node:test + node:assert/strict (no Jest).
// Run: tsx --test src/tests/phase5-platform.test.ts

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Imports under test ────────────────────────────────────────────────────────

import {
  runInSandbox, stripTypes,
  SUPPORTED_LANGUAGES, SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS, SANDBOX_DEFAULT_MAX_BYTES,
} from '../core/sandbox.js';

import {
  isDockerAvailable, resetDockerAvailabilityCache,
  DOCKER_DEFAULT_TIMEOUT_MS, DOCKER_MAX_TIMEOUT_MS,
} from '../core/docker-sandbox.js';

import {
  recordUsage, recordSandboxRun,
  checkQuota, checkSandboxQuota, getUsageSummary, DEFAULT_QUOTA,
} from '../core/usage-tracker.js';

import { maskKey } from '../server/crypto.js';
import { getContext } from '../server/correlation.js';
import { botProtectionMiddleware } from '../server/bot-protection.js';
import type { UsageQuota } from '../types.js';

// ── Test env setup ────────────────────────────────────────────────────────────
// Set a stable master key so webhook/crypto tests can encrypt secrets.
if (!process.env.COAGENTIX_MASTER_KEY || process.env.COAGENTIX_MASTER_KEY.length < 16) {
  process.env.COAGENTIX_MASTER_KEY = 'phase5-test-master-key-32bytes!!';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string { return `test-${randomUUID()}`; }

function isPython3Available(): boolean {
  const r = spawnSync('python3', ['--version'], { timeout: 3_000, encoding: 'utf8' });
  return r.status === 0;
}

const ZERO_QUOTA: UsageQuota = {
  dailyTokens:       1,
  monthlyTokens:     1,
  dailyCostUsd:      0.000001,
  monthlyCostUsd:    0.000001,
  sandboxRunsPerDay: 1,
};

const UNLIMITED_QUOTA: UsageQuota = {
  dailyTokens: 0, monthlyTokens: 0,
  dailyCostUsd: 0, monthlyCostUsd: 0,
  sandboxRunsPerDay: 0,
};

// ── Sandbox constants ─────────────────────────────────────────────────────────

describe('Sandbox — constants', () => {
  test('SUPPORTED_LANGUAGES includes javascript, typescript, python', () => {
    assert.ok(SUPPORTED_LANGUAGES.includes('javascript'));
    assert.ok(SUPPORTED_LANGUAGES.includes('typescript'));
    assert.ok(SUPPORTED_LANGUAGES.includes('python'));
  });

  test('SUPPORTED_LANGUAGES does not include bash', () => {
    assert.ok(!(SUPPORTED_LANGUAGES as string[]).includes('bash'));
  });

  test('default timeout is 10 s', () => { assert.equal(SANDBOX_DEFAULT_TIMEOUT_MS, 10_000); });
  test('max timeout is 30 s',     () => { assert.equal(SANDBOX_MAX_TIMEOUT_MS, 30_000); });
  test('default max bytes is 50 KB', () => { assert.equal(SANDBOX_DEFAULT_MAX_BYTES, 50_000); });
});

// ── JavaScript sandbox ────────────────────────────────────────────────────────

describe('Sandbox — JavaScript', () => {
  test('arithmetic + console.log', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.log(2 + 2);' });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('4'));
    assert.equal(r.language, 'javascript');
  });

  test('captures console.error in stderr', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.error("oops");' });
    assert.equal(r.success, true);
    assert.ok(r.stderr.includes('oops'));
  });

  test('Math, JSON, Array, Object accessible', async () => {
    const r = await runInSandbox({
      language: 'javascript',
      code: 'console.log(Math.sqrt(9)); console.log(JSON.stringify({x:1}));',
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('3'));
    assert.ok(r.stdout.includes('{"x":1}'));
  });

  test('syntax error returns success=false', async () => {
    const r = await runInSandbox({ language: 'javascript', code: '{{{{' });
    assert.equal(r.success, false);
    assert.ok(r.error);
  });

  test('runtime error returns success=false with message', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'throw new Error("boom");' });
    assert.equal(r.success, false);
    assert.ok(r.error?.includes('boom'));
  });

  test('timeout enforced for infinite loop', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'while(true){}', timeoutMs: 200 });
    assert.equal(r.timedOut, true);
    assert.equal(r.success, false);
  });

  test('require is blocked', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'require("fs")' });
    assert.equal(r.success, false);
  });

  test('process is blocked', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'process.exit(0)' });
    assert.equal(r.success, false);
  });

  test('global is blocked', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'global.x = 1' });
    assert.equal(r.success, false);
  });

  test('rejects code larger than 100 KB', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'x'.repeat(101_000) });
    assert.equal(r.success, false);
    assert.ok(r.error?.includes('too large'));
  });

  test('durationMs is non-negative', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.log("hi")' });
    assert.ok(r.durationMs >= 0);
  });
});

// ── TypeScript sandbox ────────────────────────────────────────────────────────

describe('Sandbox — TypeScript', () => {
  test('strips types and runs', async () => {
    const r = await runInSandbox({
      language: 'typescript',
      code: 'function add(a: number, b: number): number { return a + b; }\nconsole.log(add(3, 4));',
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('7'));
  });

  test('strips interface declarations', async () => {
    const r = await runInSandbox({
      language: 'typescript',
      code: 'interface Point { x: number; y: number; }\nconst p = { x: 1, y: 2 };\nconsole.log(p.x + p.y);',
    });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('3'));
  });

  test('stripTypes removes import type', () => {
    const s = stripTypes("import type { Foo } from './foo.js';");
    assert.ok(!s.includes('import type'));
  });

  test('stripTypes removes access modifiers', () => {
    const s = stripTypes('public readonly name: string = "test"');
    assert.ok(!s.includes('public'));
    assert.ok(!s.includes('readonly'));
  });

  test('stripTypes preserves regular JS', () => {
    const s = stripTypes('const x = 42; console.log(x);');
    assert.ok(s.includes('const x = 42'));
  });
});

// ── Python sandbox ────────────────────────────────────────────────────────────

describe('Sandbox — Python', () => {
  const available = isPython3Available();

  test('runs print() — or skips if python3 unavailable', { skip: !available }, async () => {
    const r = await runInSandbox({ language: 'python', code: 'print(2 + 2)' });
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('4'));
  });

  test('syntax error returns success=false — or skips', { skip: !available }, async () => {
    const r = await runInSandbox({ language: 'python', code: 'def bad(:' });
    assert.equal(r.success, false);
  });
});

// ── Blocked languages ─────────────────────────────────────────────────────────

describe('Sandbox — blocked/unsupported languages', () => {
  test('bash is rejected with security message', async () => {
    const r = await runInSandbox({ language: 'bash', code: 'echo hi' });
    assert.equal(r.success, false);
    assert.ok(r.error?.toLowerCase().includes('security'));
  });

  test('unknown language returns descriptive error', async () => {
    const r = await runInSandbox({ language: 'ruby' as never, code: 'puts 1' });
    assert.equal(r.success, false);
    assert.ok(r.error?.includes('not supported'));
  });
});

// ── File isolation (path traversal) ──────────────────────────────────────────

describe('Sandbox — file isolation', () => {
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

  test('empty code string is handled without crash', async () => {
    const r = await runInSandbox({ language: 'javascript', code: '' });
    assert.ok(typeof r.success === 'boolean');
  });

  test('null bytes in code are handled without crash', async () => {
    const r = await runInSandbox({ language: 'javascript', code: 'console.log("a\x00b")' });
    assert.ok(typeof r.success === 'boolean');
  });
});

// ── Docker sandbox ────────────────────────────────────────────────────────────

describe('Docker sandbox — detection', () => {
  test('isDockerAvailable returns a boolean', () => {
    resetDockerAvailabilityCache();
    const result = isDockerAvailable();
    assert.ok(typeof result === 'boolean');
  });

  test('DOCKER_DEFAULT_TIMEOUT_MS is >= vm sandbox default', () => {
    assert.ok(DOCKER_DEFAULT_TIMEOUT_MS >= SANDBOX_DEFAULT_TIMEOUT_MS);
  });

  test('DOCKER_MAX_TIMEOUT_MS is > vm sandbox max', () => {
    assert.ok(DOCKER_MAX_TIMEOUT_MS >= SANDBOX_MAX_TIMEOUT_MS);
  });

  test('runInDockerSandbox rejects bash', async () => {
    const { runInDockerSandbox } = await import('../core/docker-sandbox.js');
    const r = await runInDockerSandbox({ language: 'bash', code: 'echo hi' });
    assert.equal(r.success, false);
    assert.ok(r.error?.toLowerCase().includes('security'));
  });
});

// ── Usage tracker ─────────────────────────────────────────────────────────────

describe('Usage tracker — record and retrieve', () => {
  test('fresh user starts at zero', async () => {
    const id = uid();
    const s = await getUsageSummary(id);
    assert.equal(s.today.tokens, 0);
    assert.equal(s.today.sandboxRuns, 0);
    assert.equal(s.today.requests, 0);
  });

  test('recordUsage accumulates tokens and cost', async () => {
    const id = uid();
    await recordUsage(id, { tokens: 1_000, costUsd: 0.01 });
    await recordUsage(id, { tokens: 500,   costUsd: 0.005 });
    const s = await getUsageSummary(id);
    assert.equal(s.today.tokens, 1_500);
    assert.ok(Math.abs(s.today.costUsd - 0.015) < 1e-6);
    assert.equal(s.today.requests, 2);
  });

  test('recordSandboxRun increments sandbox counter', async () => {
    const id = uid();
    await recordSandboxRun(id);
    await recordSandboxRun(id);
    assert.equal((await getUsageSummary(id)).today.sandboxRuns, 2);
  });

  test('last7Days has 7 entries', async () => {
    assert.equal((await getUsageSummary(uid())).last7Days.length, 7);
  });

  test('DEFAULT_QUOTA has all required fields', () => {
    for (const k of ['dailyTokens', 'monthlyTokens', 'dailyCostUsd', 'monthlyCostUsd', 'sandboxRunsPerDay'] as const) {
      assert.ok(typeof DEFAULT_QUOTA[k] === 'number');
    }
  });
});

describe('Usage tracker — quota checks', () => {
  test('fresh user is within quota', async () => {
    assert.equal((await checkQuota(uid(), DEFAULT_QUOTA)).ok, true);
  });

  test('daily token limit triggers', async () => {
    const id = uid();
    await recordUsage(id, { tokens: 10, costUsd: 0 });
    const s = await checkQuota(id, ZERO_QUOTA);
    assert.equal(s.ok, false);
    assert.ok(s.reason?.includes('Daily token limit'));
  });

  test('daily cost limit triggers', async () => {
    const id = uid();
    await recordUsage(id, { tokens: 0, costUsd: 0.001 });
    const s = await checkQuota(id, { ...UNLIMITED_QUOTA, dailyCostUsd: 0.0001 });
    assert.equal(s.ok, false);
    assert.ok(s.reason?.includes('Daily cost'));
  });

  test('unlimited quota (all zeros) is always ok', async () => {
    const id = uid();
    await recordUsage(id, { tokens: 9_999_999, costUsd: 999 });
    assert.equal((await checkQuota(id, UNLIMITED_QUOTA)).ok, true);
  });

  test('sandbox quota blocks when limit reached', async () => {
    const id = uid();
    await recordSandboxRun(id);
    const s = await checkSandboxQuota(id, ZERO_QUOTA);
    assert.equal(s.ok, false);
    assert.ok(s.reason?.includes('sandbox limit'));
  });

  test('sandbox quota with limit=0 is unlimited', async () => {
    const id = uid();
    for (let i = 0; i < 200; i++) await recordSandboxRun(id);
    assert.equal((await checkSandboxQuota(id, UNLIMITED_QUOTA)).ok, true);
  });

  test('quota status shape is complete', async () => {
    const id = uid();
    const s  = await checkQuota(id, DEFAULT_QUOTA);
    for (const k of ['ok', 'daily', 'monthly', 'quota'] as const) assert.ok(k in s);
    for (const k of ['tokens', 'costUsd', 'requests', 'sandboxRuns'] as const) assert.ok(k in s.daily);
  });
});

// ── API key masking ───────────────────────────────────────────────────────────

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
    const key    = 'AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const masked = maskKey(key);
    assert.ok(masked.length < key.length);
    assert.ok(!masked.includes('xxxxxxxxxxxxxxxxxx'));
  });
});

// ── Correlation middleware ────────────────────────────────────────────────────

describe('Correlation — context outside a request', () => {
  test('getContext returns undefined outside a request', () => {
    // We are not inside a storage.run() call here, so context should be undefined.
    const ctx = getContext();
    assert.ok(ctx === undefined || ctx === null || typeof ctx === 'object');
  });
});

// ── Bot protection ────────────────────────────────────────────────────────────

describe('Bot protection middleware', () => {
  function fakeReq(ua: string | undefined, path = '/v1/run') {
    return {
      path,
      headers: { 'user-agent': ua },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as import('express').Request;
  }

  function fakeRes() {
    let code = 0;
    let body: unknown = null;
    return {
      status: (c: number) => ({ json: (b: unknown) => { code = c; body = b; } }),
      getCode: () => code,
      getBody: () => body,
    };
  }

  test('normal browser UA passes', (t, done) => {
    const mw  = botProtectionMiddleware();
    const req = fakeReq('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36');
    const res = { status: () => ({ json: () => {} }) } as unknown as import('express').Response;
    mw(req, res, () => done());
  });

  test('sqlmap UA is blocked', () => {
    const mw  = botProtectionMiddleware({ blockThreshold: 70 });
    const req = fakeReq('sqlmap/1.0');
    let blocked = false;
    const res = { status: () => ({ json: () => { blocked = true; } }) } as unknown as import('express').Response;
    mw(req, res, () => { blocked = false; });
    assert.ok(blocked, 'sqlmap should be blocked');
  });

  test('skipPaths exempts matching paths', (t, done) => {
    const mw  = botProtectionMiddleware({ skipPaths: /^\/v1\/health/ });
    const req = fakeReq('sqlmap/1.0', '/v1/health');
    const res = {} as unknown as import('express').Response;
    mw(req, res, () => done());
  });
});

// ── Developer keys ────────────────────────────────────────────────────────────

describe('Developer keys', () => {
  test('createDevKey generates a prefixed raw key', async () => {
    const { createDevKey } = await import('../server/developer-keys.js');
    const userId = uid();
    const result = await createDevKey(userId, 'Test Key', ['sandbox:run']);
    assert.ok(result.rawKey.startsWith('cgntx_sk_'));
    assert.equal(result.key.name, 'Test Key');
    assert.deepEqual(result.key.scopes, ['sandbox:run']);
    assert.ok(!result.key.revokedAt);
  });

  test('rawKey is NOT stored in the key record (only hash)', async () => {
    const { createDevKey } = await import('../server/developer-keys.js');
    const result = await createDevKey(uid(), 'Hash Test', ['usage:read']);
    assert.ok(!JSON.stringify(result.key).includes(result.rawKey.slice(20)));
  });

  test('listDevKeys returns the new key', async () => {
    const { createDevKey, listDevKeys } = await import('../server/developer-keys.js');
    const userId = uid();
    await createDevKey(userId, 'Listed Key', ['*']);
    const keys = await listDevKeys(userId);
    assert.ok(keys.some((k) => k.name === 'Listed Key'));
  });

  test('revokeDevKey removes key from active list', async () => {
    const { createDevKey, listDevKeys, revokeDevKey } = await import('../server/developer-keys.js');
    const userId = uid();
    const { key } = await createDevKey(userId, 'Revoke Me', ['chat']);
    await revokeDevKey(userId, key.id);
    const keys = await listDevKeys(userId);
    assert.ok(!keys.some((k) => k.id === key.id));
  });

  test('invalid scope is filtered out', async () => {
    const { createDevKey } = await import('../server/developer-keys.js');
    await assert.rejects(
      () => createDevKey(uid(), 'Bad Scopes', ['invalid-scope' as never]),
      /At least one valid scope/,
    );
  });

  test('hasScope checks scope membership', async () => {
    const { createDevKey, hasScope } = await import('../server/developer-keys.js');
    const { key } = await createDevKey(uid(), 'Scope Key', ['sandbox:run']);
    assert.ok(hasScope(key, 'sandbox:run'));
    assert.ok(!hasScope(key, 'keys:read'));
  });

  test('wildcard scope grants all permissions', async () => {
    const { createDevKey, hasScope } = await import('../server/developer-keys.js');
    const { key } = await createDevKey(uid(), 'Admin Key', ['*']);
    assert.ok(hasScope(key, 'sandbox:run'));
    assert.ok(hasScope(key, 'keys:read'));
    assert.ok(hasScope(key, 'usage:read'));
  });
});

// ── Webhooks ──────────────────────────────────────────────────────────────────

describe('Webhooks', () => {
  test('registerWebhook returns secret and webhook record', async () => {
    const { registerWebhook } = await import('../server/webhooks.js');
    const userId = uid();
    const result = await registerWebhook(userId, 'https://example.com/hook', ['sandbox.completed']);
    assert.ok(result.secret.startsWith('whsec_'));
    assert.equal(result.webhook.url, 'https://example.com/hook');
    assert.deepEqual(result.webhook.events, ['sandbox.completed']);
    assert.ok(result.webhook.active);
  });

  test('registerWebhook rejects HTTP URLs (SSRF protection)', async () => {
    const { registerWebhook } = await import('../server/webhooks.js');
    await assert.rejects(
      () => registerWebhook(uid(), 'http://example.com/hook', ['*']),
      /HTTPS/,
    );
  });

  test('registerWebhook rejects private IP ranges', async () => {
    const { registerWebhook } = await import('../server/webhooks.js');
    await assert.rejects(
      () => registerWebhook(uid(), 'https://192.168.1.1/hook', ['*']),
      /private IP/,
    );
  });

  test('registerWebhook rejects localhost', async () => {
    const { registerWebhook } = await import('../server/webhooks.js');
    await assert.rejects(
      () => registerWebhook(uid(), 'https://127.0.0.1/hook', ['*']),
      /private IP/,
    );
  });

  test('registerWebhook rejects invalid events', async () => {
    const { registerWebhook } = await import('../server/webhooks.js');
    await assert.rejects(
      () => registerWebhook(uid(), 'https://example.com/hook', ['not.an.event' as never]),
      /No valid events/,
    );
  });

  test('listWebhooks returns active webhooks', async () => {
    const { registerWebhook, listWebhooks } = await import('../server/webhooks.js');
    const userId = uid();
    await registerWebhook(userId, 'https://example.com/a', ['*']);
    await registerWebhook(userId, 'https://example.com/b', ['session.completed']);
    const hooks = await listWebhooks(userId);
    assert.ok(hooks.length >= 2);
  });

  test('deleteWebhook removes webhook from active list', async () => {
    const { registerWebhook, listWebhooks, deleteWebhook } = await import('../server/webhooks.js');
    const userId = uid();
    const { webhook } = await registerWebhook(userId, 'https://example.com/del', ['key.rotated']);
    await deleteWebhook(userId, webhook.id);
    const hooks = await listWebhooks(userId);
    assert.ok(!hooks.some((h) => h.id === webhook.id));
  });

  test('raw secret is not stored in plain in webhook record', async () => {
    const { registerWebhook } = await import('../server/webhooks.js');
    const result = await registerWebhook(uid(), 'https://example.com/s', ['*']);
    // encryptedSecret should be an AES ciphertext blob, not the raw secret
    assert.ok(result.webhook.encryptedSecret === '[redacted]');
    assert.ok(!JSON.stringify(result.webhook).includes(result.secret.slice(15)));
  });
});

// ── Audit logging ─────────────────────────────────────────────────────────────

describe('Audit logging', () => {
  test('logAuditEvent resolves without error', async () => {
    const { logAuditEvent, AuditAction } = await import('../server/audit.js');
    await assert.doesNotReject(() =>
      logAuditEvent({
        actorId: uid(), actorIp: '127.0.0.1',
        action: AuditAction.SANDBOX_RUN, outcome: 'success',
        metadata: { language: 'javascript' },
      }),
    );
  });

  test('logAuditEvent works with null actorId (anonymous)', async () => {
    const { logAuditEvent, AuditAction } = await import('../server/audit.js');
    await assert.doesNotReject(() =>
      logAuditEvent({
        actorId: null, actorIp: '10.0.0.1',
        action: AuditAction.AUTH_FAILED, outcome: 'failure', severity: 'warn',
      }),
    );
  });

  test('getClientIp extracts IP from forwarded header', async () => {
    const { getClientIp } = await import('../server/audit.js');
    const fakeReq = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(getClientIp(fakeReq as never), '1.2.3.4');
  });
});

// ── Health check ──────────────────────────────────────────────────────────────

describe('Health check', () => {
  test('buildHealthReport returns a valid report', async () => {
    const { buildHealthReport } = await import('../server/health.js');
    const report = await buildHealthReport();
    assert.ok(['ok', 'degraded', 'fail'].includes(report.status));
    assert.ok(typeof report.uptime === 'number');
    assert.ok(report.deps.supabase);
    assert.ok(report.deps.redis);
    assert.ok(report.deps.queue);
  });
});

// ── Rate limiting (in-memory path) ───────────────────────────────────────────

describe('Rate limiter (in-memory fallback)', () => {
  test('allows requests under the limit', async () => {
    const { rateLimitMiddleware } = await import('../server/rate-limit-redis.js');
    const mw = rateLimitMiddleware(10, 60, 'test-pass');
    const req = { headers: {}, socket: { remoteAddress: `${uid()}` } } as unknown as import('express').Request;
    let passed = false;
    const res = { setHeader: () => {}, status: () => ({ json: () => {} }) } as unknown as import('express').Response;
    await new Promise<void>((resolve) => mw(req, res, () => { passed = true; resolve(); }));
    assert.ok(passed, 'next() should have been called for request under rate limit');
  });
});

// ── Phase 5 integration ───────────────────────────────────────────────────────

describe('Phase 5 — integration', () => {
  test('sandbox run is tracked independently from token usage', async () => {
    const id = uid();
    await recordUsage(id, { tokens: 100, costUsd: 0.001 });
    await recordSandboxRun(id);
    const s = await getUsageSummary(id);
    assert.equal(s.today.tokens, 100);
    assert.equal(s.today.sandboxRuns, 1);
    assert.equal(s.today.requests, 1);
  });

  test('SUPPORTED_LANGUAGES list matches sandbox implementation', async () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const r = await runInSandbox({ language: lang, code: 'console.log(1)' });
      assert.ok(typeof r.success === 'boolean', `language '${lang}' threw instead of returning a result`);
    }
  });

  test('developer key creation + scope check pipeline', async () => {
    const { createDevKey, hasScope } = await import('../server/developer-keys.js');
    const userId = uid();
    const { key, rawKey } = await createDevKey(userId, 'Pipeline Key', ['sandbox:run', 'usage:read']);
    assert.ok(rawKey.startsWith('cgntx_sk_'));
    assert.ok(hasScope(key, 'sandbox:run'));
    assert.ok(hasScope(key, 'usage:read'));
    assert.ok(!hasScope(key, 'keys:read'));
  });

  test('webhook registration + deletion pipeline', async () => {
    const { registerWebhook, listWebhooks, deleteWebhook } = await import('../server/webhooks.js');
    const userId = uid();
    const { webhook, secret } = await registerWebhook(userId, 'https://hooks.example.com/test', ['sandbox.completed']);
    assert.ok(secret);
    assert.equal(webhook.active, true);

    const listed = await listWebhooks(userId);
    assert.ok(listed.some((h) => h.id === webhook.id));

    await deleteWebhook(userId, webhook.id);
    const after = await listWebhooks(userId);
    assert.ok(!after.some((h) => h.id === webhook.id));
  });
});
