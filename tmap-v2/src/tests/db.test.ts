import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Point DB to temp dir before importing
const tmpDir = mkdtempSync(join(tmpdir(), 'cgntx-db-test-'));
process.env.CGNTX_DB_PATH = join(tmpDir, 'db.json');

// Dynamic import after env is set
const { createUser, findUserByUsername, findUserById, setUserKey, deleteUserKey,
        createSession, getUserSessions, updateSession,
        addCost, getUserCost } = await import('../server/db.js');

describe('User operations', () => {
  test('creates and finds user by username', async () => {
    const user = await createUser('testuser', 'hashed-pin');
    assert.equal(user.username, 'testuser');
    const found = await findUserByUsername('testuser');
    assert.ok(found);
    assert.equal(found!.id, user.id);
  });

  test('username is case-insensitive', async () => {
    await createUser('CaseUser', 'pin');
    const found = await findUserByUsername('caseuser');
    assert.ok(found);
  });

  test('throws on duplicate username', async () => {
    await createUser('dupuser', 'pin');
    await assert.rejects(() => createUser('dupuser', 'pin'), /username already taken/);
  });

  test('finds user by id', async () => {
    const user = await createUser('iduser', 'pin');
    const found = await findUserById(user.id);
    assert.ok(found);
    assert.equal(found!.username, 'iduser');
  });

  test('sets and deletes provider key', async () => {
    const user = await createUser('keyuser', 'pin');
    await setUserKey(user.id, 'gemini', 'enc-key-123');
    const updated = await findUserById(user.id);
    assert.equal(updated!.encryptedKeys.gemini, 'enc-key-123');
    await deleteUserKey(user.id, 'gemini');
    const deleted = await findUserById(user.id);
    assert.equal(deleted!.encryptedKeys.gemini, undefined);
  });
});

describe('Session operations', () => {
  test('creates and lists sessions', async () => {
    const user = await createUser('sessuser', 'pin');
    const s = await createSession(user.id, 'build a todo app', 'normal');
    assert.equal(s.status, 'running');
    const list = await getUserSessions(user.id);
    assert.ok(list.some((x) => x.id === s.id));
  });

  test('updates session status', async () => {
    const user = await createUser('upduser', 'pin');
    const s = await createSession(user.id, 'update test', 'lite');
    await updateSession(s.id, { status: 'done', filesCount: 3, iterations: 1 });
    const list = await getUserSessions(user.id);
    const found = list.find((x) => x.id === s.id);
    assert.equal(found!.status, 'done');
    assert.equal(found!.filesCount, 3);
  });
});

describe('Cost tracking', () => {
  test('accumulates cost', async () => {
    const user = await createUser('costuser', 'pin');
    await addCost(user.id, 1000, 0.001);
    await addCost(user.id, 2000, 0.002);
    const cost = await getUserCost(user.id);
    assert.ok(cost);
    assert.equal(cost!.totalTokens, 3000);
    assert.ok(Math.abs(cost!.totalCostUsd - 0.003) < 1e-6);
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true });
});
