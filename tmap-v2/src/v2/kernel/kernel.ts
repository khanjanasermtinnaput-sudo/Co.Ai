// v2/kernel — Runtime Kernel (Master Prompt 6.11).
//
// "Runtime Kernel is the central operating layer of Co.AI... It does not
// perform engineering. It does not perform reasoning. It does not generate
// responses. Its responsibility is orchestration, lifecycle management and
// system coordination." Exploration of this repo found every piece the spec
// lists ALREADY EXISTS, mature, scattered across tmap-v2: an EventBus
// (v2/events.ts, per-run by design), an agent/tool registry (v2/registry.ts),
// a run concurrency queue (v2/queue.ts), a BullMQ job queue (server/queue.ts),
// health stores and circuit breakers (server/health.ts, dars/health.ts,
// server/failover.ts), env-driven config (config.ts), and structured loggers
// (v2/logger.ts, server/logger.ts). What did NOT exist anywhere: a single
// place that OWNS the process lifecycle (startup → ready → running →
// shutdown), coordinates a graceful drain, and lets a caller discover what's
// registered without importing every singleton by name. That is this file's
// entire job — coordination, not reimplementation. RuntimeKernel registers
// REFERENCES to the existing singletons (see boot()); it constructs none of
// them.
//
// Runtime position (per spec): User Request → Runtime Bootstrap → Runtime
// Kernel → Core Runtime Components → Workflow Execution → Response. In this
// codebase that maps to: server/index.ts's app.listen() callback → bootKernel()
// → the singletons registered below → runV2()/runTMAP() → the HTTP response.

import { ServiceRegistry } from './service-registry.js';
import { SystemEventBus, globalSystemBus, type KernelEvent } from './system-bus.js';
import { globalRunQueue } from '../queue.js';
import { globalInstancePool } from '../../providers/instance-pool.js';
import { globalHealth } from '../../dars/health.js';
import { listCircuits, resetCircuit } from '../../server/failover.js';
import { buildHealthReport } from '../../server/health.js';
import { registerAgent, listAgents, getAgent } from '../registry.js';
import { logger as serverLogger } from '../../server/logger.js';

export type LifecycleState =
  | 'startup'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'paused'
  | 'recovering'
  | 'stopping'
  | 'shutdown';

/** The legal state graph. A transition not listed here throws — "Runtime
 *  Kernel must never enter undefined state" (spec, Error Handling). */
const LEGAL_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  startup:      ['initializing', 'stopping'],
  initializing: ['ready', 'stopping'],
  ready:        ['running', 'stopping'],
  running:      ['paused', 'recovering', 'stopping'],
  paused:       ['running', 'stopping'],
  recovering:   ['running', 'ready', 'stopping'],
  stopping:     ['shutdown'],
  shutdown:     [],
};

export interface KernelBootOpts {
  /** The http.Server handle, when booted from server/index.ts (so shutdown()
   *  can close it). Absent for CLI/test callers — see cli.ts non-goal note. */
  server?: { close(cb: (err?: Error) => void): void };
}

export interface KernelSnapshot {
  state: LifecycleState;
  uptimeMs: number;
  services: string[];
  inFlightRuns: number;
  queuedRuns: number;
  transitions: Array<{ from: LifecycleState; to: LifecycleState; at: string }>;
}

const DEFAULT_DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS ?? 10_000);
const DRAIN_POLL_MS = 100;

export class RuntimeKernel {
  readonly services = new ServiceRegistry();
  readonly bus: SystemEventBus;

  private _state: LifecycleState = 'startup';
  private bootedAt = Date.now();
  private history: Array<{ from: LifecycleState; to: LifecycleState; at: string }> = [];
  private shuttingDown = false;
  private serverHandle?: KernelBootOpts['server'];

  constructor(bus: SystemEventBus = globalSystemBus) {
    this.bus = bus;
  }

  get state(): LifecycleState {
    return this._state;
  }

  /** Advance the lifecycle state machine. Throws on an illegal transition
   *  rather than silently clamping — an undefined state must never happen. */
  transition(to: LifecycleState): void {
    const allowed = LEGAL_TRANSITIONS[this._state];
    if (!allowed.includes(to)) {
      throw new Error(`RuntimeKernel: illegal transition '${this._state}' → '${to}'`);
    }
    const from = this._state;
    this._state = to;
    this.history.push({ from, to, at: new Date().toISOString() });
    if (this.history.length > 100) this.history.shift();
  }

  private emit(type: KernelEvent['type'], detail?: string): void {
    const at = new Date().toISOString();
    this.bus.emit({ type, at, ...(detail ? { reason: detail } : {}) } as KernelEvent);
  }

  /** Register the runtime's existing singletons for discovery, then move
   *  startup → initializing → ready. Registers REFERENCES only — every
   *  service here was already constructed elsewhere in the codebase; boot()
   *  never calls `new` on a component it doesn't own. */
  async boot(opts: KernelBootOpts = {}): Promise<void> {
    this.emit('kernel_booting');
    this.transition('initializing');
    this.serverHandle = opts.server;

    this.services.register('runQueue', globalRunQueue);
    this.services.register('instancePool', globalInstancePool);
    this.services.register('providerHealth', globalHealth);
    this.services.register('serverLogger', serverLogger);
    this.services.register('circuits', { list: listCircuits, reset: resetCircuit });
    this.services.register('healthReport', buildHealthReport);
    this.services.register('agentRegistry', { register: registerAgent, list: listAgents, get: getAgent });

    this.transition('ready');
    this.emit('kernel_ready');
  }

  markRunning(): void {
    this.transition('running');
    this.emit('kernel_running');
  }

  pause(reason?: string): void {
    this.transition('paused');
    this.emit('kernel_paused', reason);
  }

  resume(): void {
    this.transition('running');
    this.emit('kernel_running');
  }

  /** Poll the run queue's real in-flight count (v2/queue.ts's RunQueue —
   *  never a second semaphore) until it drains or the timeout elapses. */
  private async waitForDrain(timeoutMs: number): Promise<boolean> {
    const queue = this.services.tryGet('runQueue') ?? globalRunQueue;
    const deadline = Date.now() + timeoutMs;
    while (queue.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
    }
    return queue.inFlight === 0;
  }

  /** Graceful shutdown: stop accepting new work → drain in-flight runs →
   *  flush telemetry → release resources → shutdown. Idempotent — a second
   *  SIGTERM/SIGINT (or a call from the uncaughtException handler after an
   *  operator-triggered shutdown) must not double-drain or throw. */
  async shutdown(reason?: string, drainMs: number = DEFAULT_DRAIN_MS): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    if (this._state !== 'shutdown' && this._state !== 'stopping') {
      this.transition('stopping');
    }
    this.emit('kernel_draining', reason);

    const drained = await this.waitForDrain(drainMs).catch(() => false);
    if (!drained) {
      serverLogger.warn('kernel_drain_timeout', { drainMs, reason });
    }

    // Best-effort resource release — none of these may hang or throw into the
    // caller; a stuck dependency close must not block process exit forever
    // (the hard FORCE_EXIT_MS timer in server/index.ts is the final backstop).
    await Promise.allSettled([
      (async () => {
        const { getRedis } = await import('../../server/redis.js');
        await getRedis().quit();
      })(),
      (async () => {
        serverLogger.info('kernel_shutdown_metrics_flush');
      })(),
    ]);

    if (this._state !== 'shutdown') this.transition('shutdown');
    this.emit('kernel_stopped', reason);
  }

  snapshot(): KernelSnapshot {
    const queue = this.services.tryGet('runQueue') ?? globalRunQueue;
    return {
      state: this._state,
      uptimeMs: Date.now() - this.bootedAt,
      services: this.services.list(),
      inFlightRuns: queue.inFlight,
      queuedRuns: queue.queued,
      transitions: [...this.history],
    };
  }
}

/** Process-wide kernel — the ONE RuntimeKernel for this server instance. */
export const globalKernel = new RuntimeKernel();

let _booted: Promise<void> | undefined;

/** Idempotent convenience: boots `globalKernel` at most once per process,
 *  regardless of how many callers await it. */
export async function bootKernel(opts?: KernelBootOpts): Promise<RuntimeKernel> {
  if (!_booted) _booted = globalKernel.boot(opts);
  await _booted;
  return globalKernel;
}

// Deliberately NOT built: a distributed/multi-node kernel (Titan Distributed
// Runtime is Future Compatibility, not this pass); a code-loading plugin
// system (the honest "Plugin Loader" here is v2/registry.ts's existing
// registerAgent() — runtime-extensible today, no new loader invented); a
// priority scheduler replacing RunQueue's fair FIFO (a deliberate property,
// not a gap); a live admin dashboard (snapshot() is the data an eventual
// /v1/kernel route would serve, but no route is added by this pass — no UI
// consumes it yet, so a route would be dead surface). cli.ts's one-shot
// process intentionally does NOT call bootKernel(): a CLI invocation has
// nothing to drain, no server handle to close, no long-lived Redis/BullMQ
// connections to release — booting the full lifecycle there would add
// latency for a lifecycle that ends the instant the command returns.
