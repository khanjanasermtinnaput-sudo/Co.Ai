import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { FileStore } from '../server/store/fileStore.js';

const dir = mkdtempSync(join(tmpdir(), 'aof-store-test-'));
const dbPath = join(dir, 'db.json');
const store = new FileStore(dbPath);

describe('FileStore concurrency + atomicity', () => {
  test('concurrent addCost accumulates without lost updates', async () => {
    const user = await store.createUser('costracer', 'pin-hash');
    // Fire 50 cost writes at once — the serialized write chain must not drop any.
    await Promise.all(Array.from({ length: 50 }, () => store.addCost(user.id, 1, 0.001)));
    const cost = await store.getUserCost(user.id);
    assert.ok(cost);
    assert.equal(cost!.totalTokens, 50);
    assert.equal(cost!.sessionCount, 50);
    assert.ok(Math.abs(cost!.totalCostUsd - 0.05) < 1e-6);
  });

  test('concurrent setUserKey on the same user keeps every key', async () => {
    const user = await store.createUser('keyracer', 'pin-hash');
    const providers = ['gemini', 'deepseek', 'qwen', 'llama', 'claude'] as const;
    await Promise.all(providers.map((p, i) => store.setUserKey(user.id, p, `enc-${i}`)));
    const updated = await store.findUserById(user.id);
    assert.ok(updated);
    for (let i = 0; i < providers.length; i++) {
      assert.equal(updated!.encryptedKeys[providers[i]], `enc-${i}`);
    }
  });

  test('db file is always valid JSON after concurrent writes (atomic rename)', async () => {
    const user = await store.createUser('jsonracer', 'pin-hash');
    await Promise.all([
      store.createSession(user.id, 'task A', 'lite'),
      store.createSession(user.id, 'task B', 'normal'),
      store.addCost(user.id, 5, 0.005),
    ]);
    // The on-disk file must always parse — atomic temp+rename prevents torn writes.
    const parsed = JSON.parse(readFileSync(dbPath, 'utf8'));
    assert.ok(parsed.users);
    const sessions = await store.getUserSessions(user.id, 10);
    assert.equal(sessions.length, 2);
  });
});

after(() => rmSync(dir, { recursive: true, force: true }));
