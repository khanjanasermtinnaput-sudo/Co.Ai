import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readProjectTree, buildDependencyGraph } from '../core/context-engine.js';
import { buildIndex, rank, tokenize } from '../core/retrieval.js';
import { parseArchitect, architectToContext } from '../core/architect.js';
import { analyzeImpact, transitiveImporters, impactToContext } from '../core/impact.js';
import { runDocumenter } from '../core/documenter.js';
import type { Blackboard } from '../types.js';

// ── retrieval (BM25) ──────────────────────────────────────────────────────────

function bm25Fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'cgntx-bm25-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'auth.ts'), 'export function login(user, pin) { return authenticate(user, pin); }');
  writeFileSync(join(root, 'src', 'cart.ts'), 'export function addToCart(item) { return cart.push(item); }');
  writeFileSync(join(root, 'src', 'theme.ts'), 'export const colors = { primary: "#FF7A00" };');
  return root;
}

test('tokenize splits camelCase and drops stopwords', () => {
  const t = tokenize('parseToCart the userItem');
  assert.ok(t.includes('parse'));
  assert.ok(t.includes('cart'));
  assert.ok(t.includes('user'));
  assert.ok(t.includes('item'));
  assert.ok(!t.includes('the'));   // stopword
});

test('BM25 ranks the matching file first', () => {
  const root = bm25Fixture();
  try {
    const tree = readProjectTree(root);
    const graph = buildDependencyGraph(root, tree);
    const idx = buildIndex(root, tree, graph);
    const ranked = rank(idx, 'fix the user login authentication', 5);
    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].path, 'src/auth.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BM25 distinguishes shopping cart from auth', () => {
  const root = bm25Fixture();
  try {
    const tree = readProjectTree(root);
    const idx = buildIndex(root, tree);
    const ranked = rank(idx, 'add item to shopping cart', 5);
    assert.equal(ranked[0].path, 'src/cart.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── architect parsing ─────────────────────────────────────────────────────────

test('parseArchitect extracts sections', () => {
  const raw = [
    'APPROACH: Add a JWT-based auth module reusing the existing user store.',
    'TECH_STACK: Node.js + TypeScript + Express',
    'NEW_FILES:',
    '- src/auth/jwt.ts — token signing and verification',
    'MODIFY_FILES:',
    '- src/server.ts — mount the auth routes',
    'RISKS:',
    '- changing user store schema breaks existing sessions',
  ].join('\n');
  const d = parseArchitect(raw);
  assert.equal(d.approach, 'Add a JWT-based auth module reusing the existing user store.');
  assert.equal(d.techStack, 'Node.js + TypeScript + Express');
  assert.deepEqual(d.newFiles, ['src/auth/jwt.ts']);
  assert.deepEqual(d.modifyFiles, ['src/server.ts']);
  assert.equal(d.risks.length, 1);
});

test('parseArchitect treats "- none" as empty', () => {
  const raw = 'APPROACH: simple\nTECH_STACK: vanilla JS\nNEW_FILES:\n- index.html — entry\nMODIFY_FILES:\n- none\nRISKS:\n- none';
  const d = parseArchitect(raw);
  assert.deepEqual(d.modifyFiles, []);
  assert.deepEqual(d.risks, []);
  assert.ok(architectToContext(d).includes('Create these files: index.html'));
});

test('parseArchitect captures MULTIPLE items per section (regression: $-multiline)', () => {
  const raw = [
    'APPROACH: layered',
    'TECH_STACK: Node.js',
    'NEW_FILES:',
    '- src/a.ts — one',
    '- src/b.ts — two',
    '- src/c.ts — three',
    'MODIFY_FILES:',
    '- src/server.ts — mount',
    'RISKS:',
    '- risk one',
    '- risk two',
  ].join('\n');
  const d = parseArchitect(raw);
  assert.deepEqual(d.newFiles, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  assert.deepEqual(d.modifyFiles, ['src/server.ts']);
  assert.equal(d.risks.length, 2);
});

// ── impact analysis ───────────────────────────────────────────────────────────

const graph = {
  imports: { 'a.ts': ['util.ts'], 'b.ts': ['util.ts'], 'c.ts': ['a.ts'] },
  importers: { 'util.ts': ['a.ts', 'b.ts'], 'a.ts': ['c.ts'] },
};

test('transitiveImporters walks the dependency chain', () => {
  const deps = transitiveImporters(graph, 'util.ts');
  assert.ok(deps.includes('a.ts'));
  assert.ok(deps.includes('b.ts'));
  assert.ok(deps.includes('c.ts')); // c imports a, a imports util — transitive
});

test('analyzeImpact flags a widely-imported file', () => {
  const report = analyzeImpact({ graph, modifyFiles: ['util.ts'] });
  assert.equal(report.skipped, undefined);
  assert.equal(report.risks.length, 1);
  assert.ok(report.affectedFiles.includes('a.ts'));
  assert.ok(impactToContext(report).includes('util.ts'));
});

test('analyzeImpact skips gracefully without a graph', () => {
  const report = analyzeImpact({ graph: undefined, modifyFiles: ['x.ts'] });
  assert.equal(report.skipped, true);
  assert.equal(report.risks.length, 0);
});

// ── documenter ────────────────────────────────────────────────────────────────

function fakeBlackboard(): Blackboard {
  return {
    sessionId: 't', task: 'build a todo app', mode: 'normal', context: '',
    plan: [], planText: '',
    files: [
      { path: 'index.html', language: 'html', content: '<h1>Todo</h1>' },
      { path: 'app.js', language: 'javascript', content: 'console.log("todo")' },
    ],
    review: [], reviewText: '', validations: [], iterations: 1, log: [],
  };
}

test('runDocumenter parses a returned README block', async () => {
  const call = async () => '```path=README.md\n# Todo App\n\nA simple todo.\n```';
  const docs = await runDocumenter(call, fakeBlackboard());
  assert.equal(docs.length, 1);
  assert.equal(docs[0].path, 'README.md');
  assert.ok(docs[0].content.includes('Todo App'));
});

test('runDocumenter falls back to a synthesised README', async () => {
  const call = async () => 'no code block here';
  const docs = await runDocumenter(call, fakeBlackboard());
  assert.equal(docs.length, 1);
  assert.equal(docs[0].path, 'README.md');
  assert.ok(docs[0].content.includes('index.html'));
});
