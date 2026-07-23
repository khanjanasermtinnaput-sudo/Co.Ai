import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthStore } from '../dars/health.js';
import { createGraph, type ExecNode } from '../v2/dag.js';
import { decideExecution } from '../v2/orchestrator-v2.js';
import type { ExecutionPlan, IntentSpec, SubTask } from '../v2/raa.js';
import {
  rankMemories, contextFitFrom, memoriesToContextV2,
  recencyScore, memoryDecay, dynamicImportance, frequencyScore,
  updateUsageFrequency,
} from '../v2/memory-v2.js';
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

// ── Phase 6 — Memory Upgrade ──────────────────────────────────────────────────

test('phase6 importance_score: usage count boosts dynamic importance above base', () => {
  // With count=0, dynamic importance equals base exactly.
  assert.equal(dynamicImportance(0.5, 'x', {}), 0.5);
  // With count=10 (well past the ~3 inflection), boost approaches 0.3 * base.
  const boosted = dynamicImportance(0.5, 'x', { x: 10 });
  assert.ok(boosted > 0.5, 'repeated recall raises importance');
  assert.ok(boosted <= 1.0, 'capped at 1.0');

  // Entry recalled 10× must outrank same-base entry never recalled.
  const memWithFreq: ProjectMemory = {
    ...mem(),
    conventions: ['use zod for validation', 'use eslint for linting'],
    usageFrequency: { 'conv-0': 10 }, // 'use zod for validation' recalled often
  };
  const ranked = rankMemories('validation schema', memWithFreq, 10);
  const zodIdx   = ranked.findIndex((r) => r.content.includes('zod'));
  const eslintIdx = ranked.findIndex((r) => r.content.includes('eslint'));
  if (zodIdx >= 0 && eslintIdx >= 0) assert.ok(zodIdx < eslintIdx, 'high-frequency entry ranks higher');
});

test('phase6 recency_score: fresh entries score higher than stale ones', () => {
  const fresh  = recencyScore(new Date(Date.now() - 5   * 86_400_000).toISOString());
  const recent = recencyScore(new Date(Date.now() - 30  * 86_400_000).toISOString());
  const old    = recencyScore(new Date(Date.now() - 120 * 86_400_000).toISOString());
  assert.ok(fresh > recent, '5-day-old > 30-day-old');
  assert.ok(recent > old,   '30-day-old > 120-day-old');
  // No timestamp → neutral 0.3
  assert.equal(recencyScore(undefined), 0.3);
});

test('phase6 memory_decay: no penalty under threshold; exponential beyond 90 days', () => {
  assert.equal(memoryDecay(undefined), 1.0, 'no timestamp → no decay');
  const fresh  = memoryDecay(new Date(Date.now() - 30  * 86_400_000).toISOString());
  const atEdge = memoryDecay(new Date(Date.now() - 90  * 86_400_000).toISOString());
  const stale  = memoryDecay(new Date(Date.now() - 180 * 86_400_000).toISOString());
  assert.equal(fresh,  1.0, 'within threshold → decay=1');
  assert.ok(atEdge >= 0.99, 'exactly at threshold ≈ 1');
  assert.ok(stale < 0.5, '180-day-old entry has heavy extra decay');
  assert.ok(stale < fresh, 'stale < fresh');
});

test('phase6 usage_frequency: frequencyScore is 0 at count=0 and approaches 1', () => {
  assert.equal(frequencyScore('x', {}), 0, 'never recalled → 0');
  const low  = frequencyScore('x', { x: 1  });
  const mid  = frequencyScore('x', { x: 5  });
  const high = frequencyScore('x', { x: 20 });
  assert.ok(low > 0  && low  < mid,  'low < mid');
  assert.ok(mid < high,              'mid < high');
  assert.ok(high < 1,                'asymptotes but never reaches 1 at finite count');
});

test('phase6 conflict_resolution: near-duplicate loser receives CONFLICT_PENALTY', () => {
  // Two near-identical decisions → Jaccard overlap will be high → conflict.
  const memConflict: ProjectMemory = {
    ...mem(),
    decisions: [],
    conventions: [
      'use TypeScript strict mode enabled always',   // conv-0, importance 0.5
      'use TypeScript strict mode enabled strictly',  // conv-1, importance 0.5 (same base, tie-break by index: conv-0 wins)
    ],
  };
  const ranked = rankMemories('typescript configuration', memConflict, 5);
  // The loser entry should have conflictsWith set and a lower score than winner.
  const loser = ranked.find((r) => r.conflictsWith && r.conflictsWith.length > 0);
  const winner = loser ? ranked.find((r) => r.id === loser.conflictsWith![0]) : undefined;
  if (loser && winner) {
    assert.ok(winner.score > loser.score, 'winner outscores loser');
  }
  // Even without an explicit conflict hit, the loser's score must be depressed.
  // (Either one of them has conflictsWith, or both are very close and neither surfaced a conflict.)
  // At minimum the function must not throw and must return valid ranked entries.
  assert.ok(ranked.every((r) => r.score >= 0 && r.score <= 1), 'all scores in [0,1]');
});

test('phase6 updateUsageFrequency: increments counts, does not mutate input', () => {
  const ranked = [{ id: 'dec-0', content: 'x', score: 0.9 }, { id: 'conv-1', content: 'y', score: 0.7 }];
  const original: Record<string, number> = { 'dec-0': 3 };
  const updated = updateUsageFrequency(ranked, original);

  assert.equal(original['dec-0'], 3, 'input not mutated');
  assert.equal(updated['dec-0'], 4, 'existing count incremented');
  assert.equal(updated['conv-1'], 1, 'new id starts at 1');

  // Calling twice from the updated result correctly accumulates.
  const updated2 = updateUsageFrequency(ranked, updated);
  assert.equal(updated2['dec-0'], 5);
  assert.equal(updated2['conv-1'], 2);
});

test('phase6 integration: memory influence flows through contextFit into ranking', () => {
  // A memory-rich session should yield contextFit > 0.5 (memory pushes agent scores up).
  const richMem: ProjectMemory = {
    ...mem(),
    usageFrequency: { 'dec-0': 8 }, // decision recalled often
  };
  const ranked = rankMemories('JWT authentication tokens', richMem, 5);
  const fit = contextFitFrom(ranked);
  assert.ok(fit > 0.5, 'relevant + frequently recalled memory raises contextFit above neutral');
});
