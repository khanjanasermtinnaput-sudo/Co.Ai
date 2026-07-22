// ── Diagnostics ───────────────────────────────────────────────────────────────
// Tracks debug-log flags and the in-session error log (last 100 entries).
// Developer Mode itself lives in ui-store (the single source of truth) — this
// store deliberately has no copy of it. The error log is also synced from the
// client-side logger module via `subscribeErrorLog`.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ErrorLogEntry } from "@/lib/errors/logger";

interface DiagnosticsState {
  /** Debug log flags (toggled per-category in Settings → Diagnostics). */
  debugLogs: boolean;
  apiLogs: boolean;
  authLogs: boolean;
  setDebugLogs: (v: boolean) => void;
  setApiLogs: (v: boolean) => void;
  setAuthLogs: (v: boolean) => void;

  /** In-memory error log (newest first, max 100). */
  errorLog: ErrorLogEntry[];
  pushError: (entry: ErrorLogEntry) => void;
  clearErrors: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>()(
  persist(
    (set) => ({
      debugLogs: false,
      apiLogs: false,
      authLogs: false,
      setDebugLogs: (debugLogs) => set({ debugLogs }),
      setApiLogs: (apiLogs) => set({ apiLogs }),
      setAuthLogs: (authLogs) => set({ authLogs }),

      errorLog: [],
      pushError: (entry) =>
        set((s) => ({ errorLog: [entry, ...s.errorLog].slice(0, 100) })),
      clearErrors: () => set({ errorLog: [] }),
    }),
    {
      name: "aof.diagnostics",
      // Don't persist the error log across browser sessions — it's a live feed.
      partialize: (s) => ({
        debugLogs: s.debugLogs,
        apiLogs: s.apiLogs,
        authLogs: s.authLogs,
      }),
    },
  ),
);
