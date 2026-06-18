import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDebugger, parseDebug } from '../core/debugger.js';
import { runAnalyzer, parseAnalysis } from '../core/analyze.js';

// ── debugger ──────────────────────────────────────────────────────────────────

const DEBUG_REPLY = [
  'ROOT CAUSE: The API call is awaited outside a try/catch, so a rejected promise crashes the request.',
  'ANALYSIS:',
  '- fetchUser() throws when the network fails',
  '- the error bubbles up and is never handled',
  'SOLUTION:',
  '- wrap the call in try/catch and return a 502 on failure',
  'PATCH:',
  '```path=src/user.ts',
  'export async function getUser(id: string) {',
  '  try { return await fetchUser(id); }',
  '  catch (e) { throw new Error("upstream"); }',
  '}',
  '```',
].join('\n');

test('parseDebug extracts root cause, analysis, solution and patch', () => {
  const r = parseDebug(DEBUG_REPLY);
  assert.match(r.rootCause, /awaited outside a try\/catch/);
  assert.equal(r.analysis.length, 2);
  assert.equal(r.solution.length, 1);
  assert.equal(r.patch.length, 1);
  assert.equal(r.patch[0].path, 'src/user.ts');
  assert.ok(r.patch[0].content.includes('try'));
});

test('parseDebug handles "no code" debugging (PATCH: - none)', () => {
  const reply = [
    'ROOT CAUSE: Missing environment variable.',
    'ANALYSIS:',
    '- DATABASE_URL is undefined at startup',
    'SOLUTION:',
    '- set DATABASE_URL in the environment',
    'PATCH:',
    '- none',
  ].join('\n');
  const r = parseDebug(reply);
  assert.equal(r.patch.length, 0);
  assert.match(r.rootCause, /environment variable/);
  assert.equal(r.solution.length, 1);
});

test('runDebugger passes the error and code into the model call', async () => {
  let seen = '';
  const call = async (messages: { role: string; content: string }[]) => {
    seen = messages[messages.length - 1].content;
    return DEBUG_REPLY;
  };
  const r = await runDebugger(call, { error: 'TypeError: x is undefined', code: 'const x = obj.y;' });
  assert.match(seen, /TypeError: x is undefined/);
  assert.match(seen, /const x = obj\.y/);
  assert.equal(r.patch.length, 1);
});

// ── analyzer ──────────────────────────────────────────────────────────────────

const ANALYZE_REPLY = [
  'FEASIBILITY: Realistic for a small team in 2-3 weeks at MVP scope.',
  'RISKS:',
  '- Realtime voice is the hardest part and can blow the timeline',
  '- Auth + presence add moving parts early',
  'RECOMMENDATIONS:',
  '- Ship text chat first, add voice in a later milestone',
  '- Use a managed realtime service to reduce infra work',
].join('\n');

test('parseAnalysis extracts feasibility, risks and recommendations', () => {
  const r = parseAnalysis(ANALYZE_REPLY);
  assert.match(r.feasibility, /Realistic/);
  assert.equal(r.risks.length, 2);
  assert.equal(r.recommendations.length, 2);
});

test('runAnalyzer feeds the brief into the model call', async () => {
  let seen = '';
  const call = async (messages: { role: string; content: string }[]) => {
    seen = messages[messages.length - 1].content;
    return ANALYZE_REPLY;
  };
  const r = await runAnalyzer(call, 'Project: Discord Clone\nTech Stack: Next.js');
  assert.match(seen, /Discord Clone/);
  assert.equal(r.risks.length, 2);
});
