// Round 3 #6 — server-side subscription entitlement.
//
// Proves tier gating is decided server-side from subscription data, honoring
// expiry and cancellation, and that the requireSubscription middleware enforces
// (when plans are enforced) / no-ops (when not). Pure logic + middleware behaviour.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Response, NextFunction } from 'express';
import {
  isSubscriptionActive, effectiveTier, tierMeets, decideEntitlement,
  plansEnforced, requireSubscription,
} from '../server/entitlements.js';
import type { AuthedRequest } from '../server/auth.js';
import type { UserRecord } from '../server/db.js';

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past   = () => new Date(Date.now() - 86_400_000).toISOString();

describe('Round 3 #6 — entitlement pure logic', () => {
  test('isSubscriptionActive honors revoked_at and expires_at', () => {
    assert.equal(isSubscriptionActive(null), false);
    assert.equal(isSubscriptionActive({ plan: 'PRO', expires_at: null, revoked_at: null }), true);
    assert.equal(isSubscriptionActive({ plan: 'PRO', expires_at: future(), revoked_at: null }), true);
    assert.equal(isSubscriptionActive({ plan: 'PRO', expires_at: past(), revoked_at: null }), false);
    assert.equal(isSubscriptionActive({ plan: 'PRO', expires_at: null, revoked_at: past() }), false);
  });

  test('effectiveTier falls back to FREE when inactive/expired/revoked', () => {
    assert.equal(effectiveTier({ plan: 'ADVANCED', expires_at: null, revoked_at: null }), 'ADVANCED');
    assert.equal(effectiveTier({ plan: 'PRO', expires_at: past(), revoked_at: null }), 'FREE');
    assert.equal(effectiveTier({ plan: 'PRO', expires_at: null, revoked_at: past() }), 'FREE');
    assert.equal(effectiveTier(null), 'FREE');
    assert.equal(effectiveTier({ plan: 'BOGUS', expires_at: null, revoked_at: null }), 'FREE');
  });

  test('tierMeets respects rank ordering', () => {
    assert.equal(tierMeets('PRO', 'LITE'), true);
    assert.equal(tierMeets('LITE', 'PRO'), false);
    assert.equal(tierMeets('ADVANCED', 'ADVANCED'), true);
    assert.equal(tierMeets('FREE', 'LITE'), false);
  });

  test('decideEntitlement denies a LITE user a PRO feature', () => {
    assert.deepEqual(decideEntitlement('LITE', 'PRO'), { allow: false, currentTier: 'LITE', requiredTier: 'PRO' });
    assert.deepEqual(decideEntitlement('PRO', 'PRO'), { allow: true, currentTier: 'PRO', requiredTier: 'PRO' });
  });

  test('plansEnforced reads the env flag', () => {
    assert.equal(plansEnforced({}), false);
    assert.equal(plansEnforced({ COAGENTIX_ENFORCE_PLANS: '1' }), true);
    assert.equal(plansEnforced({ COAGENTIX_ENFORCE_PLANS: 'false' }), false);
  });
});

// ── middleware behaviour ──────────────────────────────────────────────────────
function fakeRes(): Response & { _status?: number; _json?: Record<string, unknown> } {
  const res = {} as Response & { _status?: number; _json?: Record<string, unknown> };
  res.status = ((c: number) => { res._status = c; return res; }) as Response['status'];
  res.json = ((b: Record<string, unknown>) => { res._json = b; return res; }) as Response['json'];
  return res;
}
function fakeReq(user?: UserRecord): AuthedRequest {
  return { user, path: '/v1/titan', method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as AuthedRequest;
}
const user = (): UserRecord => ({ id: 'id-x', username: 'x', pinHash: 'x', encryptedKeys: {}, createdAt: new Date().toISOString() });

describe('Round 3 #6 — requireSubscription middleware', () => {
  const SAVED = process.env.COAGENTIX_ENFORCE_PLANS;
  beforeEach(() => { delete process.env.COAGENTIX_ENFORCE_PLANS; });
  afterEach(() => { if (SAVED === undefined) delete process.env.COAGENTIX_ENFORCE_PLANS; else process.env.COAGENTIX_ENFORCE_PLANS = SAVED; });

  test('no-op (allows) when plan enforcement is off', async () => {
    const res = fakeRes(); let next = false;
    await requireSubscription('PRO', 'Titan')(fakeReq(user()), res, (() => { next = true; }) as NextFunction);
    assert.equal(next, true);
    assert.equal(res._status, undefined);
  });

  test('blocks with 403 when enforced and no active subscription (FREE < PRO)', async () => {
    process.env.COAGENTIX_ENFORCE_PLANS = '1';
    // No Supabase configured → getSubscriptionRow returns null → effective tier FREE.
    const res = fakeRes(); let next = false;
    await requireSubscription('PRO', 'Titan')(fakeReq(user()), res, (() => { next = true; }) as NextFunction);
    assert.equal(next, false);
    assert.equal(res._status, 403);
    assert.equal(res._json?.requiredTier, 'PRO');
    assert.equal(res._json?.currentTier, 'FREE');
    assert.equal(res._json?.upgrade, true);
  });
});
