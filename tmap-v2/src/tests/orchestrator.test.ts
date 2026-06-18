import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTMAP } from '../core/orchestrator.js';
import { createBlackboard } from '../core/blackboard.js';

// Use mock mode (no creds) so tests run without API keys.
// DARS falls back to the offline mock provider automatically.
const TASK = 'build a hello world function';

function bb(mode: 'lite' | 'normal' | 'pro') {
  return createBlackboard(TASK, mode);
}

const noop = () => {};

// ── lite mode ─────────────────────────────────────────────────────────────────

test('lite mode: completes in exactly 1 iteration', async () => {
  const result = await runTMAP(bb('lite'), noop, { skipContext: true });
  assert.equal(result.iterations, 1);
});

test('lite mode: produces at least one output file', async () => {
  const result = await runTMAP(bb('lite'), noop, { skipContext: true });
  assert.ok(result.files.length > 0, 'lite mode should produce files');
});

test('lite mode: skips architect stage (no architect decision)', async () => {
  const result = await runTMAP(bb('lite'), noop, { skipContext: true });
  assert.equal(result.architect, undefined);
});

test('lite mode: skips documenter stage (no docs generated)', async () => {
  const result = await runTMAP(bb('lite'), noop, { skipContext: true });
  assert.equal(result.docs, undefined);
});

test('lite mode: planner and coder events are emitted', async () => {
  const roles: string[] = [];
  const emit = (role: string) => roles.push(role);
  await runTMAP(bb('lite'), emit, { skipContext: true });
  assert.ok(roles.includes('planner'));
  assert.ok(roles.includes('coder'));
  assert.ok(roles.includes('reviewer'));
});

// ── normal mode ───────────────────────────────────────────────────────────────

test('normal mode: produces at least one output file', async () => {
  const result = await runTMAP(bb('normal'), noop, { skipContext: true });
  assert.ok(result.files.length > 0, 'normal mode should produce files');
});

test('normal mode: architect stage runs and emits events', async () => {
  const roles: string[] = [];
  const emit = (role: string) => roles.push(role);
  await runTMAP(bb('normal'), emit, { skipContext: true });
  assert.ok(roles.includes('architect'), 'architect should run in normal mode');
});

test('normal mode: documenter stage runs and generates docs', async () => {
  const roles: string[] = [];
  const emit = (role: string) => roles.push(role);
  const result = await runTMAP(bb('normal'), emit, { skipContext: true });
  assert.ok(roles.includes('documenter'), 'documenter should run in normal mode');
  assert.ok(result.docs !== undefined && result.docs.length > 0, 'docs should be generated');
});

test('normal mode: docs contain a README file', async () => {
  const result = await runTMAP(bb('normal'), noop, { skipContext: true });
  const readme = result.docs?.find((d) => d.path === 'README.md');
  assert.ok(readme !== undefined, 'README.md should be in docs');
});

test('normal mode: validations array is populated', async () => {
  const result = await runTMAP(bb('normal'), noop, { skipContext: true });
  assert.ok(Array.isArray(result.validations));
});

// ── pro mode ──────────────────────────────────────────────────────────────────

test('pro mode: produces at least one output file', async () => {
  const result = await runTMAP(bb('pro'), noop, { skipContext: true });
  assert.ok(result.files.length > 0, 'pro mode should produce files');
});

test('pro mode: architect stage runs', async () => {
  const roles: string[] = [];
  const emit = (role: string) => roles.push(role);
  await runTMAP(bb('pro'), emit, { skipContext: true });
  assert.ok(roles.includes('architect'), 'architect should run in pro mode');
});

test('pro mode: voting is used on the first code iteration', async () => {
  const events: string[] = [];
  const emit = (_role: string, text: string) => events.push(text);
  await runTMAP(bb('pro'), emit, { skipContext: true });
  const votingUsed = events.some((e) => /consensus vote|vote winner/i.test(e));
  assert.ok(votingUsed, 'pro mode should use voting on first code pass');
});

test('pro mode: documenter stage runs', async () => {
  const roles: string[] = [];
  const emit = (role: string) => roles.push(role);
  await runTMAP(bb('pro'), emit, { skipContext: true });
  assert.ok(roles.includes('documenter'), 'documenter should run in pro mode');
});

// ── session hooks ─────────────────────────────────────────────────────────────

test('session hooks are called: onSessionStart before onSessionEnd', async () => {
  const calls: string[] = [];
  const board = bb('lite');

  await runTMAP(board, noop, {
    skipContext: true,
    onSessionStart: async (id) => { calls.push(`start:${id}`); },
    onSessionEnd: async (id, res) => { calls.push(`end:${id}:${res.status}`); },
  });

  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith('start:'));
  assert.ok(calls[1].startsWith('end:'));
  assert.ok(calls[1].endsWith(':done'));
});

test('onSessionEnd receives correct filesCount and iterations', async () => {
  let filesCount = 0;
  let iterations = 0;

  await runTMAP(bb('lite'), noop, {
    skipContext: true,
    onSessionEnd: async (_id, res) => {
      filesCount = res.filesCount;
      iterations = res.iterations;
    },
  });

  assert.ok(filesCount > 0, 'filesCount should be > 0');
  assert.equal(iterations, 1);
});

// ── cross-mode ────────────────────────────────────────────────────────────────

test('all three modes complete without throwing', async () => {
  for (const mode of ['lite', 'normal', 'pro'] as const) {
    await assert.doesNotReject(
      runTMAP(createBlackboard(TASK, mode), noop, { skipContext: true }),
      `mode ${mode} should complete without error`,
    );
  }
});

test('all three modes populate planText', async () => {
  for (const mode of ['lite', 'normal', 'pro'] as const) {
    const result = await runTMAP(createBlackboard(TASK, mode), noop, { skipContext: true });
    assert.ok(result.planText.length > 0, `mode ${mode} should produce a plan`);
  }
});

// ── plan-only mode (Nexora Code "Create Plan") ───────────────────────────────────

test('planOnly produces a plan but generates no code', async () => {
  const result = await runTMAP(bb('normal'), noop, { skipContext: true, planOnly: true });
  assert.ok(result.planText.length > 0, 'plan should be produced');
  assert.equal(result.files.length, 0, 'no files should be generated in plan-only mode');
});

test('planOnly skips the coder, validator and documenter stages', async () => {
  const roles: string[] = [];
  const emit = (role: string) => roles.push(role);
  await runTMAP(bb('normal'), emit, { skipContext: true, planOnly: true });
  assert.ok(roles.includes('planner'), 'planner should run');
  assert.ok(!roles.includes('coder'), 'coder should NOT run');
  assert.ok(!roles.includes('documenter'), 'documenter should NOT run');
});

test('planOnly still calls onSessionEnd with zero files', async () => {
  let filesCount = -1;
  await runTMAP(bb('lite'), noop, {
    skipContext: true,
    planOnly: true,
    onSessionEnd: async (_id, res) => { filesCount = res.filesCount; },
  });
  assert.equal(filesCount, 0);
});
