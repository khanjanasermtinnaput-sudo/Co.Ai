// ── Diagnostics / Developer Mode ──────────────────────────────────────────────
// Developer Mode reveals the raw diagnostics on an AOF error panel (HTTP status,
// provider response, stack trace, request metadata). Off by default; persisted so
// it survives reloads while debugging.

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DiagnosticsState {
  developerMode: boolean;
  setDeveloperMode: (v: boolean) => void;
  toggleDeveloperMode: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>()(
  persist(
    (set) => ({
      developerMode: false,
      setDeveloperMode: (developerMode) => set({ developerMode }),
      toggleDeveloperMode: () => set((s) => ({ developerMode: !s.developerMode })),
    }),
    { name: "nexora.diagnostics" },
  ),
);
