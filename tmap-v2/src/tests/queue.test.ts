import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL ?? process.env.REDIS_HOST);

describe('Queue constants', () => {
  test('QUEUE_NAMES all start with cgntx:', async () => {
    const { QUEUE_NAMES } = await import('../server/queue.js');
    for (const name of Object.values(QUEUE_NAMES)) {
      assert.ok((name as string).startsWith('cgntx:'), `${name} should start with cgntx:`);
    }
  });

  test('QUEUE_NAMES are unique', async () => {
    const { QUEUE_NAMES } = await import('../server/queue.js');
    const names = Object.values(QUEUE_NAMES);
    assert.equal(names.length, new Set(names).size, 'Queue names must be unique');
  });
});

describe('Queue integration (requires Redis)', { skip: !REDIS_AVAILABLE }, () => {
  after(async () => {
    const { shutdownWorkers } = await import('../server/queue.js');
    await shutdownWorkers();
  });

  test('makeQueue creates a Queue instance without throwing', async () => {
    const { makeQueue, QUEUE_NAMES } = await import('../server/queue.js');
    const q = makeQueue(QUEUE_NAMES.notifications);
    assert.ok(q !== null);
    await q.close();
  });

  test('enqueue and inspect a job in the tmap queue', async () => {
    const { makeQueue, QUEUE_NAMES } = await import('../server/queue.js');
    const q = makeQueue(QUEUE_NAMES.tmap);

    const job = await q.add('tmap', {
      userId:    'test-uid',
      sessionId: 'sess-test',
      task:      'write hello world in python',
      mode:      'lite',
      creds:     {},
    });

    assert.ok(typeof job.id === 'string');
    const count = await q.getWaitingCount();
    assert.ok(count >= 1);

    await q.drain();
    await q.close();
  });
});
