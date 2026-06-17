import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Guest usage meter ─────────────────────────────────────────────────────────
// Visitors can chat without signing in, up to GUEST_LIMIT messages. The counter
// is persisted to localStorage so the limit holds across reloads/sessions (the
// spec stores guest data locally and counts total, not per-session). On Google
// login the counter is reset (the user is no longer a guest).

export const GUEST_LIMIT = 3;

interface GuestStore {
  /** Number of messages a guest has sent so far. */
  messageCount: number;
  increment: () => void;
  reset: () => void;
  /** Messages remaining before the login wall (never negative). */
  remaining: () => number;
}

export const useGuestStore = create<GuestStore>()(
  persist(
    (set, get) => ({
      messageCount: 0,
      increment: () => set((s) => ({ messageCount: s.messageCount + 1 })),
      reset: () => set({ messageCount: 0 }),
      remaining: () => Math.max(0, GUEST_LIMIT - get().messageCount),
    }),
    { name: "aof.guest" },
  ),
);
