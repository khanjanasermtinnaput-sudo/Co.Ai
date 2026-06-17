import { create } from "zustand";

// ── Non-React auth snapshot ───────────────────────────────────────────────────
// The React-facing auth API stays in AuthProvider/useAuth(), but plain modules
// (chat-store, lib/conversations, lib/access) need to read auth state too without
// a hook. AuthProvider mirrors its state into this store so those call sites can
// check login/tier synchronously via useAuthStore.getState().

export type UserTier = "GUEST" | "FREE" | "LITE" | "PRO";

/** Higher number = more access. Used for >= comparisons in checkUserAccess. */
export const TIER_RANK: Record<UserTier, number> = {
  GUEST: 0,
  FREE: 1,
  LITE: 2,
  PRO: 3,
};

interface AuthStore {
  /** Supabase user id when signed in, else null (guest). */
  userId: string | null;
  tier: UserTier;
  /** True once the initial auth check has resolved (avoids flicker/races). */
  ready: boolean;

  /** Login modal — opened when a guest hits a gate (3-message limit, etc). */
  loginModalOpen: boolean;
  loginModalReason: string | null;

  setAuth: (snapshot: { userId: string | null; tier: UserTier; ready: boolean }) => void;
  openLoginModal: (reason?: string) => void;
  closeLoginModal: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  userId: null,
  tier: "GUEST",
  ready: false,

  loginModalOpen: false,
  loginModalReason: null,

  setAuth: ({ userId, tier, ready }) => set({ userId, tier, ready }),
  openLoginModal: (reason) => set({ loginModalOpen: true, loginModalReason: reason ?? null }),
  closeLoginModal: () => set({ loginModalOpen: false }),
}));

/** Convenience: is there a signed-in user right now? (synchronous) */
export function isSignedIn(): boolean {
  return useAuthStore.getState().userId !== null;
}
