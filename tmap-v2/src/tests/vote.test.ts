import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoderVote, parsePick, letter } from '../core/vote.js';
import type { Blackboard } from '../types.js';

function bb(): Blackboard {
  return {
    sessionId: 't', task: 'build x', mode: 'pro', context: '',
    plan: [], planText: '', files: [], review: [], reviewText: '',
    validations: [], iterations: 0, log: [],
  };
}

test('letter maps index to A/B/C', () => {
  assert.equal(letter(0), 'A');
  assert.equal(letter(2), 'C');
});

test('parsePick reads the chosen letter and clamps to range', () => {
  assert.equal(parsePick('PICK: B\nREASON: x', 3), 1);
  assert.equal(parsePick('PICK: Z', 3), 0);        // out of range → default 0
  assert.equal(parsePick('no pick here', 3), 0);
});

test('runCoderVote runs N candidates and picks the judged winner', async () => {
  // Coder echoes the temperature so candidates genuinely differ.
  const coder = async (_m: unknown, opts: { temperature?: number } = {}) =>
    ['```path=app.js', `// t=${opts.temperature}`, 'console.log(1)', '```'].join('\n');
  const reviewer = async () => 'PICK: C\nREASON: most complete';

  const result = await runCoderVote(coder, reviewer, bb());
  assert.equal(result.candidateCount, 3);
  assert.equal(result.winnerIndex, 2);
  assert.equal(result.files.length, 1);
  assert.match(result.reason, /complete/);
});

test('runCoderVote falls back to candidate A when the judge fails', async () => {
  const coder = async () => '```path=a.js\nconsole.log(1)\n```';
  const reviewer = async () => { throw new Error('judge down'); };

  const result = await runCoderVote(coder, reviewer, bb());
  assert.equal(result.winnerIndex, 0);
  assert.equal(result.candidateCount, 3);
});
