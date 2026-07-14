import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDomainGraph, domainGraphMaxParallel } from '../v2/domain-graph.js';
import { integrateResults } from '../v2/result-integrator.js';
import { ExecutionContextBus } from '../v2/context-bus.js';
import type { CodeFile } from '../types.js';

const noopRunner = async (): Promise<CodeFile[]> => [];

test('buildDomainGraph: backend depends on database when both are present', () => {
  const graph = buildDomainGraph('req1', ['database', 'backend'], noopRunner, new ExecutionContextBus());
  assert.deepEqual(graph.nodes.get('backend')?.dependencies, ['database']);
  assert.deepEqual(graph.nodes.get('database')?.dependencies, []);
});

test('buildDomainGraph: frontend and database are independent (parallel root nodes)', () => {
  const graph = buildDomainGraph('req1', ['database', 'frontend'], noopRunner, new ExecutionContextBus());
  assert.deepEqual(graph.nodes.get('frontend')?.dependencies, []);
  assert.deepEqual(graph.nodes.get('database')?.dependencies, []);
});

test('buildDomainGraph: testing depends on whichever of backend/frontend are present', () => {
  const graph = buildDomainGraph('req1', ['backend', 'frontend', 'testing'], noopRunner, new ExecutionContextBus());
  const deps = graph.nodes.get('testing')?.dependencies ?? [];
  assert.ok(deps.includes('backend'));
  assert.ok(deps.includes('frontend'));
});

test('buildDomainGraph: documentation depends on every other present domain', () => {
  const graph = buildDomainGraph('req1', ['database', 'backend', 'documentation'], noopRunner, new ExecutionContextBus());
  const deps = graph.nodes.get('documentation')?.dependencies ?? [];
  assert.ok(deps.includes('database'));
  assert.ok(deps.includes('backend'));
  assert.ok(!deps.includes('documentation'));
});

test('buildDomainGraph: every domain node falls back to the generic coder agent', () => {
  const graph = buildDomainGraph('req1', ['backend'], noopRunner, new ExecutionContextBus());
  assert.deepEqual(graph.nodes.get('backend')?.fallbackAgentIds, ['coder']);
});

test('domainGraphMaxParallel: caps at 3 for shallow, 5 for deep, never below 1', () => {
  assert.equal(domainGraphMaxParallel(1, false), 1);
  assert.equal(domainGraphMaxParallel(10, false), 3);
  assert.equal(domainGraphMaxParallel(10, true), 5);
  assert.equal(domainGraphMaxParallel(0, false), 1);
});

// ── Result Integrator ─────────────────────────────────────────────────────────

test('integrateResults: merges files from every done domain node', () => {
  const graph = buildDomainGraph('req1', ['backend', 'frontend'], noopRunner, new ExecutionContextBus());
  const backend = graph.nodes.get('backend')!;
  backend.status = 'done';
  backend.output = [{ path: 'src/api.ts', language: 'typescript', content: 'a' }] satisfies CodeFile[];
  const frontend = graph.nodes.get('frontend')!;
  frontend.status = 'done';
  frontend.output = [{ path: 'src/App.tsx', language: 'typescript', content: 'b' }] satisfies CodeFile[];

  const result = integrateResults(graph, ['backend', 'frontend']);
  assert.equal(result.files.length, 2);
  assert.equal(result.conflicts.length, 0);
});

test('integrateResults: a path conflict is resolved to the later domain and reported', () => {
  const graph = buildDomainGraph('req1', ['database', 'backend'], noopRunner, new ExecutionContextBus());
  const database = graph.nodes.get('database')!;
  database.status = 'done';
  database.output = [{ path: 'src/shared/schema.ts', language: 'typescript', content: 'from-database' }] satisfies CodeFile[];
  const backend = graph.nodes.get('backend')!;
  backend.status = 'done';
  backend.output = [{ path: 'src/shared/schema.ts', language: 'typescript', content: 'from-backend' }] satisfies CodeFile[];

  const result = integrateResults(graph, ['database', 'backend']);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].content, 'from-backend');
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].path, 'src/shared/schema.ts');
});

test('integrateResults: skips nodes that never completed', () => {
  const graph = buildDomainGraph('req1', ['backend'], noopRunner, new ExecutionContextBus());
  // node stays 'pending' — never ran
  const result = integrateResults(graph, ['backend']);
  assert.equal(result.files.length, 0);
});
