// Admin authorization — regression test for the privileged-endpoint access gate.
//
// User accounts have no role column, so system/infra endpoints (backup, restore,
// disaster-recovery, failover, infra & platform analytics) are gated by the
// COAGENTIX_ADMIN_USERNAMES allowlist via requireAdmin. This suite locks in the
// secure-by-default behaviour: no env => nobody is admin.
//
// Framework: node:test + node:assert/strict (no Jest)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Response, NextFunction } from 'express';
import { isAdminUser, requireAdmin, type AuthedRequest } from '../server/auth.js';
import type { UserRecord } from '../server/db.js';

function fakeUser(username: string): UserRecord {
  return {
    id: `id-${username}`,
    username,
    pinHash: 'x',
    encryptedKeys: {},
    createdAt: new Date().toISOString(),
  };
}

// Minimal Express res double that records the status/json it was given.
function fakeRes(): Response & { _status?: number; _json?: unknown } {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = ((code: number) => { res._status = code; return res; }) as Response['status'];
  res.json = ((body: unknown) => { res._json = body; return res; }) as Response['json'];
  return res;
}

describe('admin authorization gate', () => {
  const ORIGINAL = process.env.COAGENTIX_ADMIN_USERNAMES;
  beforeEach(() => { delete process.env.COAGENTIX_ADMIN_USERNAMES; delete process.env.AOF_ADMIN_USERNAMES; });
  afterEach(()  => { if (ORIGINAL === undefined) delete process.env.COAGENTIX_ADMIN_USERNAMES; else process.env.COAGENTIX_ADMIN_USERNAMES = ORIGINAL; });

  it('treats nobody as admin when the allowlist is unset (secure by default)', () => {
    assert.equal(isAdminUser(fakeUser('alice')), false);
    assert.equal(isAdminUser(undefined), false);
  });

  it('recognises an allowlisted username (case-insensitive, trims spaces)', () => {
    process.env.COAGENTIX_ADMIN_USERNAMES = ' Owner , ops1 ';
    assert.equal(isAdminUser(fakeUser('owner')), true);
    assert.equal(isAdminUser(fakeUser('OPS1')), true);
    assert.equal(isAdminUser(fakeUser('mallory')), false);
  });

  it('falls back to the legacy AOF_ADMIN_USERNAMES var', () => {
    process.env.AOF_ADMIN_USERNAMES = 'legacyadmin';
    assert.equal(isAdminUser(fakeUser('legacyadmin')), true);
  });

  it('requireAdmin rejects a non-admin with 403', () => {
    const req = { user: fakeUser('bob') } as AuthedRequest;
    const res = fakeRes();
    let nextCalled = false;
    requireAdmin(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false);
    assert.equal(res._status, 403);
  });

  it('requireAdmin calls next() for an allowlisted admin', () => {
    process.env.COAGENTIX_ADMIN_USERNAMES = 'root';
    const req = { user: fakeUser('root') } as AuthedRequest;
    const res = fakeRes();
    let nextCalled = false;
    requireAdmin(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal(res._status, undefined);
  });
});
