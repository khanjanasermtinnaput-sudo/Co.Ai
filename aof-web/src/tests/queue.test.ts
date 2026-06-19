import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Queue tests run against a real Redis or are skipped when Redis is unavailable.
const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL ?? process.env.REDIS_HOST);

describe('Queue constants', () => {
  test('QUEUE_NAMES are unique strings', async () => {
    const { QUEUE_NAMES } = await import('../lib/server/queue/index.js');
    const names = Object.values(QUEUE_NAMES);
    assert.equal(names.length, new Set(names).size, 'Queue names must be unique');
    assert.ok(names.every((n) => typeof n === 'string' && n.startsWith('cgntx:')));
  });
});

describe('Queue integration (requires Redis)', { skip: !REDIS_AVAILABLE }, () => {
  test('enqueue and count embedding job', async () => {
    const { getEmbeddingsQueue, enqueueEmbedding, closeAllQueues } = await import('../lib/server/queue/index.js');

    const jobId = await enqueueEmbedding({
      userId:      'test-user',
      texts:       ['hello world'],
      targetTable: 'memories',
      rowIds:      ['00000000-0000-0000-0000-000000000001'],
    });

    assert.ok(typeof jobId === 'string' && jobId.length > 0, 'jobId should be a non-empty string');

    const q = getEmbeddingsQueue();
    const count = await q.getWaitingCount();
    assert.ok(count >= 1, 'queue should have at least 1 waiting job');

    // Cleanup
    await q.drain();
    await closeAllQueues();
  });

  test('enqueue consolidation with delay', async () => {
    const { getMemConsolQueue, enqueueConsolidation, closeAllQueues } = await import('../lib/server/queue/index.js');

    const jobId = await enqueueConsolidation(
      { userId: 'test-user', sessionId: 'sess-1', maxMemories: 5 },
      1000
    );
    assert.ok(typeof jobId === 'string');

    const q     = getMemConsolQueue();
    const count = await q.getDelayedCount();
    assert.ok(count >= 1);

    await q.drain();
    await closeAllQueues();
  });

  test('getAllQueueStats returns array of stats', async () => {
    const { getAllQueueStats, closeAllQueues } = await import('../lib/server/queue/index.js');
    const stats = await getAllQueueStats();
    assert.ok(Array.isArray(stats));
    assert.ok(stats.length > 0);
    for (const s of stats) {
      assert.ok(typeof s.name    === 'string');
      assert.ok(typeof s.waiting === 'number');
      assert.ok(typeof s.active  === 'number');
      assert.ok(typeof s.failed  === 'number');
    }
    await closeAllQueues();
  });
});
