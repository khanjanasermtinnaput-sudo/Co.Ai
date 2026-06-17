// ── Centralized access control ────────────────────────────────────────────────
// Single gate consulted before privileged actions: sending a message, creating a
// project, deploying, or using a premium model. Keeps the GUEST/FREE/LITE/PRO
// rules in one place instead of scattered `if (user)` checks across components.
//
// Usable from React and from plain stores (chat-store) — it reads the synchronous
// auth + guest snapshots rather than calling hooks.

import { useAuthStore, type UserTier } from "@/store/auth-store";
import { useGuestStore, GUEST_LIMIT } from "@/store/guest-store";
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
  /** Human-readable explanation for the UI. */
  reason?: string;
}

/** Models/modes that require a paid plan (LITE+). Everything else is FREE-tier. */
const PREMIUM_CODE_MODES = new Set<CodeMode>(["pro", "titan"]);

export function isPremiumCodeMode(mode: CodeMode): boolean {
  return PREMIUM_CODE_MODES.has(mode);
}

export function isPremiumChatModel(_model: ChatModel): boolean {
  // Both chat models (lite/normal) are available on the free tier today.
  return false;
}

const ALLOW: AccessResult = { allowed: true, requiresLogin: false, requiresUpgrade: false };

interface AccessContext {
  /** For "premium-model": the code mode or chat model the user is trying to use. */
  codeMode?: CodeMode;
  chatModel?: ChatModel;
}

/**
 * Evaluate access for an action against an explicit snapshot. Pure — easy to test
 * and reuse. `checkUserAccess` below wires in the live store state.
 */
export function evaluateAccess(
  action: AccessAction,
  snapshot: { tier: UserTier; guestCount: number },
  ctx: AccessContext = {},
): AccessResult {
  const { tier, guestCount } = snapshot;
  const isGuest = tier === "GUEST";

  switch (action) {
    case "send-message": {
      if (!isGuest) return ALLOW;
      if (guestCount < GUEST_LIMIT) return ALLOW;
      return {
        allowed: false,
        requiresLogin: true,
        requiresUpgrade: false,
        reason: `Guests can send ${GUEST_LIMIT} messages. Sign in with Google to keep chatting.`,
      };
    }

    case "create-project":
    case "deploy": {
      if (!isGuest) return ALLOW;
      return {
        allowed: false,
        requiresLogin: true,
        requiresUpgrade: false,
        reason:
          action === "deploy"
            ? "Sign in to deploy your projects."
            : "Sign in to save and manage projects.",
      };
    }

    case "premium-model": {
      const premium = ctx.codeMode
        ? isPremiumCodeMode(ctx.codeMode)
        : ctx.chatModel
          ? isPremiumChatModel(ctx.chatModel)
          : false;
      if (!premium) return ALLOW;
      // Premium modes (Pro / Titan) are off-limits to guests. Any signed-in user
      // may use them today; once paid LITE/PRO plans exist, tighten this to
      // `TIER_RANK[tier] >= TIER_RANK.LITE` and surface requiresUpgrade for FREE.
      if (!isGuest) return ALLOW;
      return {
        allowed: false,
        requiresLogin: true,
        requiresUpgrade: false,
        reason: "Sign in to use Pro and Titan modes.",
      };
    }

    default:
      return ALLOW;
  }
}

/** Live access check reading the current auth + guest stores. Call anywhere. */
export function checkUserAccess(action: AccessAction, ctx: AccessContext = {}): AccessResult {
  const tier = useAuthStore.getState().tier;
  const guestCount = useGuestStore.getState().messageCount;
  return evaluateAccess(action, { tier, guestCount }, ctx);
}
