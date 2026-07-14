// Tool Execution Engine (Master Prompt Part 6.3) — the v2 DAG's tool-node
// dispatch (v2/tool-agent.ts), which v2/run.ts's runAgent delegates to for
// agentId === 'code-exec'. Covers the piece that was previously entirely
// absent: a DAG node whose kind is 'tool' (v2/registry.ts) actually running
// through the ToolRegistry (v2/tools/), not an LLM call.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractCodeFence, runCodeExecTool, V2_GRANTED_PERMISSION } from '../v2/tool-agent.js';
import { globalToolRegistry } from '../v2/tools/index.js';
import { listAgents, getAgent } from '../v2/registry.js';
import { rankAgents } from '../v2/score.js';
import { HealthStore } from '../dars/health.js';

// ── registry: the declared-but-previously-unpopulated NodeKind='tool' slot ────

test('code-exec is registered as a kind:"tool" agent, discoverable by RAA scoring', () => {
  const desc = getAgent('code-exec');
  assert.ok(desc);
  assert.equal(desc!.kind, 'tool');
  assert.ok(listAgents().some((a) => a.id === 'code-exec'));
});

test('rankAgents scores the tool candidate without crashing on its missing role/healthKey', () => {
  const health = new HealthStore();
  const ranked = rankAgents({ test: 0.9, validate: 0.8 }, listAgents(), { health });
  const codeExecScore = ranked.find((r) => r.agentId === 'code-exec');
  assert.ok(codeExecScore);
  assert.ok(codeExecScore!.total > 0, 'a test/validate-heavy request gives the tool a nonzero score');
});

// ── extractCodeFence ────────────────────────────────────────────────────────

test('extractCodeFence pulls the last fenced block and normalizes a language alias', () => {
  const text = 'Here is the function:\n```js\nconsole.log("hi")\n```\nDone.';
  const fence = extractCodeFence(text);
  assert.equal(fence?.language, 'javascript');
  assert.equal(fence?.code, 'console.log("hi")');
});

test('extractCodeFence defaults to javascript for an untagged fence', () => {
  const fence = extractCodeFence('```\n1+1\n```');
  assert.equal(fence?.language, 'javascript');
});

test('extractCodeFence returns null when there is no fenced block', () => {
  assert.equal(extractCodeFence('just plain text, no code here'), null);
});

// ── runCodeExecTool: permission → extract → execute → format ──────────────────

test('runCodeExecTool runs real code end-to-end and formats stdout', async () => {
  const events: object[] = [];
  const result = await runCodeExecTool({
    nodeId: 'n1',
    sourceText: '```js\nconsole.log("v2-tool-agent-ok")\n```',
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
  });
  assert.match(result, /v2-tool-agent-ok/);
  assert.equal(events.length, 0, 'no permission_denied event on a successful run');
});

test('runCodeExecTool throws (for the executor\'s retry/fallback path) when no code fence is present', async () => {
  await assert.rejects(
    () => runCodeExecTool({
      nodeId: 'n2', sourceText: 'no code here', emit: () => {}, signal: new AbortController().signal,
    }),
    /no fenced code block/,
  );
});

test('code-exec tool is registered at exactly the permission the v2 engine grants itself', () => {
  const tool = globalToolRegistry.getTool('code-exec')!;
  assert.equal(globalToolRegistry.permissionSatisfied(V2_GRANTED_PERMISSION, tool.permission), true);
});

test('runCodeExecTool emits permission_denied and throws when the tool needs more than granted', async () => {
  // Register a stand-in tool that requires more than V2_GRANTED_PERMISSION to
  // prove the denial path fires — without touching the real code-exec adapter.
  globalToolRegistry.registerTool({
    id: 'code-exec',
    permission: 'admin',
    async execute() {
      throw new Error('should never be called — permission check must short-circuit first');
    },
  });
  try {
    const events: Array<{ type?: string }> = [];
    await assert.rejects(
      () => runCodeExecTool({
        nodeId: 'n3', sourceText: '```js\n1\n```', emit: (e) => events.push(e as { type?: string }), signal: new AbortController().signal,
      }),
      /permission denied/,
    );
    assert.equal((events[0] as { event?: { type?: string } })?.event?.type, 'permission_denied');
  } finally {
    // Restore the real adapter for any other test file sharing this process.
    const { codeExecAdapter } = await import('../v2/tools/code-exec-adapter.js');
    globalToolRegistry.registerTool(codeExecAdapter);
  }
});
