// Budget Enforcer (Master Prompt 6.8.1) tests.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CostMonitor, isBudgetError, type BudgetSnapshot } from '../core/cost-budget.js';
import { evaluate, BudgetEnforcer, DEFAULT_THRESHOLDS } from '../core/budget-enforcer.js';
import { EventBus, type WorkflowEvent } from '../v2/events.js';

function snapshotWith(tokensUsed: number, maxTokens: number): BudgetSnapshot {
  return { tokensUsed, estimatedCostUsd: 0, calls: 0, limits: { maxTokens, maxCostUsd: 0, maxCalls: 0 } };
}

describe('evaluate() — pure graduated classification', () => {
  test('well under threshold ⇒ healthy/continue', () => {
    const d = evaluate(snapshotWith(100, 1000));
    assert.equal(d.level, 'healthy');
    assert.equal(d.action, 'continue');
    assert.equal(d.category, 'tokens');
  });

  test('crossing the warning threshold ⇒ warning/optimize', () => {
    const d = evaluate(snapshotWith(850, 1000), DEFAULT_THRESHOLDS);
    assert.equal(d.level, 'warning');
    assert.equal(d.action, 'optimize');
  });

  test('crossing the critical threshold ⇒ critical/escalate', () => {
    const d = evaluate(snapshotWith(960, 1000), DEFAULT_THRESHOLDS);
    assert.equal(d.level, 'critical');
    assert.equal(d.action, 'escalate');
  });

  test('at or over the limit ⇒ exceeded/abort', () => {
    const d = evaluate(snapshotWith(1000, 1000));
    assert.equal(d.level, 'exceeded');
    assert.equal(d.action, 'abort');
    assert.equal(d.ratio, 1);
  });

  test('unlimited (0) category never drives a level on its own', () => {
    const snap: BudgetSnapshot = { tokensUsed: 999_999, estimatedCostUsd: 0, calls: 0, limits: { maxTokens: 0, maxCostUsd: 0, maxCalls: 0 } };
    const d = evaluate(snap);
    assert.equal(d.level, 'healthy');
  });

  test('the WORST category drives the decision, not the first one checked', () => {
    const snap: BudgetSnapshot = {
      tokensUsed: 100,
      estimatedCostUsd: 1.99,
      calls: 1,
      limits: { maxTokens: 1000, maxCostUsd: 2.0, maxCalls: 100 }, // cost is at 99.5%, far worse than tokens
    };
    const d = evaluate(snap);
    assert.equal(d.category, 'cost');
    assert.equal(d.level, 'critical');
  });
});

describe('BudgetEnforcer — wraps a real CostMonitor, preserves precheck() semantics', () => {
  test('precheckWithEnforcement() throws the exact same BudgetExceededError precheck() always did', () => {
    const monitor = new CostMonitor({ maxTokens: 0, maxCostUsd: 0, maxCalls: 2 });
    const enforcer = new BudgetEnforcer(monitor);
    enforcer.precheckWithEnforcement();
    monitor.record('deepseek-chat', 10, 10);
    enforcer.precheckWithEnforcement();
    monitor.record('deepseek-chat', 10, 10);
    assert.throws(() => enforcer.precheckWithEnforcement(), (e: unknown) => isBudgetError(e) && e.limitHit === 'calls');
  });

  test('emits budget_warning / budget_critical on the bus only ONCE per level transition, not per call', () => {
    const monitor = new CostMonitor({ maxTokens: 100, maxCostUsd: 0, maxCalls: 0 });
    const bus = new EventBus();
    const events: WorkflowEvent[] = [];
    bus.onAny((e) => events.push(e));
    const enforcer = new BudgetEnforcer(monitor, bus);

    monitor.record('deepseek-chat', 85, 0); // 85% — crosses into warning
    enforcer.evaluate();
    enforcer.evaluate(); // same level again — must NOT re-emit
    enforcer.evaluate();

    const warnings = events.filter((e) => e.type === 'budget_warning');
    assert.equal(warnings.length, 1);
  });

  test('emits budget_exceeded on the bus immediately before the hard throw', () => {
    const monitor = new CostMonitor({ maxTokens: 10, maxCostUsd: 0, maxCalls: 0 });
    const bus = new EventBus();
    const events: WorkflowEvent[] = [];
    bus.onAny((e) => events.push(e));
    const enforcer = new BudgetEnforcer(monitor, bus);

    monitor.record('deepseek-chat', 10, 0); // exactly at the ceiling
    assert.throws(() => enforcer.precheckWithEnforcement(), (e: unknown) => isBudgetError(e));
    assert.ok(events.some((e) => e.type === 'budget_exceeded'));
  });

  test('never emits on the bus when none is provided — evaluate() still works standalone', () => {
    const monitor = new CostMonitor({ maxTokens: 100, maxCostUsd: 0, maxCalls: 0 });
    const enforcer = new BudgetEnforcer(monitor); // no bus
    monitor.record('deepseek-chat', 95, 0);
    const decision = enforcer.evaluate();
    assert.equal(decision.level, 'critical');
  });

  test('costMonitor getter exposes the SAME underlying monitor instance — record() still works through it', () => {
    const monitor = new CostMonitor({ maxTokens: 1000, maxCostUsd: 0, maxCalls: 0 });
    const enforcer = new BudgetEnforcer(monitor);
    assert.equal(enforcer.costMonitor, monitor);
    enforcer.costMonitor.record('deepseek-chat', 50, 50);
    assert.equal(monitor.tokens, 100);
  });
});
