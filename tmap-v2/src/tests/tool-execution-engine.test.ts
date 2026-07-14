// Tool Execution Engine (Master Prompt Part 6.3) — registry + the code-exec
// adapter, which wraps the EXISTING sandbox (core/sandbox.ts) rather than
// reimplementing execution. Runs fully offline (no Docker required — the vm
// engine is allowed outside production, see sandbox-policy.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { globalToolRegistry } from '../v2/tools/index.js';
import { permissionSatisfied } from '../v2/tools/registry.js';

test('code-exec adapter is registered on the global tool registry', () => {
  const tool = globalToolRegistry.getTool('code-exec');
  assert.ok(tool);
  assert.equal(tool!.permission, 'workspace-write');
});

test('listTools includes every registered adapter', () => {
  const ids = globalToolRegistry.listTools().map((t) => t.id);
  assert.ok(ids.includes('code-exec'));
});

test('permissionSatisfied respects the fixed ladder order', () => {
  assert.equal(permissionSatisfied('admin', 'read-only'), true);
  assert.equal(permissionSatisfied('read-only', 'admin'), false);
  assert.equal(permissionSatisfied('workspace-write', 'workspace-write'), true);
  assert.equal(permissionSatisfied('read-only', 'workspace-write'), false);
});

test('code-exec adapter runs real JS through the existing sandbox and returns stdout', async () => {
  const tool = globalToolRegistry.getTool('code-exec')!;
  const response = await tool.execute(
    { toolId: 'code-exec', operation: 'run', args: { language: 'javascript', code: 'console.log("tool-engine-ok")' } },
    new AbortController().signal,
  );
  assert.equal(response.status, 'success');
  assert.match((response.output as { stdout: string }).stdout, /tool-engine-ok/);
  assert.equal(response.toolId, 'code-exec');
  assert.ok(response.executionId);
});

test('code-exec adapter rejects an unsupported language without touching the sandbox', async () => {
  const tool = globalToolRegistry.getTool('code-exec')!;
  const response = await tool.execute(
    { toolId: 'code-exec', operation: 'run', args: { language: 'ruby', code: 'puts 1' } },
    new AbortController().signal,
  );
  assert.equal(response.status, 'error');
  assert.match(response.error ?? '', /language must be one of/);
});

test('code-exec adapter reports a sandbox runtime error as status "error", not a thrown exception', async () => {
  const tool = globalToolRegistry.getTool('code-exec')!;
  const response = await tool.execute(
    { toolId: 'code-exec', operation: 'run', args: { language: 'javascript', code: 'throw new Error("boom")' } },
    new AbortController().signal,
  );
  assert.equal(response.status, 'error');
});
