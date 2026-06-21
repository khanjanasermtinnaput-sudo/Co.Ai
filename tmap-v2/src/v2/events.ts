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
  | { type: 'replan_triggered'; reason: string; nodeId?: string };

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
