// Server-side subscription entitlement — Round 3 #6.
//
// Premium capabilities are gated by the user's subscription tier, enforced on the
// server from the shared Supabase `subscriptions` table — never trusted from the
// client. Honors expiry (expires_at) and cancellation (revoked_at).
//
// Payment processing is intentionally out of scope for now: tiers are granted via
// the admin panel / redeem codes (subscriptions table). Enforcement is gated by
// COAGENTIX_ENFORCE_PLANS so the platform can run open until billing goes live;
// flip it on to make premium endpoints require entitlement.

import type { Response, NextFunction } from 'express';
import { getSubscriptionRow, type SubscriptionRow } from './db.js';
import type { AuthedRequest } from './auth.js';
import { logAuditEvent, AuditAction, getClientIp } from './audit.js';

export type Tier = 'FREE' | 'LITE' | 'PRO' | 'ADVANCED';

const RANK: Record<Tier, number> = { FREE: 0, LITE: 1, PRO: 2, ADVANCED: 3 };

export function isTier(v: string | null | undefined): v is Tier {
  return v === 'FREE' || v === 'LITE' || v === 'PRO' || v === 'ADVANCED';
}

/** A subscription is active when it is neither revoked nor expired. */
export function isSubscriptionActive(row: SubscriptionRow | null, now: number = Date.now()): boolean {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false;
  return true;
}

/** The user's effective tier — their active plan, or FREE when none/expired/revoked. */
export function effectiveTier(row: SubscriptionRow | null, now: number = Date.now()): Tier {
  if (isSubscriptionActive(row, now) && isTier(row!.plan)) return row!.plan;
  return 'FREE';
}

/** Whether `current` satisfies the `min` tier requirement. */
export function tierMeets(current: Tier, min: Tier): boolean {
  return RANK[current] >= RANK[min];
}

export interface EntitlementDecision { allow: boolean; currentTier: Tier; requiredTier: Tier; }

export function decideEntitlement(current: Tier, min: Tier): EntitlementDecision {
  return { allow: tierMeets(current, min), currentTier: current, requiredTier: min };
}

/** Whether plan enforcement is switched on (off by default until billing is live). */
export function plansEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env.COAGENTIX_ENFORCE_PLANS ?? '').trim().toLowerCase());
}

/**
 * Express middleware factory: require at least `minTier` for `feature`.
 * Must run AFTER requireAuth. When enforcement is off it is a no-op (open access).
 */
export function requireSubscription(minTier: Tier, feature: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!plansEnforced()) { next(); return; }

    const user = req.user;
    if (!user) { res.status(401).json({ error: 'authentication required' }); return; }

    const row = await getSubscriptionRow(user.id);
    const tier = effectiveTier(row);
    const decision = decideEntitlement(tier, minTier);

    if (!decision.allow) {
      try {
        await logAuditEvent({
          actorId: user.id, actorIp: getClientIp(req as never), action: AuditAction.QUOTA_EXCEEDED,
          outcome: 'failure', severity: 'info',
          metadata: { reason: 'entitlement denied', feature, requiredTier: minTier, currentTier: tier },
        });
      } catch { /* audit is best-effort */ }
      res.status(403).json({
        error: `${feature} requires the ${minTier} plan or higher.`,
        upgrade: true, requiredTier: minTier, currentTier: tier,
      });
      return;
    }
    next();
  };
}
