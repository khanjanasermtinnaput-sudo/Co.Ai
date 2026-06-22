import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthStore } from '../dars/health.js';
import { listAgents, normalizeCapabilities } from '../v2/registry.js';
import { rankAgents } from '../v2/score.js';
import { createGraph, topoOrder, type ExecNode } from '../v2/dag.js';
import { executeGraph } from '../v2/executor.js';
import { TraceRecorder } from '../v2/trace.js';
import { EventBus } from '../v2/events.js';
import { plan, makeReplan, type RaaConfig, type SubTask } from '../v2/raa.js';
import { serializeGraph, applyCheckpoint } from '../v2/checkpoint.js';

// Keep trace persistence local + off-network for tests.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

function node(over: Partial<ExecNode> & { id: string }): ExecNode {
  return {
    kind: 'agent',
    agentId: 'x',
    fallbackAgentIds: [],
    dependencies: [],
    retry: { maxRetries: 0, backoffMs: 1 },
    timeoutMs: 1_000,
    status: 'pending',
    attempts: 0,
    run: async () => 'ok',
    ...over,
  };
}

// ── DAG ──────────────────────────────────────────────────────────────────────

test('topoOrder orders by dependency and detects cycles', () => {
  const g = createGraph('r', [
    node({ id: 'a' }),
    node({ id: 'b', dependencies: ['a'] }),
    node({ id: 'c', dependencies: ['b'] }),
  ]);
  const order = topoOrder(g);
  assert.deepEqual(order, ['a', 'b', 'c']);

  const cyclic = createGraph('r', [
    node({ id: 'a', dependencies: ['b'] }),
    node({ id: 'b', dependencies: ['a'] }),
  ]);
  assert.throws(() => topoOrder(cyclic), /cycle detected/);
});

test('topoOrder rejects dangling dependencies', () => {
  const g = createGraph('r', [node({ id: 'a', dependencies: ['ghost'] })]);
  assert.throws(() => topoOrder(g), /unknown node/);
});

// ── Scoring (no keyword filtering) ─────────────────────────────────────────────

test('rankAgents scores ALL agents and ranks by capability fit', () => {
  const health = new HealthStore();
  const ranked = rankAgents({ code: 1 }, listAgents(), { health });
  // Every registered agent is scored — selection never pre-filters by keyword.
  assert.equal(ranked.length, listAgents().length);
  // The coder (code:0.95) must win for a code-heavy task.
  assert.equal(ranked[0].agentId, 'coder');
  // Scores strictly descending.
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].total >= ranked[i].total);
  }
});

test('rankAgents drops an agent whose circuit is open (reliability=0)', () => {
  const health = new HealthStore();
  // Trip the coder's provider (deepseek) circuit via auth failure.
  health.recordFailure('deepseek', 'auth');
  const ranked = rankAgents({ code: 1 }, listAgents(), { health });
  const coder = ranked.find((r) => r.agentId === 'coder');
  assert.ok(coder);
  assert.equal(coder!.parts.reliability, 0);
});

test('rankAgents selects the right specialist for research/writing/math/vision', () => {
  const health = new HealthStore();
  // The universal-assistant specialists must win for their own capability so the
  // v2 engine has parity with the v1 Chief Agent's domain routing.
  assert.equal(rankAgents({ research: 1 }, listAgents(), { health })[0].agentId, 'research');
  assert.equal(rankAgents({ write: 1 }, listAgents(), { health })[0].agentId, 'writing');
  assert.equal(rankAgents({ math: 1 }, listAgents(), { health })[0].agentId, 'math');
  assert.equal(rankAgents({ vision: 1 }, listAgents(), { health })[0].agentId, 'vision');
});

test('scoring exposes six factors incl. a latency factor that favors faster providers', () => {
  const slow = new HealthStore();
  // Drive the coder's provider (deepseek) latency EWMA high.
  for (let i = 0; i < 8; i++) slow.recordSuccess('deepseek', 9000);
  const coderSlow = rankAgents({ code: 1 }, listAgents(), { health: slow }).find((r) => r.agentId === 'coder')!;

  // All six spec factors are present and the slow provider scores low on latency.
  for (const k of ['capability', 'context', 'cost', 'historicalSuccess', 'reliability', 'latency'] as const) {
    assert.ok(typeof coderSlow.parts[k] === 'number', `missing factor ${k}`);
  }
  assert.ok(coderSlow.parts.latency < 0.3, 'slow provider ranks low on latency');

  const coderFresh = rankAgents({ code: 1 }, listAgents(), { health: new HealthStore() }).find((r) => r.agentId === 'coder')!;
  assert.ok(coderFresh.parts.latency > coderSlow.parts.latency, 'a fresh provider scores higher on latency');
});

// ── Capability normalization (the live-test bug fix) ────────────────────────

test('normalizeCapabilities maps synonyms, drops unknowns, clamps weights', () => {
  const out = normalizeCapabilities({ TypeScript: 1.5, jest: 0.4, banana: 1, security: 0.9 });
  assert.deepEqual(out, { code: 1, test: 0.4, security: 0.9 });
  assert.deepEqual(normalizeCapabilities({}), {});
  assert.deepEqual(normalizeCapabilities(undefined), {});
});

test('a code subtask with non-enum capability words still selects the coder', async () => {
  // Reproduces the live bug: LLM emitted {typescript, jest} → previously scored
  // capability 0 for everyone → cheapest (validator) won. Now it must pick coder.
  const cfg = baseCfg({
    decompose: async () => ({
      subtasks: [
        { id: 'build', description: 'write the function', requiredCapabilities: { typescript: 0.9, jest: 0.3 } as never, dependencies: [] },
      ],
    }),
  });
  const ep = await plan('x', 'req-norm', cfg);
  assert.equal(ep.graph.nodes.get('build')!.agentId, 'coder');
});

test('an empty capability subtask falls back to intent capabilities', async () => {
  const cfg = baseCfg({
    parseIntent: async (t) => ({ goal: t, complexity: 0.5, requiredCapabilities: { review: 1 } }),
    decompose: async () => ({
      subtasks: [{ id: 'n', description: 'do', requiredCapabilities: {}, dependencies: [] }],
    }),
  });
  const ep = await plan('x', 'req-fallback', cfg);
  assert.equal(ep.graph.nodes.get('n')!.agentId, 'reviewer'); // review:1 → reviewer
});

// ── RAA + executor: happy path ──────────────────────────────────────────────

function baseCfg(over: Partial<RaaConfig> = {}): RaaConfig {
  const health = new HealthStore();
  return {
    health,
    parseIntent: async (task) => ({
      goal: task,
      complexity: 0.7,
      requiredCapabilities: { code: 1 },
    }),
    decompose: async () => ({
      subtasks: [
        { id: 'design', description: 'plan it', requiredCapabilities: { plan: 1 }, dependencies: [] },
        { id: 'build', description: 'code it', requiredCapabilities: { code: 1 }, dependencies: ['design'] },
        { id: 'check', description: 'review it', requiredCapabilities: { review: 1 }, dependencies: ['build'] },
      ],
    }),
    runAgent: async (agentId, st) => `${st.id}:${agentId}:done`,
    ...over,
  };
}

test('plan builds a DAG and executeGraph runs it in dependency order', async () => {
  const cfg = baseCfg();
  const order: string[] = [];
  const wrapped = baseCfg({
    runAgent: async (agentId, st) => {
      order.push(st.id);
      return `${st.id}:${agentId}`;
    },
  });
  const ep = await plan('build a thing', 'req-1', wrapped);
  assert.equal(ep.graph.nodes.size, 3);
  assert.ok(ep.confidence > 0);
  // RAA assigned the right specialists by score, not by keyword.
  assert.equal(ep.graph.nodes.get('build')!.agentId, 'coder');

  const trace = new TraceRecorder('req-1');
  await executeGraph(ep.graph, trace, new EventBus(), { maxParallel: 4 });

  assert.deepEqual(order, ['design', 'build', 'check']);
  assert.equal(ep.graph.nodes.get('check')!.status, 'done');
  // Trace fully reconstructs the path.
  const t = trace.get();
  assert.equal(t.dag.length, 3);
  assert.equal(t.nodeLogs.filter((l) => l.ok).length, 3);
  void cfg;
});

// ── Retry, fallback, replan ─────────────────────────────────────────────────

test('runNode retries then succeeds', async () => {
  const g = createGraph('r', [
    node({
      id: 'flaky',
      retry: { maxRetries: 2, backoffMs: 1 },
      run: (() => {
        let n = 0;
        return async () => {
          if (n++ < 1) throw new Error('transient');
          return 'ok';
        };
      })(),
    }),
  ]);
  const trace = new TraceRecorder('r');
  await executeGraph(g, trace, new EventBus(), { maxParallel: 1 });
  const flaky = g.nodes.get('flaky')!;
  assert.equal(flaky.status, 'done');
  assert.equal(flaky.attempts, 2);
});

test('node falls back to the next-ranked agent on failure', async () => {
  // 'coder' (primary for code:1) always fails; the fallback must take over.
  const cfg = baseCfg({
    decompose: async () => ({
      subtasks: [{ id: 'build', description: 'x', requiredCapabilities: { code: 1 }, dependencies: [] }],
    }),
    runAgent: async (agentId, st) => {
      if (agentId === 'coder') throw new Error('coder down');
      return `${st.id}:${agentId}`;
    },
  });
  const ep = await plan('x', 'req-fb', cfg);
  const build = ep.graph.nodes.get('build')!;
  assert.equal(build.agentId, 'coder'); // primary before run

  const trace = new TraceRecorder('req-fb');
  await executeGraph(ep.graph, trace, new EventBus(), { maxParallel: 1 });

  assert.equal(build.status, 'done');
  assert.notEqual(build.agentId, 'coder'); // re-bound to a fallback
  const t = trace.get();
  assert.ok(t.nodeLogs.some((l) => l.agentId === 'coder' && !l.ok)); // coder failure logged
  assert.ok(t.nodeLogs.some((l) => l.ok)); // fallback success logged
});

test('executor triggers replan when fallbacks are exhausted, then recovers', async () => {
  const cfg = baseCfg({
    fallbacks: 0, // no fallbacks → straight to replan once the primary fails out
    decompose: async () => ({
      subtasks: [{ id: 'build', description: 'x', requiredCapabilities: { code: 1 }, dependencies: [] }],
    }),
    runAgent: async (agentId, st) => {
      if (agentId === 'coder') throw new Error('coder down'); // primary always fails
      return `${st.id}:${agentId}`;
    },
  });
  const ep = await plan('x', 'req-rp', cfg);
  const build = ep.graph.nodes.get('build')!;
  assert.equal(build.agentId, 'coder');
  assert.equal(build.fallbackAgentIds.length, 0);

  let replanCalls = 0;
  const replan = async (failed: ExecNode): Promise<string[]> => {
    replanCalls++;
    failed.agentId = 'planner'; // route around the failing agent
    failed.error = undefined;
    failed.status = 'pending'; // revive: pump retries with the new agent
    return [];
  };

  const trace = new TraceRecorder('req-rp');
  await executeGraph(ep.graph, trace, new EventBus(), { maxParallel: 1, maxReplans: 2, replan });

  assert.equal(replanCalls, 1);
  assert.ok(trace.get().replanEvents.length >= 1, 'a replan event was recorded');
  assert.equal(build.status, 'done');
  assert.equal(build.agentId, 'planner');
});

test('makeReplan re-ranks excluding the failed agent and revives the node', async () => {
  const cfg = baseCfg({
    decompose: async () => ({
      subtasks: [{ id: 'build', description: 'x', requiredCapabilities: { code: 1 }, dependencies: [] }],
    }),
  });
  const ep = await plan('x', 'req-mr', cfg);
  const build = ep.graph.nodes.get('build')!;
  build.status = 'failed';
  build.agentId = 'coder';
  build.error = 'boom';

  const added = await makeReplan(cfg, ep.subtasks)(build, ep.graph);
  assert.deepEqual(added, []);
  assert.equal(build.status, 'pending');
  assert.notEqual(build.agentId, 'coder'); // excluded the agent that just failed
});

test('terminal failure skips dependents; re-run resumes from failed node only', async () => {
  let buildShouldFail = true;
  const runs: string[] = [];
  const cfg = baseCfg({
    fallbacks: 0,
    runAgent: async (agentId, st) => {
      runs.push(st.id);
      if (st.id === 'build' && buildShouldFail) throw new Error('build broken');
      return `${st.id}:${agentId}`;
    },
  });
  const ep = await plan('x', 'req-rerun', cfg);

  // First run: build fails (no fallbacks, no replan) → check is skipped.
  await executeGraph(ep.graph, new TraceRecorder('req-rerun-1'), new EventBus(), { maxParallel: 2 });
  assert.equal(ep.graph.nodes.get('design')!.status, 'done');
  assert.equal(ep.graph.nodes.get('build')!.status, 'failed');
  assert.equal(ep.graph.nodes.get('check')!.status, 'skipped');

  // Fix the failure and re-run the SAME graph. 'design' is already done and must
  // NOT run again; build (reset) + check should run.
  buildShouldFail = false;
  ep.graph.nodes.get('build')!.status = 'pending';
  ep.graph.nodes.get('build')!.error = undefined;
  ep.graph.nodes.get('check')!.status = 'pending';
  runs.length = 0;

  await executeGraph(ep.graph, new TraceRecorder('req-rerun-2'), new EventBus(), { maxParallel: 2 });
  assert.equal(ep.graph.nodes.get('build')!.status, 'done');
  assert.equal(ep.graph.nodes.get('check')!.status, 'done');
  assert.ok(!runs.includes('design'), 'done node was not recomputed on re-run');
  assert.deepEqual(runs.sort(), ['build', 'check']);
});

// ── Checkpoint / resume across a simulated restart ──────────────────────────

test('checkpoint: serialize a partial run and resume on a brand-new graph', async () => {
  let aRuns1 = 0;
  const g1 = createGraph('ckpt', [
    node({ id: 'a', run: async () => { aRuns1++; return 'A'; } }),
    node({ id: 'b', dependencies: ['a'], run: async () => { throw new Error('boom'); } }),
  ]);
  let progressCalls = 0;
  await executeGraph(g1, new TraceRecorder('c1'), new EventBus(), {
    maxParallel: 2,
    onProgress: () => { progressCalls++; },
  });
  assert.equal(g1.nodes.get('a')!.status, 'done');
  assert.equal(g1.nodes.get('b')!.status, 'failed');
  assert.ok(progressCalls > 0, 'onProgress fired so a checkpointer could persist');

  // Persist + "restart": serialize, then rebuild a FRESH graph (all pending) as a
  // new process would, and re-apply the saved state. b now succeeds.
  const state = serializeGraph(g1);
  let aRuns2 = 0, bRuns2 = 0;
  const g2 = createGraph('ckpt', [
    node({ id: 'a', run: async () => { aRuns2++; return 'A-recomputed'; } }),
    node({ id: 'b', dependencies: ['a'], run: async () => { bRuns2++; return 'B'; } }),
  ]);
  applyCheckpoint(g2, state);
  assert.equal(g2.nodes.get('a')!.status, 'done');
  assert.equal(g2.nodes.get('a')!.output, 'A', 'a restored with its checkpointed output');

  // Resume policy: re-queue the failed node, then resume.
  g2.nodes.get('b')!.status = 'pending';
  g2.nodes.get('b')!.error = undefined;
  await executeGraph(g2, new TraceRecorder('c2'), new EventBus(), { maxParallel: 2 });

  assert.equal(aRuns2, 0, 'completed node a was NOT recomputed after resume');
  assert.equal(g2.nodes.get('a')!.output, 'A', 'a kept its checkpointed output');
  assert.equal(bRuns2, 1, 'only the previously-failed node re-ran');
  assert.equal(g2.nodes.get('b')!.status, 'done');
});
