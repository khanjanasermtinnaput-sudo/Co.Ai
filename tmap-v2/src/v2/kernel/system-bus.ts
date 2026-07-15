// v2/kernel — Runtime Kernel system event bus (Master Prompt 6.11).
//
// v2/events.ts's EventBus is deliberately PER-RUN (constructed fresh inside
// runV2 for one workflow's node_start/node_complete/... lifecycle) — that
// isolation is load-bearing, not an oversight (see v2/events.ts's own header).
// The Runtime Kernel needs a DIFFERENT thing: a PROCESS-SCOPED bus for events
// about the runtime itself (booting, ready, draining, stopped), which by
// definition outlive any single run and must reach subscribers registered
// before the first run and after the last one. Rather than smuggle kernel
// lifecycle events onto the per-run WorkflowEvent union (which would force
// every run's EventBus to also carry process-level noise, breaking the
// isolation the v2 engine relies on), this is a separate class over a
// separate, disjoint event union. No code path emits a KernelEvent on an
// EventBus or a WorkflowEvent on a SystemEventBus — see kernel.test.ts's
// isolation regression test.

import { EventEmitter } from 'node:events';

export type KernelEvent =
  | { type: 'kernel_booting'; at: string }
  | { type: 'kernel_ready'; at: string }
  | { type: 'kernel_running'; at: string }
  | { type: 'kernel_paused'; at: string; reason?: string }
  | { type: 'kernel_draining'; at: string; reason?: string }
  | { type: 'kernel_stopped'; at: string; reason?: string };

export type KernelEventType = KernelEvent['type'];

export class SystemEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: KernelEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on<T extends KernelEventType>(
    type: T,
    handler: (event: Extract<KernelEvent, { type: T }>) => void,
  ): void {
    this.emitter.on(type, handler as (e: KernelEvent) => void);
  }

  /** Subscribe to every kernel event (admin route / logging). */
  onAny(handler: (event: KernelEvent) => void): void {
    this.emitter.on('*', handler);
  }
}

/** Process-wide — the ONE bus for runtime-lifecycle events on this instance. */
export const globalSystemBus = new SystemEventBus();
