// Round 1 remediation tests — proves the three Round 1 fixes work.
//   #8  Hard token/cost/call budget (cost-budget.ts)
//   #5  Sandbox vm-fallback disabled in production (sandbox-policy.ts)
//   #4  Backup checksum create/verify round-trip (backup.ts) — regression lock
//
// Uses node:test + node:assert/strict only (no Jest). All file I/O is isolated
// under os.tmpdir(). Backup module reads its dirs at import time, so its env is
// set BEFORE the dynamic import inside the test.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  CostMonitor, BudgetExceededError, isBudgetError, defaultBudget,
  estimateTokens, estimateCost,
} from '../core/cost-budget.js';
import {
  resolveSandboxEngine, vmFallbackAllowed, isProductionRuntime,
  isHostedRuntime, sandboxFeatureEnabled,
} from '../core/sandbox-policy.js';

// ── #8 — Cost / token / call budget ──────────────────────────────────────────
describe('Round 1 #8 — hard cost budget', () => {
  test('record accumulates tokens, cost, and call count', () => {
    const m = new CostMonitor({ maxTokens: 0, maxCostUsd: 0, maxCalls: 0 });
    m.record('deepseek-chat', 1000, 2000);
    assert.equal(m.tokens, 3000);
    assert.equal(m.callCount, 1);
    assert.ok(m.cost > 0, 'cost should accumulate');
    const snap = m.snapshot();
    assert.equal(snap.tokensUsed, 3000);
    assert.equal(snap.calls, 1);
  });

  test('0 limits mean unlimited — precheck never throws', () => {
    const m = new CostMonitor({ maxTokens: 0, maxCostUsd: 0, maxCalls: 0 });
    for (let i = 0; i < 100; i++) { m.precheck(); m.record('deepseek-chat', 10_000, 10_000); }
    assert.equal(m.callCount, 100); // ran all 100 without tripping
  });

  test('call ceiling stops an infinite reasoning loop at exactly maxCalls', () => {
    const m = new CostMonitor({ maxTokens: 0, maxCostUsd: 0, maxCalls: 5 });
    let calls = 0;
    const fakeLlmCall = () => { m.precheck(); m.record('deepseek-chat', 100, 100); calls++; };
    assert.throws(
      () => { for (let i = 0; i < 1000; i++) fakeLlmCall(); },
      (e: unknown) => isBudgetError(e) && (e as BudgetExceededError).limitHit === 'calls',
    );
    assert.equal(calls, 5, 'exactly 5 calls ran before the 6th precheck blocked');
  });

  test('token ceiling blocks the next call once exceeded', () => {
    const m = new CostMonitor({ maxTokens: 1000, maxCostUsd: 0, maxCalls: 0 });
    m.precheck(); m.record('deepseek-chat', 600, 0); // 600 — under
    m.precheck(); m.record('deepseek-chat', 600, 0); // 1200 — now over
    assert.throws(() => m.precheck(),
      (e: unknown) => isBudgetError(e) && (e as BudgetExceededError).limitHit === 'tokens');
  });

  test('cost ceiling blocks the next call once exceeded', () => {
    const m = new CostMonitor({ maxTokens: 0, maxCostUsd: 0.0001, maxCalls: 0 });
    m.precheck(); m.record('qwen-plus', 100_000, 100_000); // well over $0.0001
    assert.throws(() => m.precheck(),
      (e: unknown) => isBudgetError(e) && (e as BudgetExceededError).limitHit === 'cost');
  });

  test('a single huge prompt trips the token ceiling on the next precheck', () => {
    const m = new CostMonitor({ maxTokens: 100, maxCostUsd: 0, maxCalls: 0 });
    m.precheck();
    m.recordText('deepseek-chat', 'x'.repeat(10_000), ''); // ~2500 tokens
    assert.throws(() => m.precheck(), isBudgetError);
  });

  test('defaultBudget reads env overrides and clamps to sane numbers', () => {
    const saved = process.env.COAGENTIX_MAX_LLM_CALLS;
    process.env.COAGENTIX_MAX_LLM_CALLS = '7';
    try {
      assert.equal(defaultBudget().maxCalls, 7);
      assert.equal(defaultBudget({ maxCalls: 3 }).maxCalls, 3); // explicit override wins
    } finally {
      if (saved === undefined) delete process.env.COAGENTIX_MAX_LLM_CALLS;
      else process.env.COAGENTIX_MAX_LLM_CALLS = saved;
    }
  });

  test('estimate helpers are shared and consistent', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens(''), 0);
    assert.ok(estimateCost('deepseek-chat', 1_000_000, 0) > 0);
    assert.equal(estimateCost('unknown-model', 0, 0), 0);
  });
});

// ── #5 — Sandbox vm-fallback disabled in production ───────────────────────────
describe('Round 1 #5 — sandbox execution policy', () => {
  const PROD = { NODE_ENV: 'production' } as Record<string, string | undefined>;
  const DEV = { NODE_ENV: 'development' } as Record<string, string | undefined>;

  test('production + no Docker → refuse (fail closed, no vm fallback)', () => {
    const d = resolveSandboxEngine({ dockerRequested: false, dockerAvailable: false }, PROD);
    assert.equal(d.engine, 'none');
    assert.match(d.reason ?? '', /Docker/i);
  });

  test('production + Docker available → docker (even if not explicitly requested)', () => {
    const d = resolveSandboxEngine({ dockerRequested: false, dockerAvailable: true }, PROD);
    assert.equal(d.engine, 'docker');
  });

  test('dev + no Docker → vm allowed (trusted local use)', () => {
    const d = resolveSandboxEngine({ dockerRequested: false, dockerAvailable: false }, DEV);
    assert.equal(d.engine, 'vm');
  });

  test('dev + Docker requested & available → docker', () => {
    const d = resolveSandboxEngine({ dockerRequested: true, dockerAvailable: true }, DEV);
    assert.equal(d.engine, 'docker');
  });

  test('SANDBOX_REQUIRE_DOCKER=1 forces docker-only even in dev', () => {
    const env = { NODE_ENV: 'development', SANDBOX_REQUIRE_DOCKER: '1' };
    assert.equal(resolveSandboxEngine({ dockerRequested: false, dockerAvailable: false }, env).engine, 'none');
    assert.equal(resolveSandboxEngine({ dockerRequested: false, dockerAvailable: true }, env).engine, 'docker');
  });

  test('SANDBOX_ALLOW_VM=1 is break-glass — permits vm even in production', () => {
    const env = { NODE_ENV: 'production', SANDBOX_ALLOW_VM: '1' };
    assert.equal(resolveSandboxEngine({ dockerRequested: false, dockerAvailable: false }, env).engine, 'vm');
  });

  test('SANDBOX_ENABLED=0 disables execution entirely', () => {
    const env = { NODE_ENV: 'development', SANDBOX_ENABLED: '0' };
    const d = resolveSandboxEngine({ dockerRequested: false, dockerAvailable: true }, env);
    assert.equal(d.engine, 'none');
    assert.equal(sandboxFeatureEnabled(env), false);
  });

  test('hosted runtimes (Vercel/Render/Railway) count as production', () => {
    assert.equal(isHostedRuntime({ VERCEL: '1' }), true);
    assert.equal(isHostedRuntime({ RENDER: 'true' }), true);
    assert.equal(isHostedRuntime({ RAILWAY_PROJECT_ID: 'abc' }), true);
    assert.equal(isProductionRuntime({ VERCEL: '1' }), true);
    assert.equal(vmFallbackAllowed({ VERCEL: '1' }), false); // no vm on Vercel
  });
});

// ── #4 — Backup checksum create/verify round-trip (regression lock) ───────────
describe('Round 1 #4 — backup checksum regression', () => {
  let dir: string;
  let backup: typeof import('../server/backup.js');
  let store: typeof import('../server/file-store.js');

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cgntx-bk-'));
    process.env.CGNTX_DATA_DIR = join(dir, 'data');
    process.env.CGNTX_BACKUP_DIR = join(dir, 'backups');
    process.env.COAGENTIX_MASTER_KEY = 'round1-test-master-key-32-bytes!!';
    delete process.env.VERCEL;
    // Import AFTER env is set (modules read dirs/key at load time).
    backup = await import('../server/backup.js');
    store = await import('../server/file-store.js');
    store.fsPut('users', 'u1', { id: 'u1', username: 'alice' });
    store.fsPut('users', 'u2', { id: 'u2', username: 'bob' });
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CGNTX_DATA_DIR;
    delete process.env.CGNTX_BACKUP_DIR;
    delete process.env.COAGENTIX_MASTER_KEY;
  });

  test('unencrypted backup validates (checksum matches)', async () => {
    const m = await backup.createBackup({ requestedBy: 'test', encrypt: false, collections: ['users'] });
    assert.equal(m.status, 'complete');
    assert.equal(m.recordCounts.users, 2);
    const v = backup.validateBackup(m.id);
    assert.equal(v.valid, true, v.error);
    assert.equal(v.recordCounts.users, 2);
    // readBackupArchive must not throw on a clean archive
    const archive = backup.readBackupArchive(m.id);
    assert.equal((archive.collections.users as unknown[]).length, 2);
  });

  test('encrypted backup validates (checksum matches through encrypt round-trip)', async () => {
    const m = await backup.createBackup({ requestedBy: 'test', encrypt: true, collections: ['users'] });
    assert.equal(m.status, 'complete');
    assert.equal(m.encrypted, true);
    const v = backup.validateBackup(m.id);
    assert.equal(v.valid, true, v.error);
  });

  test('tampered archive is rejected by checksum verification', async () => {
    const m = await backup.createBackup({ requestedBy: 'test', encrypt: false, collections: ['users'] });
    const file = join(process.env.CGNTX_BACKUP_DIR!, `${m.id}.bak`);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    // Mutate data but keep the original checksum → must fail verification.
    parsed.collections.users.push({ id: 'evil', username: 'attacker' });
    writeFileSync(file, JSON.stringify(parsed), 'utf8');
    const v = backup.validateBackup(m.id);
    assert.equal(v.valid, false);
    assert.match(v.error ?? '', /checksum/i);
  });
});
