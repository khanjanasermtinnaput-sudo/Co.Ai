// ── Diagnostics / Developer Mode ──────────────────────────────────────────────
// Tracks developer mode toggle and the in-session error log (last 100 entries).
// Both survive reloads via `persist`. The error log is also synced from the
// client-side logger module via `subscribeErrorLog`.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ErrorLogEntry } from "@/lib/errors/logger";

interface DiagnosticsState {
  developerMode: boolean;
  setDeveloperMode: (v: boolean) => void;
  toggleDeveloperMode: () => void;

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
      developerMode: false,
      setDeveloperMode: (developerMode) => set({ developerMode }),
      toggleDeveloperMode: () => set((s) => ({ developerMode: !s.developerMode })),

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
        developerMode: s.developerMode,
        debugLogs: s.debugLogs,
        apiLogs: s.apiLogs,
        authLogs: s.authLogs,
      }),
    },
  ),
);
