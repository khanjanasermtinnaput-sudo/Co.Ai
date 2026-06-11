import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeBlocks, parseReviewLine } from '../core/agents.js';

// ── parseCodeBlocks ────────────────────────────────────────────────────────────

test('parseCodeBlocks extracts a path= block', () => {
  const files = parseCodeBlocks('```path=src/app.js\nconsole.log(1)\n```');
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/app.js');
  assert.equal(files[0].language, 'javascript');
  assert.ok(files[0].content.includes('console.log(1)'));
});

test('parseCodeBlocks preserves nested fences via a longer outer fence', () => {
  const md = [
    '````path=GUIDE.md',
    '# Guide',
    '```js',
    'console.log(1)',
    '```',
    'done',
    '````',
  ].join('\n');
  const files = parseCodeBlocks(md);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'GUIDE.md');
  assert.ok(files[0].content.includes('```js'));   // inner fence kept, not truncated
  assert.ok(files[0].content.includes('done'));
});

test('parseCodeBlocks handles multiple files', () => {
  const files = parseCodeBlocks('```path=a.js\nconst a=1;\n```\n\n```path=b.py\nx=1\n```');
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((f) => f.path), ['a.js', 'b.py']);
});

test('parseCodeBlocks falls back to output.txt when there is no fence', () => {
  const files = parseCodeBlocks('just some prose, no code here');
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'output.txt');
});

// ── parseReviewLine ────────────────────────────────────────────────────────────

test('parseReviewLine reads the canonical pipe format', () => {
  const i = parseReviewLine('HIGH | app.js | SQL injection — use parameters');
  assert.equal(i?.severity, 'HIGH');
  assert.equal(i?.file, 'app.js');
  assert.ok(i?.message.includes('SQL injection'));
});

test('parseReviewLine recovers colon/dash/bracket formats (no silent drop of HIGH)', () => {
  const colon = parseReviewLine('HIGH: server.ts: missing auth check');
  assert.equal(colon?.severity, 'HIGH');
  assert.equal(colon?.file, 'server.ts');

  const bracket = parseReviewLine('[MED] index.js — uses eval()');
  assert.equal(bracket?.severity, 'MED');
  assert.equal(bracket?.file, 'index.js');

  const medium = parseReviewLine('MEDIUM | utils.ts | unhandled promise');
  assert.equal(medium?.severity, 'MED');
  assert.equal(medium?.file, 'utils.ts');
});

test('parseReviewLine ignores OK and non-issue lines', () => {
  assert.equal(parseReviewLine('OK | - | no blocking issues'), null);
  assert.equal(parseReviewLine('Here is my review:'), null);
  assert.equal(parseReviewLine(''), null);
});
