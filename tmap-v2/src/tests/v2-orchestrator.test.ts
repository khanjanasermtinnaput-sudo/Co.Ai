import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthStore } from '../dars/health.js';
import { createGraph, type ExecNode } from '../v2/dag.js';
import { decideExecution } from '../v2/orchestrator-v2.js';
import type { ExecutionPlan, IntentSpec, SubTask } from '../v2/raa.js';
import { rankMemories, contextFitFrom, memoriesToContextV2 } from '../v2/memory-v2.js';
import type { ProjectMemory } from '../core/memory.js';
import { RunQueue } from '../v2/queue.js';

function fakePlan(confidence: number, complexity: number): ExecutionPlan {
  const node: ExecNode = {
    id: 'n', kind: 'agent', agentId: 'coder', fallbackAgentIds: [],
    dependencies: [], retry: { maxRetries: 0, backoffMs: 1 }, timeoutMs: 1000,
    status: 'pending', attempts: 0, run: async () => 'x',
  };
  const intent: IntentSpec = { goal: 'g', complexity, requiredCapabilities: { code: 1 } };
  const subtasks = new Map<string, SubTask>([
    ['n', { id: 'n', description: 'x', requiredCapabilities: { code: 1 }, dependencies: [] }],
  ]);
  return { intent, graph: createGraph('r', [node]), subtasks, confidence };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

test('decideExecution picks deep for complex / low-confidence work', () => {
  const d = decideExecution(fakePlan(0.4, 0.9), new HealthStore());
  assert.equal(d.mode, 'deep');
  assert.ok(d.maxParallel >= 5);
  assert.ok(d.maxReplans >= 3);
});

test('decideExecution picks fast for simple / high-confidence work', () => {
  const d = decideExecution(fakePlan(0.85, 0.2), new HealthStore());
  assert.equal(d.mode, 'fast');
  assert.equal(d.maxParallel, 2);
});

test('decideExecution picks balanced in between and yields a finalScore', () => {
  const d = decideExecution(fakePlan(0.6, 0.5), new HealthStore());
  assert.equal(d.mode, 'balanced');
  assert.equal(typeof d.finalScore, 'number');
});

test('budgetTight raises the cost weight', () => {
  const d = decideExecution(fakePlan(0.6, 0.5), new HealthStore(), { budgetTight: true });
  assert.ok(d.weights.cost >= 0.3);
});

test('fast mode raises the latency weight (latency optimization)', () => {
  const d = decideExecution(fakePlan(0.85, 0.2), new HealthStore());
  assert.equal(d.mode, 'fast');
  assert.ok(d.weights.latency >= 0.25);
});

// ── Run queue (system resource control) ─────────────────────────────────────

test('RunQueue bounds concurrency and queues the overflow', async () => {
  const q = new RunQueue(2);
  let active = 0;
  let peak = 0;
  const job = (ms: number) =>
    q.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
    });
  const all = Promise.all([job(15), job(15), job(15), job(15), job(15)]);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(q.inFlight <= 2, 'never more than capacity in flight');
  await all;
  assert.equal(peak, 2, 'peak concurrency capped at 2');
  assert.equal(q.inFlight, 0);
  assert.equal(q.queued, 0);
});

test('RunQueue release is idempotent', async () => {
  const q = new RunQueue(1);
  const rel = await q.acquire();
  assert.equal(q.inFlight, 1);
  rel();
  rel(); // double release must not over-free the slot
  assert.equal(q.inFlight, 0);
});

// ── Ranked memory ─────────────────────────────────────────────────────────────

function mem(): ProjectMemory {
  return {
    key: 'u',
    techStack: 'Next.js + Supabase',
    conventions: ['use zod for validation'],
    decisions: ['adopt JWT auth with refresh tokens'],
    sessions: [
      { task: 'add JWT login endpoint', status: 'done', files: ['auth.ts'], iterations: 1, at: new Date().toISOString() },
      { task: 'style the footer', status: 'done', files: ['footer.tsx'], iterations: 1, at: new Date(Date.now() - 200 * 86400000).toISOString() },
    ],
    failures: [],
    updatedAt: new Date().toISOString(),
  };
}

test('rankMemories ranks query-relevant entries above unrelated ones', () => {
  const ranked = rankMemories('implement JWT authentication', mem(), 5);
  assert.ok(ranked.length > 0);
  // A JWT-related entry should outrank the unrelated "style the footer" session.
  const top = ranked[0].content.toLowerCase();
  assert.ok(top.includes('jwt') || top.includes('auth'));
  const footerIdx = ranked.findIndex((r) => r.content.includes('footer'));
  if (footerIdx >= 0) assert.ok(footerIdx > 0);
});

test('contextFitFrom is neutral with no memory and higher with relevant memory', () => {
  assert.equal(contextFitFrom([]), 0.5);
  const ranked = rankMemories('JWT auth refresh tokens', mem(), 5);
  assert.ok(contextFitFrom(ranked) >= 0.5);
});

test('memoriesToContextV2 renders a bulleted block', () => {
  const ranked = rankMemories('JWT', mem(), 3);
  const ctx = memoriesToContextV2(ranked);
  assert.ok(ctx.includes('Relevant project memory'));
  assert.ok(ctx.includes('-'));
});
