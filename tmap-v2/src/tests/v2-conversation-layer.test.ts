// Runs fully offline (NODE_ENV=test forces mock providers), so it never bills.
// Confirms runV2's new optional `history` (Master Prompt 6.1's previously
// unsourced "conversation" Runtime Context Package layer) is accepted and
// threaded through without breaking the run — the transformation itself
// (history -> renderConversationHistory -> assembleRuntimeContext) is unit
// tested directly in context-engine.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runV2 } from '../v2/run.js';
import type { ChatMessage } from '../types.js';

test('runV2 accepts conversation history and still completes a run', async () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'We are building a TODO REST API in Node.js.' },
    { role: 'assistant', content: 'Got it — Express with an in-memory store to start.' },
  ];

  const r = await runV2('Now add a DELETE endpoint', {
    creds: {},
    userId: 'test-user-conversation-layer',
    history,
  });

  assert.ok(r.output.length > 0, 'run still produces output with history supplied');
});

test('runV2 with no history behaves exactly as before (conversation layer optional)', async () => {
  const r = await runV2('Write a haiku', { creds: {}, userId: 'test-user-no-history' });
  assert.ok(r.output.length > 0);
});
