import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Usage meter ───────────────────────────────────────────────────────────────
// Per-day activity counters surfaced in the Usage dashboard and used to enforce
// daily message quotas (see lib/plans.ts). Persisted to localStorage and rolled
// over automatically at the start of each calendar day. This is the client-side
// view; durable server-side accounting can layer on top later without changing
// these call sites.

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

interface UsageState {
  date: string;
  messages: number;
  tokens: number;
  searches: number;

  /** Roll counters over when the day changes. Safe to call before every read/write. */
  ensureToday: () => void;
  recordMessage: (tokens?: number) => void;
  recordSearch: () => void;
  reset: () => void;
}

export const useUsageStore = create<UsageState>()(
  persist(
    (set, get) => ({
      date: today(),
      messages: 0,
      tokens: 0,
      searches: 0,

      ensureToday: () => {
        const d = today();
        if (get().date !== d) {
          set({ date: d, messages: 0, tokens: 0, searches: 0 });
        }
      },

      recordMessage: (tokens = 0) => {
        get().ensureToday();
        set((s) => ({ messages: s.messages + 1, tokens: s.tokens + Math.max(0, Math.round(tokens)) }));
      },

      recordSearch: () => {
        get().ensureToday();
        set((s) => ({ searches: s.searches + 1 }));
      },

      reset: () => set({ date: today(), messages: 0, tokens: 0, searches: 0 }),
    }),
    { name: "aof.usage" },
  ),
);

/** Rough token estimate (matches the backend's text.length/4 heuristic). */
export function estimateTokensFor(text: string): number {
  return Math.ceil(text.length / 4);
}
