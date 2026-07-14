import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readProjectTree, buildDependencyGraph, detectProjectType,
  selectRelevantFiles, detectConventions, buildContextV2, projectKey,
  assembleRuntimeContext, renderConversationHistory,
} from '../core/context-engine.js';
import { gatherProjectContext } from '../core/context.js';
import type { ChatMessage } from '../types.js';

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'aof-ctx-'));
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

// ── assembleRuntimeContext (Runtime Context Package, Master Prompt Part 6.1) ─

test('assembleRuntimeContext: current request is never truncated even under a tiny budget', () => {
  const pkg = assembleRuntimeContext({
    currentRequest: 'fix the login bug',
    repository: 'x'.repeat(1000),
    maxChars: 10,
  });
  assert.ok(pkg.text.includes('fix the login bug'));
  assert.equal(pkg.layers.find((l) => l.name === 'current-request')!.included, true);
});

test('assembleRuntimeContext: lower-priority layers are dropped once the budget is exhausted', () => {
  const pkg = assembleRuntimeContext({
    currentRequest: 'a'.repeat(50),
    repository: 'b'.repeat(50),
    memory: 'c'.repeat(50),
    maxChars: 60,
  });
  const repo = pkg.layers.find((l) => l.name === 'repository')!;
  const memory = pkg.layers.find((l) => l.name === 'memory')!;
  assert.equal(repo.included, true);
  assert.equal(memory.included, false);
  assert.ok(pkg.discardedSources.includes('Project Memory'));
  assert.ok(pkg.totalChars <= 60 + 50); // current-request (50) is exempt from the budget, repo/memory share the rest
});

test('assembleRuntimeContext: truncates a lower-priority layer to fit remaining budget rather than dropping it', () => {
  const pkg = assembleRuntimeContext({
    currentRequest: 'short request',
    repository: 'r'.repeat(100),
    maxChars: 'short request'.length + 40,
  });
  const repo = pkg.layers.find((l) => l.name === 'repository')!;
  assert.equal(repo.included, true);
  assert.equal(repo.includedChars, 40);
  assert.ok(!pkg.discardedSources.includes('Repository Context'));
});

test('assembleRuntimeContext: drops a duplicate long line already contributed by a higher-priority layer', () => {
  const sharedLine = 'this exact instruction line repeats across two layers verbatim';
  const pkg = assembleRuntimeContext({
    currentRequest: sharedLine,
    conversation: `some earlier turn\n${sharedLine}\nsome other unique line`,
  });
  const conversationBlock = pkg.text.split('## Recent Conversation')[1] ?? '';
  assert.equal((conversationBlock.match(new RegExp(sharedLine, 'g')) ?? []).length, 0);
  assert.ok(conversationBlock.includes('some other unique line'));
});

test('assembleRuntimeContext: does not dedup short code-shaped lines across layers (would corrupt meaning)', () => {
  const pkg = assembleRuntimeContext({
    currentRequest: 'refactor these files',
    repository: 'function a() {\n}\n\nfunction b() {\n}',
  });
  const repoBlock = pkg.text.split('## Repository Context')[1] ?? '';
  assert.equal((repoBlock.match(/^\}$/gm) ?? []).length, 2, 'both closing braces should survive — they are too short/common to treat as duplicated instructions');
});

test('assembleRuntimeContext: empty optional layers are marked not-included with zero raw size', () => {
  const pkg = assembleRuntimeContext({ currentRequest: 'just the task' });
  for (const layer of pkg.layers) {
    if (layer.name === 'current-request') continue;
    assert.equal(layer.included, false);
    assert.equal(layer.rawChars, 0);
  }
});

test('assembleRuntimeContext: compressionRatio is 1 when nothing is cut', () => {
  const pkg = assembleRuntimeContext({ currentRequest: 'small task', repository: 'small repo summary' });
  assert.equal(pkg.compressionRatio, 1);
});

// ── renderConversationHistory (v2/run.ts's source for the "conversation" layer) ─

test('renderConversationHistory renders user/assistant turns as a readable transcript', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'How do I add auth?' },
    { role: 'assistant', content: 'Use middleware X.' },
  ];
  const rendered = renderConversationHistory(history);
  assert.equal(rendered, 'User: How do I add auth?\n\nAssistant: Use middleware X.');
});

test('renderConversationHistory drops system messages — they are instructions, not dialogue', () => {
  const history: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'hi' },
  ];
  const rendered = renderConversationHistory(history);
  assert.ok(!rendered.includes('helpful assistant'));
  assert.equal(rendered, 'User: hi');
});

test('renderConversationHistory keeps only the most recent maxTurns entries', () => {
  const history: ChatMessage[] = Array.from({ length: 5 }, (_, i) => ({
    role: 'user' as const,
    content: `turn ${i}`,
  }));
  const rendered = renderConversationHistory(history, 2);
  assert.ok(!rendered.includes('turn 0'));
  assert.ok(!rendered.includes('turn 2'));
  assert.ok(rendered.includes('turn 3'));
  assert.ok(rendered.includes('turn 4'));
});

test('renderConversationHistory feeds assembleRuntimeContext\'s conversation layer end-to-end', () => {
  const rendered = renderConversationHistory([{ role: 'user', content: 'earlier question' }]);
  const pkg = assembleRuntimeContext({ currentRequest: 'follow-up', conversation: rendered });
  const layer = pkg.layers.find((l) => l.name === 'conversation');
  assert.equal(layer?.included, true);
  assert.ok(pkg.text.includes('earlier question'));
});
