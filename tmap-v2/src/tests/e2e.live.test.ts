// e2e.live.test.ts — REAL-LLM end-to-end smoke tests.
//
// Unlike the rest of the suite (which runs in DARS mock mode with no keys),
// these exercise the actual v2 and v1 engines against a real provider so that
// "tests pass" means "the engine produced real output", not just "the mock
// returned a canned string".
//
// They SELF-SKIP unless OPENROUTER_API_KEY is set, so the default mock CI lane
// is unaffected. The dedicated `test-live` CI job injects the secret to run them.
// One OpenRouter key covers every role (planner/coder/reviewer/validator) via
// DARS OpenRouter routing — see dars/select.ts.
//
// NOTE: this drives the engines directly (runV2 / runTMAP) rather than over HTTP,
// because importing server/index.ts starts app.listen() at module load. A full
// authenticated HTTP E2E (boot server + JWT + provider_keys) is a follow-up.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runV2 } from '../v2/run.js';
import { runTMAP } from '../core/orchestrator.js';
import { createBlackboard } from '../core/blackboard.js';
import type { CredentialBag } from '../config.js';

const KEY = process.env.OPENROUTER_API_KEY?.trim();
const skip = KEY ? false : 'set OPENROUTER_API_KEY to run real-LLM E2E tests';
const creds: CredentialBag = { openrouter: KEY };

// Real model calls are slow; give them generous ceilings.
const V2_TIMEOUT = 180_000;
const V1_TIMEOUT = 120_000;

test('live v2: runV2 produces real output and a reconstructable trace', { skip, timeout: V2_TIMEOUT }, async () => {
  const r = await runV2(
    'Write a TypeScript function `add(a: number, b: number)` that returns their sum, plus one short unit test.',
    { creds, userId: 'e2e-live' },
  );

  assert.ok(r.output.trim().length > 0, 'v2 should return non-empty output');
  assert.ok(r.trace.nodeLogs.length > 0, 'v2 trace should record at least one node execution');
  assert.ok(r.trace.dag.length > 0, 'v2 trace should capture the DAG shape');
  assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence is a 0..1 score');
  assert.ok(['fast', 'balanced', 'deep'].includes(r.mode), 'orchestrator picked a real mode');
  // At least one node must have succeeded for there to be output.
  assert.ok(r.trace.nodeLogs.some((n) => n.ok), 'at least one node succeeded');
});

test('live v1: runTMAP (lite) produces real files from a real model', { skip, timeout: V1_TIMEOUT }, async () => {
  const bb = createBlackboard('Write a JavaScript function add(a, b) that returns a + b.', 'lite');
  await runTMAP(bb, () => {}, { creds, skipContext: true });

  assert.ok(bb.files.length > 0, 'v1 should produce at least one file');
  assert.ok(bb.files.some((f) => f.content.trim().length > 0), 'produced files have content');
  assert.ok(bb.iterations >= 1, 'pipeline ran at least one iteration');
});
