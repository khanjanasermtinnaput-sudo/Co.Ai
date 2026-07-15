// v2 — Workflow event bus (Phase 7 foundation).
//
// Execution is event-driven: the DAG executor emits lifecycle events, and
// subscribers (scheduler, replanner, trace recorder, memory invalidation)
// react. This makes the graph mutable at runtime and execution self-triggering.

import { EventEmitter } from 'node:events';

export type WorkflowEvent =
  | { type: 'user_request'; requestId: string }
  | { type: 'node_start'; nodeId: string }
  | { type: 'node_complete'; nodeId: string }
  | { type: 'node_fail'; nodeId: string; error: string }
  | { type: 'memory_updated'; key: string }
  | { type: 'replan_triggered'; reason: string; nodeId?: string }
  // Tool Execution Engine (Master Prompt 6.3). node_start/node_complete/node_fail
  // above already cover a tool node's generic lifecycle (executor.ts emits them
  // for every ExecNode regardless of kind) — this is the one genuinely new
  // signal tool nodes introduce: a permission check failing BEFORE the node
  // even attempts to run, which agent nodes have no equivalent of.
  | { type: 'permission_denied'; nodeId: string; toolId: string; permission: string }
  // Budget Enforcer (Master Prompt 6.8.1). Emitted by budget-enforcer.ts's
  // BudgetEnforcer.evaluate() the FIRST time a run crosses into a graduated
  // level — never re-emitted every call at the same level, so this is a
  // transition signal, not a poll. 'budget_exceeded' fires immediately before
  // the underlying CostMonitor.precheck() throws BudgetExceededError, so a
  // subscriber sees the classification before the hard stop.
  | { type: 'budget_warning'; category: 'tokens' | 'cost' | 'calls'; ratio: number }
  | { type: 'budget_critical'; category: 'tokens' | 'cost' | 'calls'; ratio: number }
  | { type: 'budget_exceeded'; category: 'tokens' | 'cost' | 'calls'; ratio: number };

export type WorkflowEventType = WorkflowEvent['type'];

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Workflows can fan out to many listeners; lift the default cap.
    this.emitter.setMaxListeners(100);
  }

  emit(event: WorkflowEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on<T extends WorkflowEventType>(
    type: T,
    handler: (event: Extract<WorkflowEvent, { type: T }>) => void,
  ): void {
    this.emitter.on(type, handler as (e: WorkflowEvent) => void);
  }

  /** Subscribe to every event (useful for the trace recorder / debugging). */
  onAny(handler: (event: WorkflowEvent) => void): void {
    this.emitter.on('*', handler);
  }
}
