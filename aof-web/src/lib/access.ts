// ── Centralized access control ────────────────────────────────────────────────
// Single gate consulted before privileged actions: sending a message, creating a
// project, deploying, using a premium model, or any plan-gated Feature. Keeps the
// GUEST/FREE/LITE/PRO/ADVANCED rules in one place (see lib/plans.ts) instead of
// scattered `if (user)` checks across components.
//
// Usable from React and from plain stores (chat-store) — it reads the synchronous
// auth + guest snapshots rather than calling hooks.

import { useAuthStore, type UserTier } from "@/store/auth-store";
import { useGuestStore, GUEST_LIMIT } from "@/store/guest-store";
import { hasFeature, minTierForFeature, planFor, type Feature } from "@/lib/plans";
import type { ChatModel, CodeMode } from "@/lib/types";

export type AccessAction =
  | "send-message"
  | "create-project"
  | "deploy"
  | "premium-model";

export interface AccessResult {
  allowed: boolean;
  /** The action needs a signed-in account (show the Google login modal). */
  requiresLogin: boolean;
  /** The action needs a higher plan than the current one (show upgrade). */
  requiresUpgrade: boolean;
  /** The lowest tier that unlocks the action (when requiresUpgrade). */
  upgradeTo?: UserTier;
  /** Human-readable explanation for the UI. */
  reason?: string;
}

/** Code modes that map to a premium build experience (Pro / Titan). */
const PREMIUM_CODE_MODES = new Set<CodeMode>(["pro", "titan"]);

export function isPremiumCodeMode(mode: CodeMode): boolean {
  return PREMIUM_CODE_MODES.has(mode);
}

export function isPremiumChatModel(_model: ChatModel): boolean {
  return false;
}

const ALLOW: AccessResult = { allowed: true, requiresLogin: false, requiresUpgrade: false };

interface AccessContext {
  codeMode?: CodeMode;
  chatModel?: ChatModel;
}

/** Map a high-level action to the plan Feature it requires (if any). */
function featureForAction(action: AccessAction, ctx: AccessContext): Feature | null {
  switch (action) {
    case "create-project":
      return "projects";
    case "deploy":
      return "deploy";
    case "premium-model":
      if (ctx.codeMode === "titan") return "titan";
      if (ctx.codeMode && PREMIUM_CODE_MODES.has(ctx.codeMode)) return "aof-code";
      return null;
    default:
      return null;
  }
}

/** Evaluate a Feature gate against an explicit snapshot. Pure — easy to test. */
export function evaluateFeature(
  feature: Feature,
  snapshot: { tier: UserTier },
): AccessResult {
  if (hasFeature(snapshot.tier, feature)) return ALLOW;
  const isGuest = snapshot.tier === "GUEST";
  const upgradeTo = minTierForFeature(feature);
  return {
    allowed: false,
    requiresLogin: isGuest,
    requiresUpgrade: !isGuest,
    upgradeTo,
    reason: isGuest
      ? "Sign in with Google to use this feature."
      : `Upgrade to ${planFor(upgradeTo).name} to unlock this.`,
  };
}

/**
 * Evaluate access for an action against an explicit snapshot. Pure.
 * `checkUserAccess` below wires in the live store state.
 */
export function evaluateAccess(
  action: AccessAction,
  snapshot: { tier: UserTier; guestCount: number },
  ctx: AccessContext = {},
): AccessResult {
  const { tier, guestCount } = snapshot;
  const isGuest = tier === "GUEST";

  if (action === "send-message") {
    if (!isGuest) return ALLOW;
    if (guestCount < GUEST_LIMIT) return ALLOW;
    return {
      allowed: false,
      requiresLogin: true,
      requiresUpgrade: false,
      reason: `Guests can send ${GUEST_LIMIT} messages. Sign in with Google to keep chatting.`,
    };
  }

  const feature = featureForAction(action, ctx);
  if (!feature) return ALLOW;
  return evaluateFeature(feature, { tier });
}

/** Live access check reading the current auth + guest stores. Call anywhere. */
export function checkUserAccess(action: AccessAction, ctx: AccessContext = {}): AccessResult {
  const tier = useAuthStore.getState().tier;
  const guestCount = useGuestStore.getState().messageCount;
  return evaluateAccess(action, { tier, guestCount }, ctx);
}

/** Live Feature gate — convenience for components/stores guarding a capability. */
export function checkFeature(feature: Feature): AccessResult {
  const tier = useAuthStore.getState().tier;
  return evaluateFeature(feature, { tier });
}
