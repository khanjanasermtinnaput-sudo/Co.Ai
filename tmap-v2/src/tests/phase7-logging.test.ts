// Phase 7 — Logging test suite (node:test + node:assert/strict, no external services)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate all I/O to a temp dir; no Supabase in tests.
const TRACE_DIR = mkdtempSync(join(tmpdir(), 'p7-log-'));
process.env.AOF_TRACE_DIR = TRACE_DIR;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

after(() => rmSync(TRACE_DIR, { recursive: true, force: true }));

const {
  Logger, classifyError,
} = await import('../v2/logger.js');
const { TraceRecorder } = await import('../v2/trace.js');
const { createGraph }   = await import('../v2/dag.js');
const { EventBus }      = await import('../v2/events.js');
const { executeGraph }  = await import('../v2/executor.js');

// ── TraceID / ExecutionID ─────────────────────────────────────────────────────

test('Logger creates a traceId and a unique executionId per instance', () => {
  const a = new Logger('req-1');
  const b = new Logger('req-1');
  assert.equal(a.traceId, 'req-1');
  assert.ok(a.executionId.startsWith('req-1:'), 'executionId includes traceId');
  assert.notEqual(a.executionId, b.executionId, 'two loggers for the same request get different executionIds (replay support)');
});

// ── Node Logs ─────────────────────────────────────────────────────────────────

test('logNode emits info on success and error on failure', () => {
  const log = new Logger('req-node');
  log.logNode('n1', 'coder', 0, true);
  log.logNode('n2', 'coder', 1, false);
  const entries = log.getEntries();
  const success = entries.find((e) => e.nodeId === 'n1')!;
  const failure = entries.find((e) => e.nodeId === 'n2')!;
  assert.equal(success.category, 'node');
  assert.equal(success.level, 'info');
  assert.equal(failure.level, 'error');
  assert.equal(failure.meta.ok, false);
});

test('forNode returns only entries for that nodeId', () => {
  const log = new Logger('req-fornode');
  log.logNode('alpha', 'coder', 0, true);
  log.logNode('beta',  'coder', 0, false);
  log.logLatency('alpha', 'coder', 'execution', 120);
  assert.equal(log.forNode('alpha').length, 2);
  assert.equal(log.forNode('beta').length, 1);
  assert.equal(log.forNode('gamma').length, 0);
});

// ── Agent Logs ────────────────────────────────────────────────────────────────

test('logAgent records provider, latency, cost and ok flag', () => {
  const log = new Logger('req-agent');
  log.logAgent('n1', 'coder', 'deepseek', 420, 0.00012, true);
  const [e] = log.forCategory('agent');
  assert.equal(e.category, 'agent');
  assert.equal(e.meta.provider, 'deepseek');
  assert.equal(e.meta.latencyMs, 420);
  assert.equal(e.meta.costUsd, 0.00012);
  assert.equal(e.meta.ok, true);
});

// ── Latency Logs ──────────────────────────────────────────────────────────────

test('logLatency uses warn level for slow nodes (>30s)', () => {
  const log = new Logger('req-lat');
  log.logLatency('n1', 'coder', 'execution', 1_500);
  log.logLatency('n2', 'coder', 'execution', 35_000);
  const [fast, slow] = log.forCategory('latency');
  assert.equal(fast.level, 'debug');
  assert.equal(slow.level, 'warn');
});

// ── Cost Logs ─────────────────────────────────────────────────────────────────

test('logCost records costUsd and totalCost() aggregates correctly', () => {
  const log = new Logger('req-cost');
  log.logCost('n1', 'coder',    0.00050, { input: 100, output: 200 });
  log.logCost('n2', 'reviewer', 0.00030);
  assert.ok(Math.abs(log.totalCost() - 0.00080) < 1e-9, 'total matches sum of entries');
  const entries = log.forCategory('cost');
  assert.equal(entries.length, 2);
  assert.equal(entries[1].meta.tokens, null); // second call had no tokens
});

test('totalCost() returns 0 when no cost entries', () => {
  const log = new Logger('req-nocost');
  log.logSystem('start');
  assert.equal(log.totalCost(), 0);
});

// ── Failure Logs ──────────────────────────────────────────────────────────────

test('logFailure records error and auto-classifies RCA kind', () => {
  const log = new Logger('req-fail');
  log.logFailure('n1', 'coder', 'HTTP 402: insufficient credits');
  const [e] = log.forCategory('failure');
  assert.equal(e.level, 'error');
  assert.equal(e.meta.kind, 'provider_quota');
});

test('classifyError covers all RCA kinds', () => {
  assert.equal(classifyError('HTTP 401 Unauthorized'), 'provider_auth');
  assert.equal(classifyError('HTTP 403 Forbidden'),    'provider_auth');
  assert.equal(classifyError('HTTP 429 rate limit'),   'provider_quota');
  assert.equal(classifyError('402 need more credits'), 'provider_quota');
  assert.equal(classifyError('HTTP 503 unavailable'),  'provider_unavailable');
  assert.equal(classifyError('ECONNREFUSED'),           'provider_unavailable');
  assert.equal(classifyError('request timed out'),     'timeout');
  assert.equal(classifyError('low quality output'),    'bad_output');
  assert.equal(classifyError('something random'),      'unknown');
});

// ── Root Cause Analysis ───────────────────────────────────────────────────────

test('rcaSummary returns recovered:true and empty chains when no failures', () => {
  const log = new Logger('req-rca-ok');
  log.logNode('n1', 'coder', 0, true);
  const rca = log.rcaSummary();
  assert.equal(rca.totalFailures, 0);
  assert.equal(rca.recovered, true);
  assert.equal(rca.cascadeChain.length, 0);
  assert.equal(rca.rootCause, undefined);
});

test('rcaSummary identifies root cause, cascade, and recovery', () => {
  const log = new Logger('req-rca-fail');

  // n1 fails (root), n2 skipped (cascade), n1 succeeds via replan (recovery).
  log.logFailure('n1', 'coder',    'HTTP 429 rate limit');
  log.logFailure('n2', 'reviewer', 'skipped: dependency n1 did not complete');
  log.logNode('n1', 'planner', 0, true); // success after failure → recovery

  const rca = log.rcaSummary();
  assert.equal(rca.rootCause?.nodeId, 'n1');
  assert.equal(rca.rootCause?.kind, 'provider_quota');
  assert.ok(rca.cascadeChain.includes('n2'), 'n2 is in cascade chain');
  assert.equal(rca.totalFailures, 2);
  assert.equal(rca.recovered, true);
  assert.ok(rca.recoveryPath.includes('planner'));
});

test('rcaSummary marks recovered:false when no subsequent success', () => {
  const log = new Logger('req-rca-unrecovered');
  log.logFailure('n1', 'coder', 'ECONNREFUSED');
  const rca = log.rcaSummary();
  assert.equal(rca.recovered, false);
  assert.equal(rca.recoveryPath.length, 0);
});

// ── Replay timeline ───────────────────────────────────────────────────────────

test('timeline() returns entries in insertion order with non-negative offsetMs', () => {
  const log = new Logger('req-timeline');
  log.logSystem('start');
  log.logNode('n1', 'coder', 0, true);
  log.logCost('n1', 'coder', 0.001);
  const tl = log.timeline();
  assert.equal(tl.length, 3);
  assert.equal(tl[0].offsetMs, 0);
  for (const e of tl) assert.ok(e.offsetMs >= 0, `offsetMs should be ≥ 0, got ${e.offsetMs}`);
  // Entries must be sorted by insertion / ascending ts.
  for (let i = 1; i < tl.length; i++) {
    assert.ok(tl[i].offsetMs >= tl[i - 1].offsetMs, 'offsetMs non-decreasing');
  }
});

test('timeline() is empty when no entries logged', () => {
  assert.equal(new Logger('empty').timeline().length, 0);
});

// ── forCategory ───────────────────────────────────────────────────────────────

test('forCategory filters correctly across all categories', () => {
  const log = new Logger('req-cat');
  log.logNode('n1',   'coder', 0, true);
  log.logLatency('n1', 'coder', 'exec', 100);
  log.logCost('n1',   'coder', 0.001);
  log.logAgent('n1',  'coder', 'deepseek', 100, 0.001, true);
  log.logFailure('n1', 'coder', 'oops');
  log.logSystem('done');
  for (const cat of ['node', 'latency', 'cost', 'agent', 'failure', 'system'] as const) {
    assert.equal(log.forCategory(cat).length, 1, `expected 1 entry for category ${cat}`);
  }
});

// ── TraceRecorder + Logger integration ───────────────────────────────────────

test('TraceRecorder proxies trace.node() to Logger: node, latency, failure entries appear', () => {
  const logger = new Logger('req-tr-ok');
  const rec    = new TraceRecorder('req-tr-ok', logger);
  rec.node({ nodeId: 'n1', agentId: 'coder', attempt: 0, ok: true,  latencyMs: 250 });
  rec.node({ nodeId: 'n2', agentId: 'coder', attempt: 0, ok: false, latencyMs: 800, error: 'HTTP 401' });

  assert.equal(logger.forCategory('node').length,    2);
  assert.equal(logger.forCategory('latency').length, 2);
  assert.equal(logger.forCategory('failure').length, 1);
  assert.equal(logger.forCategory('failure')[0].meta.kind, 'provider_auth');
});

test('TraceRecorder.get() includes executionId, totalCostUsd, rcaSummary', () => {
  const logger = new Logger('req-tr-get');
  const rec    = new TraceRecorder('req-tr-get', logger);
  rec.node({ nodeId: 'n1', agentId: 'coder', attempt: 0, ok: true, latencyMs: 100, costUsd: 0.005 });
  const trace = rec.get();
  assert.equal(trace.executionId, logger.executionId);
  assert.ok(trace.totalCostUsd !== undefined, 'totalCostUsd present');
  assert.ok(trace.rcaSummary   !== undefined, 'rcaSummary present');
  assert.equal(trace.rcaSummary?.recovered, true);
});

test('trace.persist() flushes logger to JSONL when no Supabase configured', async () => {
  const traceId = `req-flush-${Date.now()}`;
  const logger  = new Logger(traceId);
  const rec     = new TraceRecorder(traceId, logger);
  logger.logSystem('test persist');
  await rec.persist();

  const logFile = join(TRACE_DIR, `log-${traceId}.jsonl`);
  assert.ok(existsSync(logFile), 'JSONL log file created');
  const lines = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.ok(lines.length >= 1, 'at least one line written');
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed['traceId'], traceId);
});

// ── Executor integration ──────────────────────────────────────────────────────

test('executeGraph with Logger-wired TraceRecorder logs all node outcomes', async () => {
  const traceId = 'req-exec-log';
  const logger  = new Logger(traceId);
  const rec     = new TraceRecorder(traceId, logger);

  let failFirst = true;
  const g = createGraph(traceId, [
    {
      id: 'flaky', kind: 'agent', agentId: 'coder', fallbackAgentIds: [],
      dependencies: [], retry: { maxRetries: 1, backoffMs: 1 }, timeoutMs: 2_000,
      status: 'pending', attempts: 0,
      run: async () => { if (failFirst) { failFirst = false; throw new Error('HTTP 503'); } return 'ok'; },
    },
  ]);

  await executeGraph(g, rec, new EventBus(), { maxParallel: 1 });

  // Retry succeeded → both failure and success logs exist.
  assert.ok(logger.forCategory('node').some((e) => e.meta.ok === false), 'failure attempt logged');
  assert.ok(logger.forCategory('node').some((e) => e.meta.ok === true),  'success attempt logged');
  assert.ok(logger.forCategory('failure').length >= 1, 'failure category populated');
  assert.equal(logger.forCategory('failure')[0].meta.kind, 'provider_unavailable');

  // RCA shows root cause and eventual recovery.
  const rca = logger.rcaSummary();
  assert.equal(rca.rootCause?.kind, 'provider_unavailable');
  assert.equal(rca.recovered, true);
});
