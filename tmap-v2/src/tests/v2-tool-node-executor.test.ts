// Tool Execution Engine (Master Prompt 6.3) — full DAG integration: a real
// two-node ExecGraph where node B is kind:'tool' and depends on node A's
// output, run through the actual executor.ts (retry/timeout/event-bus
// machinery), not a hand-simulated call. Confirms gatherInputs correctly
// threads a dependency's output into the tool node's source text, and that
// tool nodes get the same node_start/node_complete lifecycle events agent
// nodes do (executor.ts emits those generically, per-node, by design).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGraph, type ExecNode } from '../v2/dag.js';
import { executeGraph } from '../v2/executor.js';
import { TraceRecorder } from '../v2/trace.js';
import { EventBus, type WorkflowEvent } from '../v2/events.js';
import { runCodeExecTool } from '../v2/tool-agent.js';
import { gatherInputs } from '../v2/dag.js';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

test('a tool-kind node consumes a dependency\'s output and runs through the real executor', async () => {
  const coderNode: ExecNode = {
    id: 'coder-step',
    kind: 'agent',
    agentId: 'coder',
    fallbackAgentIds: [],
    dependencies: [],
    retry: { maxRetries: 0, backoffMs: 1 },
    timeoutMs: 5_000,
    status: 'pending',
    attempts: 0,
    run: async () => '```js\nconsole.log("from-dependency-output")\n```',
  };

  const toolNode: ExecNode = {
    id: 'verify-step',
    kind: 'tool',
    agentId: 'code-exec',
    fallbackAgentIds: [],
    dependencies: ['coder-step'],
    retry: { maxRetries: 0, backoffMs: 1 },
    timeoutMs: 5_000,
    status: 'pending',
    attempts: 0,
    run: async (input, signal) => {
      const depText = Object.values(input as Record<string, unknown>).map(String).join('\n\n');
      return runCodeExecTool({ nodeId: 'verify-step', sourceText: depText, emit: () => {}, signal });
    },
  };

  const g = createGraph('req-tool-node', [coderNode, toolNode]);
  const bus = new EventBus();
  const seen: WorkflowEvent[] = [];
  bus.onAny((e) => seen.push(e));

  await executeGraph(g, new TraceRecorder('req-tool-node'), bus, { maxParallel: 2 });

  assert.equal(g.nodes.get('verify-step')!.status, 'done');
  assert.match(String(g.nodes.get('verify-step')!.output), /from-dependency-output/);

  const toolNodeEvents = seen.filter((e) => 'nodeId' in e && e.nodeId === 'verify-step').map((e) => e.type);
  assert.deepEqual(toolNodeEvents, ['node_start', 'node_complete']);
});

test('gatherInputs feeds a done dependency\'s output into the tool node\'s input', () => {
  const done: ExecNode = {
    id: 'a', kind: 'agent', agentId: 'coder', fallbackAgentIds: [], dependencies: [],
    retry: { maxRetries: 0, backoffMs: 1 }, timeoutMs: 1000, status: 'done', attempts: 1,
    output: '```js\nconsole.log(1)\n```', run: async () => '',
  };
  const tool: ExecNode = {
    id: 'b', kind: 'tool', agentId: 'code-exec', fallbackAgentIds: [], dependencies: ['a'],
    retry: { maxRetries: 0, backoffMs: 1 }, timeoutMs: 1000, status: 'pending', attempts: 0, run: async () => '',
  };
  const g = createGraph('r', [done, tool]);
  const input = gatherInputs(g, tool);
  assert.equal(input.a, '```js\nconsole.log(1)\n```');
});
