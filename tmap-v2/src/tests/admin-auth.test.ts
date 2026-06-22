// Admin authorization — regression test for the privileged-endpoint access gate.
//
// Round 3 #1: admin is now DB-backed RBAC. Elevated roles (OWNER/ADMIN/STAFF)
// live in the Supabase user_roles table, NOT an env var keyed by username — so a
// user can never become admin by choosing a username. This suite locks in the
// pure decision logic and the fail-closed middleware behaviour.
//
// Framework: node:test + node:assert/strict (no Jest)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Response, NextFunction } from 'express';
import { isElevatedRole, decideAdminAccess, requireAdmin, type AuthedRequest } from '../server/auth.js';
import type { UserRecord } from '../server/db.js';

function fakeUser(username: string): UserRecord {
  return { id: `id-${username}`, username, pinHash: 'x', encryptedKeys: {}, createdAt: new Date().toISOString() };
}
function fakeRes(): Response & { _status?: number; _json?: unknown } {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = ((code: number) => { res._status = code; return res; }) as Response['status'];
  res.json = ((body: unknown) => { res._json = body; return res; }) as Response['json'];
  return res;
}
function fakeReq(user?: UserRecord): AuthedRequest {
  return {
    user, path: '/v1/backup', method: 'POST',
    headers: {}, socket: { remoteAddress: '127.0.0.1' },
  } as unknown as AuthedRequest;
}

describe('isElevatedRole', () => {
  it('treats OWNER/ADMIN/STAFF as elevated', () => {
    for (const r of ['OWNER', 'ADMIN', 'STAFF']) assert.equal(isElevatedRole(r), true);
  });
  it('does NOT treat BETA_TESTER, USER, null, or unknown as elevated', () => {
    for (const r of ['BETA_TESTER', 'USER', '', null, undefined, 'owner']) assert.equal(isElevatedRole(r as string), false);
  });
});

describe('decideAdminAccess (pure)', () => {
  it('allows via DB role when elevated', () => {
    assert.deepEqual(decideAdminAccess('OWNER', 'anyone', {}), { allow: true, via: 'role' });
  });
  it('denies a non-elevated role even with a matching username', () => {
    assert.deepEqual(decideAdminAccess('BETA_TESTER', 'root', {}), { allow: false, via: 'denied' });
  });
  it('denies when there is no role and no break-glass', () => {
    assert.deepEqual(decideAdminAccess(null, 'root', {}), { allow: false, via: 'denied' });
  });
  it('allows via audited break-glass override when configured', () => {
    const env = { COAGENTIX_BREAKGLASS_ADMIN: ' Ops1 , root ' };
    assert.deepEqual(decideAdminAccess(null, 'root', env), { allow: true, via: 'breakglass' });
    assert.deepEqual(decideAdminAccess(null, 'OPS1', env), { allow: true, via: 'breakglass' });
    assert.deepEqual(decideAdminAccess(null, 'mallory', env), { allow: false, via: 'denied' });
  });
});

describe('requireAdmin middleware (fail-closed, no Supabase configured)', () => {
  const SAVED = process.env.COAGENTIX_BREAKGLASS_ADMIN;
  beforeEach(() => { delete process.env.COAGENTIX_BREAKGLASS_ADMIN; });
  afterEach(() => { if (SAVED === undefined) delete process.env.COAGENTIX_BREAKGLASS_ADMIN; else process.env.COAGENTIX_BREAKGLASS_ADMIN = SAVED; });

  it('rejects unauthenticated callers with 401', async () => {
    const res = fakeRes();
    let next = false;
    await requireAdmin(fakeReq(undefined), res, (() => { next = true; }) as NextFunction);
    assert.equal(next, false);
    assert.equal(res._status, 401);
  });

  it('rejects a normal user with 403 (no elevated role in DB)', async () => {
    const res = fakeRes();
    let next = false;
    await requireAdmin(fakeReq(fakeUser('bob')), res, (() => { next = true; }) as NextFunction);
    assert.equal(next, false);
    assert.equal(res._status, 403);
  });

  it('allows a break-glass user when the override is set', async () => {
    process.env.COAGENTIX_BREAKGLASS_ADMIN = 'root';
    const res = fakeRes();
    let next = false;
    await requireAdmin(fakeReq(fakeUser('root')), res, (() => { next = true; }) as NextFunction);
    assert.equal(next, true);
    assert.equal(res._status, undefined);
  });
});
