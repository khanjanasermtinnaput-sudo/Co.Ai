// JWT revocation denylist — regression tests for the leaked-token mitigation.
//
// A logged-out or rotated token must stop working BEFORE its 7-day expiry.
// Per-token revocation keys off the jti claim; per-user revocation rejects any
// token issued before the revoke-all moment. Without Redis configured these
// run against the in-memory mock, which is exactly the single-instance path.
//
// Framework: node:test + node:assert/strict (no Jest)

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const { signToken, revokeToken, revokeAllUserTokens, requireAuth } =
  await import('../server/auth.js');
import type { AuthedRequest } from '../server/auth.js';
import type { Response, NextFunction } from 'express';

function fakeRes(): Response & { _status?: number; _json?: unknown } {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = ((code: number) => { res._status = code; return res; }) as Response['status'];
  res.json = ((body: unknown) => { res._json = body; return res; }) as Response['json'];
  return res;
}
function reqWithToken(token: string): AuthedRequest {
  return {
    headers: { authorization: `Bearer ${token}` },
    socket: { remoteAddress: '127.0.0.1' },
    path: '/v1/me', method: 'GET',
  } as unknown as AuthedRequest;
}

describe('signToken', () => {
  it('embeds a unique jti so each token is individually revocable', () => {
    const a = jwt.decode(signToken('user-1')) as { jti?: string };
    const b = jwt.decode(signToken('user-1')) as { jti?: string };
    assert.ok(a.jti && b.jti, 'tokens must carry jti');
    assert.notEqual(a.jti, b.jti);
  });
});

describe('revokeToken', () => {
  it('revokes a valid token and requireAuth then rejects it with 401 token revoked', async () => {
    const token = signToken('user-revoke-1');
    assert.equal(await revokeToken(token), true);

    const res = fakeRes();
    let nexted = false;
    await requireAuth(reqWithToken(token), res, (() => { nexted = true; }) as NextFunction);
    assert.equal(nexted, false, 'next() must not run for a revoked token');
    assert.equal(res._status, 401);
    assert.deepEqual(res._json, { error: 'token revoked' });
  });

  it('returns false for garbage and expired tokens', async () => {
    assert.equal(await revokeToken('not-a-jwt'), false);
    const expired = jwt.sign({ sub: 'u', jti: 'x' }, process.env.JWT_SECRET!, { expiresIn: -10 });
    assert.equal(await revokeToken(expired), false);
  });
});

describe('revokeAllUserTokens', () => {
  it('rejects tokens issued before the revoke-all moment but accepts newer ones', async () => {
    // iat has 1-second resolution — backdate the old token instead of sleeping.
    const old = jwt.sign(
      { sub: 'user-nuke', jti: 'old-jti', iat: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' },
    );
    await revokeAllUserTokens('user-nuke');

    const resOld = fakeRes();
    await requireAuth(reqWithToken(old), resOld, (() => {}) as NextFunction);
    assert.equal(resOld._status, 401);
    assert.deepEqual(resOld._json, { error: 'token revoked' });

    // A token minted AFTER revoke-all must pass the revocation gate. (It then
    // proceeds to the user lookup, whose outcome is environment-dependent —
    // asserting only that it is NOT rejected as revoked keeps this hermetic.)
    const fresh = jwt.sign(
      { sub: 'user-nuke', jti: 'new-jti', iat: Math.floor(Date.now() / 1000) + 60 },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' },
    );
    const resNew = fakeRes();
    await requireAuth(reqWithToken(fresh), resNew, (() => {}) as NextFunction);
    assert.notDeepEqual(resNew._json, { error: 'token revoked' });
  });
});

describe('assertJwtSecret', () => {
  // Regression: register once created the user BEFORE signing the token, so a
  // missing/weak JWT_SECRET stranded the account and burned the username.
  // assertJwtSecret() is the pre-createUser gate — it must throw on exactly
  // the same condition signToken throws on.
  it('throws when JWT_SECRET is missing or under 32 chars, passes when valid', async () => {
    const { assertJwtSecret } = await import('../server/auth.js');
    const saved = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      assert.throws(() => assertJwtSecret(), /JWT_SECRET/);
      process.env.JWT_SECRET = 'short';
      assert.throws(() => assertJwtSecret(), /JWT_SECRET/);
      process.env.JWT_SECRET = saved;
      assert.doesNotThrow(() => assertJwtSecret());
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });
});
