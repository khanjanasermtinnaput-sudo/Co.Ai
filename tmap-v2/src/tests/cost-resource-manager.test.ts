import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResourceAllocationPlan, runCostResourceManager } from '../core/cost-resource-manager.js';
import { defaultBudget } from '../core/cost-budget.js';
import { createBlackboard } from '../core/blackboard.js';

test('buildResourceAllocationPlan: more domains increase required agents and expected calls', () => {
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const limits = defaultBudget();

  const single = buildResourceAllocationPlan(bb, ['backend'], 'ultra', limits);
  const multi = buildResourceAllocationPlan(bb, ['backend', 'frontend', 'database'], 'ultra', limits);

  assert.ok(multi.agentBudget.requiredAgents > single.agentBudget.requiredAgents);
  assert.ok(multi.providerBudget.expectedCalls > single.providerBudget.expectedCalls);
  assert.equal(single.degraded, false);
});

test('buildResourceAllocationPlan: extreme reserves one optional agent for Self Reflection', () => {
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const limits = defaultBudget();
  const ultra = buildResourceAllocationPlan(bb, ['backend'], 'ultra', limits);
  const extreme = buildResourceAllocationPlan(bb, ['backend'], 'extreme', limits);
  assert.equal(ultra.agentBudget.optionalAgents, 0);
  assert.equal(extreme.agentBudget.optionalAgents, 1);
  assert.ok(extreme.executionTimeBudget.estimatedReflectionMs > 0);
  assert.equal(ultra.executionTimeBudget.estimatedReflectionMs, 0);
});

test('buildResourceAllocationPlan: warns when expected calls exceed a tight ceiling', () => {
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const limits = defaultBudget({ maxCalls: 1 });
  const plan = buildResourceAllocationPlan(bb, ['backend', 'frontend'], 'extreme', limits);
  assert.ok(plan.warnings.some((w) => w.includes('exceed the run\'s call ceiling')));
});

test('runCostResourceManager: falls back to conservative defaults instead of throwing when estimation fails', () => {
  const events: string[] = [];
  const emit = (role: string, text: string) => events.push(`${role}:${text}`);
  const bb = createBlackboard('add a new API route for user login', 'pro');
  // `domains` is null on purpose — `domains.length` throws inside estimation,
  // exercising the conservative-fallback path (CRM must never block the run).
  const hostileDomains = null as unknown as Parameters<typeof runCostResourceManager>[1];

  const plan = runCostResourceManager(bb, hostileDomains, 'extreme', defaultBudget(), emit);

  assert.equal(plan.degraded, true);
  assert.ok(events.some((e) => e.startsWith('crm:') && e.includes('estimation failed')), 'should log the estimation failure');
  assert.ok(events.some((e) => e.startsWith('crm:') && e.includes('DEGRADED')), 'summary should flag the plan as degraded');
});

test('runCostResourceManager: emits the resource plan summary for a normal run', () => {
  const events: string[] = [];
  const emit = (role: string, text: string) => events.push(`${role}:${text}`);
  const bb = createBlackboard('add a new API route for user login', 'pro');

  const plan = runCostResourceManager(bb, ['backend'], 'ultra', defaultBudget(), emit);

  assert.equal(plan.degraded, false);
  assert.ok(events.some((e) => e.startsWith('crm:') && e.includes('tier=ultra')));
});
