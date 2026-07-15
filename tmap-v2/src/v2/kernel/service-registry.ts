// v2/kernel — Runtime Kernel service registry (Master Prompt 6.11).
//
// "No service may communicate before registration" / "Components never
// instantiate dependencies manually" (spec). This repo already wires its
// runtime collaborators as constructor-injected args + module-level
// `globalX` singletons (globalRunQueue, globalHealth, globalInstancePool,
// globalRoutingTelemetry, listAgents/registerAgent) — a proven pattern with
// zero framework overhead for a single-process Node runtime. A reflection-
// based IoC container would compete with that pattern for no real benefit
// here (see ServiceRegistry's own "Deliberately NOT" note below).
//
// Instead this is a LIGHTWEIGHT TYPED REGISTRY: a compile-time-checked map
// from a fixed set of service names to the EXISTING singleton references.
// The kernel's boot() is the one place that populates it; every consumer
// reads through registry.get('name') rather than importing the singleton
// directly, so a caller who only holds a RuntimeKernel reference can still
// discover any registered service (Service Discovery, per spec) without a
// new import.

import type { RunQueue } from '../queue.js';
import type { InstancePool } from '../../providers/instance-pool.js';
import type { HealthStore } from '../../dars/health.js';
import type { listCircuits, resetCircuit } from '../../server/failover.js';
import type { buildHealthReport } from '../../server/health.js';
import type { registerAgent, listAgents, getAgent } from '../registry.js';
import type { logger as ServerLogger } from '../../server/logger.js';

/** Every service name the Runtime Kernel knows how to register, and the
 *  EXISTING type each one resolves to. Adding a new runtime component means
 *  adding one line here — never a new ad hoc global. */
export interface ServiceMap {
  runQueue: RunQueue;
  instancePool: InstancePool;
  providerHealth: HealthStore;
  serverLogger: typeof ServerLogger;
  circuits: { list: typeof listCircuits; reset: typeof resetCircuit };
  healthReport: typeof buildHealthReport;
  agentRegistry: { register: typeof registerAgent; list: typeof listAgents; get: typeof getAgent };
}

export type ServiceKey = keyof ServiceMap;

export class ServiceRegistry {
  private services = new Map<ServiceKey, ServiceMap[ServiceKey]>();

  register<K extends ServiceKey>(key: K, value: ServiceMap[K]): void {
    this.services.set(key, value);
  }

  get<K extends ServiceKey>(key: K): ServiceMap[K] {
    if (!this.services.has(key)) {
      throw new Error(`ServiceRegistry: '${key}' is not registered — did boot() run?`);
    }
    return this.services.get(key) as ServiceMap[K];
  }

  tryGet<K extends ServiceKey>(key: K): ServiceMap[K] | undefined {
    return this.services.get(key) as ServiceMap[K] | undefined;
  }

  has(key: ServiceKey): boolean {
    return this.services.has(key);
  }

  list(): ServiceKey[] {
    return [...this.services.keys()];
  }
}

// Deliberately NOT built: reflection-based dependency resolution (constructor
// param inspection, decorators), a global service locator singleton (each
// RuntimeKernel owns its own ServiceRegistry instance — see kernel.ts), and
// hot-swapping a registered service's implementation at runtime (re-register
// is fine for tests; production services are the process's real singletons
// for the life of the process).
