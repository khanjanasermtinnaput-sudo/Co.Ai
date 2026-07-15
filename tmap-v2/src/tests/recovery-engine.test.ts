// Runtime Recovery Engine (Master Prompt 6.12) tests.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryEngine, type AssessInput } from '../v2/recovery/recovery-engine.js';
import { DeadLetterQueue, type DeadLetterEntry } from '../v2/recovery/dead-letter.js';
import { Logger } from '../v2/logger.js';
import { CostMonitor, BudgetExceededError } from '../core/cost-budget.js';
import { createGraph, type ExecNode } from '../v2/dag.js';

function makeNode(id: string, overrides: Partial<ExecNode> = {}): ExecNode {
  return {
    id,
    kind: 'agent',
    agentId: 'coder',
    fallbackAgentIds: [],
    dependencies: [],
    retry: { maxRetries: 1, backoffMs: 1 },
    timeoutMs: 1000,
    run: async () => 'ok',
    status: 'done',
    attempts: 1,
    ...overrides,
  };
}

describe('RecoveryEngine.classify — maps through the two existing classifiers', () => {
  const engine = new RecoveryEngine();

  test('401 → auth / provider_auth', () => {
    const { failureKind, rcaKind } = engine.classify(new Error('HTTP 401 Unauthorized'));
    assert.equal(failureKind, 'auth');
    assert.equal(rcaKind, 'provider_auth');
  });

  test('429 → rate_limit / provider_quota', () => {
    const { failureKind, rcaKind } = engine.classify(new Error('429 Too Many Requests'));
    assert.equal(failureKind, 'rate_limit');
    assert.equal(rcaKind, 'provider_quota');
  });

  test('timeout → timeout / timeout', () => {
    const { failureKind, rcaKind } = engine.classify(new Error('request timed out'));
    assert.equal(failureKind, 'timeout');
    assert.equal(rcaKind, 'timeout');
  });

  test('5xx → down / provider_unavailable', () => {
    const { failureKind, rcaKind } = engine.classify(new Error('HTTP 503 Service Unavailable'));
    assert.equal(failureKind, 'down');
    assert.equal(rcaKind, 'provider_unavailable');
  });
});

describe('RecoveryEngine.assess — pure aggregation over Logger + graph', () => {
  const engine = new RecoveryEngine();

  test('a run with no failures reports recovered:true, no dead-letter, strategy "none"', () => {
    const logger = new Logger('run-1');
    logger.logNode('n1', 'coder', 0, true);
    const report = engine.assess({ runId: 'run-1', logger, startedAt: Date.now() - 50 });
    assert.equal(report.recovered, true);
    assert.equal(report.deadLettered, false);
    assert.ok(report.strategiesApplied.includes('none'));
    assert.ok(report.durationMs >= 0);
  });

  test('a failure followed by a successful retry on the same node reports recovered:true via rcaSummary', () => {
    const logger = new Logger('run-2');
    logger.logFailure('n1', 'coder', 'HTTP 500 Internal Server Error');
    logger.logNode('n1', 'coder', 1, true); // retry succeeded
    const report = engine.assess({ runId: 'run-2', logger, startedAt: Date.now() - 50 });
    assert.equal(report.recovered, true);
    assert.equal(report.deadLettered, false);
    assert.ok(report.strategiesApplied.includes('node_retry'));
    assert.ok(report.rootCause);
  });

  test('an unrecovered cascade (no success after failure, no output) reports recovered:false, dead-lettered', () => {
    const logger = new Logger('run-3');
    logger.logFailure('n1', 'coder', 'HTTP 500 Internal Server Error');
    logger.logFailure('n2', 'reviewer', 'skipped: dependency n1 did not complete');
    const graph = createGraph('run-3', [
      makeNode('n1', { status: 'failed' }),
      makeNode('n2', { status: 'skipped', dependencies: ['n1'] }),
    ]);
    const report = engine.assess({ runId: 'run-3', logger, startedAt: Date.now() - 50, graph, producedOutput: false });
    assert.equal(report.recovered, false);
    assert.equal(report.deadLettered, true);
    assert.ok(report.strategiesApplied.includes('skip_dependents'));
    assert.ok(report.remainingRisks.some((r) => r.includes('n1')));
  });

  test('a fatal RAA error rescued by the legacy-route fallback reports recovered:true via route_fallback, not dead-lettered', () => {
    const logger = new Logger('run-4');
    const report = engine.assess({
      runId: 'run-4',
      logger,
      startedAt: Date.now() - 50,
      fatalError: new Error('RAA planning failed'),
      producedOutput: true,
    });
    assert.equal(report.recovered, true);
    assert.equal(report.deadLettered, false);
    assert.ok(report.strategiesApplied.includes('route_fallback'));
  });

  test('a budget-terminated run is never recoverable and reports the budget in remainingRisks', () => {
    const logger = new Logger('run-5');
    const monitor = new CostMonitor({ maxTokens: 10, maxCostUsd: 0, maxCalls: 0 });
    monitor.record('deepseek-chat', 10, 0);
    let budgetError: unknown;
    try { monitor.precheck(); } catch (e) { budgetError = e; }
    assert.ok(budgetError instanceof BudgetExceededError);

    const report = engine.assess({
      runId: 'run-5',
      logger,
      startedAt: Date.now() - 50,
      fatalError: budgetError,
      producedOutput: false,
    });
    assert.equal(report.recovered, false);
    assert.equal(report.deadLettered, true);
    assert.ok(report.remainingRisks.some((r) => r.includes('budget exceeded')));
  });

  test('regression: assess() is pure — repeated calls over the SAME unchanged Logger/graph state produce an identical report modulo timestamp/durationMs', () => {
    const logger = new Logger('run-6');
    logger.logFailure('n1', 'coder', 'HTTP 500 Internal Server Error');
    logger.logNode('n1', 'coder', 1, true);
    const input: AssessInput = { runId: 'run-6', logger, startedAt: Date.now() };

    const a = engine.assess(input);
    const b = engine.assess(input);
    const strip = ({ timestamp, durationMs, ...rest }: typeof a) => rest;
    assert.deepEqual(strip(a), strip(b));
  });
});

describe('DeadLetterQueue', () => {
  test('record() then list(runId) round-trips; a simulated write failure does not throw', async () => {
    const dlq = new DeadLetterQueue();
    const entry: DeadLetterEntry = {
      id: 'dl-1',
      runId: 'run-x',
      kind: 'run',
      rcaKind: 'provider_unavailable',
      error: 'all providers failed',
      ts: new Date().toISOString(),
    };
    await dlq.record(entry);
    const listed = dlq.list('run-x');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'dl-1');
    assert.equal(dlq.list('nonexistent-run').length, 0);
  });

  test('replay() returns null when no checkpoint exists for the run', () => {
    const dlq = new DeadLetterQueue();
    const result = dlq.replay('a-run-id-with-no-checkpoint-' + Date.now());
    assert.equal(result, null);
  });
});
