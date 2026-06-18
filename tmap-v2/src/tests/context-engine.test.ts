import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readProjectTree, buildDependencyGraph, detectProjectType,
  selectRelevantFiles, detectConventions, buildContextV2, projectKey,
} from '../core/context-engine.js';
import { gatherProjectContext } from '../core/context.js';

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'nexora-ctx-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture', dependencies: { express: '^4.0.0' }, devDependencies: { typescript: '^5.0.0' },
  }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext' } }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'auth.ts'), [
    "import { hash } from './util.js';",
    "export function login(user: string, pin: string) {",
    "  return hash(user + pin);",
    "}",
  ].join('\n'));
  writeFileSync(join(root, 'src', 'util.ts'), [
    "export function hash(s: string): string {",
    "  return s.split('').reverse().join('');",
    "}",
  ].join('\n'));
  writeFileSync(join(root, 'src', 'unrelated.ts'), [
    "export const ANSWER = 42;",
  ].join('\n'));
  return root;
}

test('readProjectTree finds source files with relative posix paths', () => {
  const root = makeFixture();
  try {
    const tree = readProjectTree(root);
    const paths = tree.map((f) => f.path);
    assert.ok(paths.includes('src/auth.ts'));
    assert.ok(paths.includes('src/util.ts'));
    assert.ok(paths.includes('package.json'));
    assert.ok(paths.every((p) => !p.includes('\\') && !p.startsWith('/')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildDependencyGraph resolves ts import with .js suffix', () => {
  const root = makeFixture();
  try {
    const tree = readProjectTree(root);
    const graph = buildDependencyGraph(root, tree);
    assert.deepEqual(graph.imports['src/auth.ts'], ['src/util.ts']);
    assert.deepEqual(graph.importers['src/util.ts'], ['src/auth.ts']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectProjectType returns node-api-ts for express+typescript', () => {
  const root = makeFixture();
  try {
    const base = gatherProjectContext(root);
    const tree = readProjectTree(root);
    assert.equal(detectProjectType(base, tree), 'node-api-ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('selectRelevantFiles ranks task-matching file first', () => {
  const root = makeFixture();
  try {
    const tree = readProjectTree(root);
    const graph = buildDependencyGraph(root, tree);
    const relevant = selectRelevantFiles(root, 'fix the login auth flow', tree, graph, 3);
    assert.ok(relevant.length >= 1);
    assert.equal(relevant[0], 'src/auth.ts');
    assert.ok(!relevant.includes('src/unrelated.ts') || relevant.indexOf('src/unrelated.ts') > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectConventions reports strict mode and indentation', () => {
  const root = makeFixture();
  try {
    const tree = readProjectTree(root);
    const conv = detectConventions(root, tree);
    assert.ok(conv.some((c) => c.includes('indentation')));
    assert.ok(conv.includes('typescript: strict mode'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildContextV2 produces summary with relevant excerpts', () => {
  const root = makeFixture();
  try {
    const ctx = buildContextV2(root, 'improve auth login');
    assert.ok(ctx.summary.includes('Project Type: node-api-ts'));
    assert.ok(ctx.summary.includes('src/auth.ts'));
    assert.ok(ctx.relevantFiles.includes('src/auth.ts'));
    assert.ok(ctx.summary.includes('instead of creating duplicates'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('projectKey is stable and filesystem-safe', () => {
  const a = projectKey('/home/user/my-app');
  const b = projectKey('/home/user/my-app');
  const c = projectKey('/home/user/other-app');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-zA-Z0-9_-]+$/);
});
