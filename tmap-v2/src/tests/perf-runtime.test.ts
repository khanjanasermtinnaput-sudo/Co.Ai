// Performance test layer (Master Prompt 6.13). Deterministic, in-process,
// offline timing — NOT wall-clock-exact assertions (CI/Windows timing varies
// run to run), so every bound here is generous and relative, chosen to catch
// a genuine regression (an accidental O(n^2), a forgotten await-in-loop) —
// not to assert a specific number of milliseconds a laptop happens to hit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RunQueue } from '../v2/queue.js';
import { createGraph, type ExecNode } from '../v2/dag.js';
import { executeGraph } from '../v2/executor.js';
import { TraceRecorder } from '../v2/trace.js';
import { EventBus } from '../v2/events.js';

describe('RunQueue — throughput', () => {
  test('100 trivial tasks through a 4-slot queue complete well under a generous bound', async () => {
    const queue = new RunQueue(4);
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 100 }, () => queue.run(async () => { /* no-op */ })),
    );
    const elapsed = Date.now() - t0;
    // A no-op task through a fair FIFO semaphore should never approach 1s;
    // generous by ~50x over what's expected so ordinary CI jitter never flakes.
    assert.ok(elapsed < 5_000, `expected < 5000ms, got ${elapsed}ms`);
  });
});

describe('executeGraph — trivial DAG', () => {
  test('a 3-node linear graph of instant no-op nodes completes well under a generous bound', async () => {
    const mk = (id: string, deps: string[]): ExecNode => ({
      id,
      kind: 'agent',
      agentId: 'coder',
      fallbackAgentIds: [],
      dependencies: deps,
      retry: { maxRetries: 0, backoffMs: 1 },
      timeoutMs: 2_000,
      run: async () => 'ok',
      status: 'pending',
      attempts: 0,
    });
    const graph = createGraph('perf-run-1', [mk('a', []), mk('b', ['a']), mk('c', ['b'])]);
    const trace = new TraceRecorder('perf-run-1');
    const bus = new EventBus();

    const t0 = Date.now();
    await executeGraph(graph, trace, bus, { maxParallel: 3 });
    const elapsed = Date.now() - t0;

    assert.equal([...graph.nodes.values()].every((n) => n.status === 'done'), true);
    assert.ok(elapsed < 2_000, `expected < 2000ms, got ${elapsed}ms`);
  });
});
