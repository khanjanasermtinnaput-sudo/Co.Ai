// Runtime Kernel (Master Prompt 6.11) tests.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeKernel } from '../v2/kernel/kernel.js';
import { ServiceRegistry } from '../v2/kernel/service-registry.js';
import { SystemEventBus, type KernelEvent } from '../v2/kernel/system-bus.js';
import { RunQueue } from '../v2/queue.js';
import { EventBus, type WorkflowEvent } from '../v2/events.js';

describe('RuntimeKernel — lifecycle state machine', () => {
  test('legal transitions succeed; illegal ones throw', () => {
    const kernel = new RuntimeKernel(new SystemEventBus());
    assert.equal(kernel.state, 'startup');
    assert.throws(() => kernel.transition('running'));
    kernel.transition('initializing');
    kernel.transition('ready');
    assert.throws(() => kernel.transition('shutdown')); // must go through 'stopping'
    kernel.transition('running');
    kernel.transition('paused');
    kernel.transition('running');
    kernel.transition('stopping');
    kernel.transition('shutdown');
    assert.throws(() => kernel.transition('running')); // terminal state
  });

  test('boot() registers the expected services and reaches ready', async () => {
    const kernel = new RuntimeKernel(new SystemEventBus());
    await kernel.boot();
    assert.equal(kernel.state, 'ready');
    for (const key of [
      'runQueue', 'instancePool', 'providerHealth', 'serverLogger', 'circuits', 'healthReport', 'agentRegistry',
    ] as const) {
      assert.ok(kernel.services.has(key), `expected '${key}' registered after boot()`);
    }
  });
});

describe('ServiceRegistry — lightweight typed registration', () => {
  test('get() throws for an unregistered key; register()/get() round-trip; list() reports names', () => {
    const registry = new ServiceRegistry();
    assert.throws(() => registry.get('runQueue'));
    assert.equal(registry.tryGet('runQueue'), undefined);

    const q = new RunQueue(2);
    registry.register('runQueue', q);
    assert.equal(registry.get('runQueue'), q);
    assert.ok(registry.list().includes('runQueue'));
  });
});

describe('RuntimeKernel — graceful shutdown', () => {
  test('shutdown() drains in-flight runs via RunQueue before completing', async () => {
    const kernel = new RuntimeKernel(new SystemEventBus());
    await kernel.boot();
    const localQueue = new RunQueue(1);
    kernel.services.register('runQueue', localQueue);
    kernel.markRunning();

    const release = await localQueue.acquire(); // occupy the one slot
    assert.equal(localQueue.inFlight, 1);

    let resolved = false;
    const shutdownPromise = kernel.shutdown(undefined, 2_000).then(() => { resolved = true; });

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(resolved, false, 'shutdown must not resolve while a run is still in flight');

    release();
    await shutdownPromise;
    assert.equal(resolved, true);
    assert.equal(kernel.state, 'shutdown');
  });

  test('shutdown() is idempotent — a second call does not throw or re-drain', async () => {
    const kernel = new RuntimeKernel(new SystemEventBus());
    await kernel.boot();
    kernel.markRunning();
    await kernel.shutdown('first');
    assert.equal(kernel.state, 'shutdown');
    await kernel.shutdown('second'); // must not throw
    assert.equal(kernel.state, 'shutdown');
  });

  test('shutdown() before boot() (state=startup) still reaches shutdown cleanly', async () => {
    const kernel = new RuntimeKernel(new SystemEventBus());
    await kernel.shutdown('boot-failed');
    assert.equal(kernel.state, 'shutdown');
  });
});

describe('SystemEventBus', () => {
  test('delivers kernel_ready / kernel_stopped to on() and onAny() subscribers', async () => {
    const bus = new SystemEventBus();
    const kernel = new RuntimeKernel(bus);
    const onReady: KernelEvent[] = [];
    const onAny: KernelEvent[] = [];
    bus.on('kernel_ready', (e) => onReady.push(e));
    bus.onAny((e) => onAny.push(e));

    await kernel.boot();
    kernel.markRunning();
    await kernel.shutdown();

    assert.equal(onReady.length, 1);
    assert.ok(onAny.some((e) => e.type === 'kernel_stopped'));
  });

  test('regression: a per-run EventBus and the process-scoped SystemEventBus are isolated — neither receives the other\'s events', () => {
    const workflowEvents: WorkflowEvent[] = [];
    const kernelEvents: KernelEvent[] = [];
    const runBus = new EventBus();
    const sysBus = new SystemEventBus();
    runBus.onAny((e) => workflowEvents.push(e));
    sysBus.onAny((e) => kernelEvents.push(e));

    runBus.emit({ type: 'node_start', nodeId: 'n1' });
    sysBus.emit({ type: 'kernel_ready', at: new Date().toISOString() });

    assert.equal(workflowEvents.length, 1);
    assert.equal(kernelEvents.length, 1);
    assert.equal(workflowEvents[0].type, 'node_start');
    assert.equal(kernelEvents[0].type, 'kernel_ready');
  });
});
