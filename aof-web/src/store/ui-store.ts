import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FileContext =
  | "css" | "tailwind" | "ts" | "tsx" | "jsx" | "js"
  | "api" | "test" | "config" | "markdown" | "sql"
  | "docker" | "json" | "yaml" | "unknown";

interface UIState {
  sidebarExpanded: boolean;
  toggleSidebar: () => void;
  setSidebarExpanded: (v: boolean) => void;

  mobileNavOpen: boolean;
  setMobileNav: (v: boolean) => void;

  /** Developer Mode — OFF by default. The ONE app-wide switch that reveals
   *  technical surfaces: diagnostics panels, dev-only CoCode panels, raw error
   *  details, backend/model internals. (diagnostics-store used to keep its own
   *  copy; this is now the single source of truth.) */
  developerMode: boolean;
  setDeveloperMode: (v: boolean) => void;
  toggleDeveloperMode: () => void;

  /** Command palette (Ctrl+Shift+P). */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;

  /** Adaptive sidebar context — derived from the active file extension. */
  activeFileContext: FileContext;
  setActiveFileContext: (ctx: FileContext) => void;

  /** Status bar cursor position. */
  cursorPosition: { line: number; col: number };
  setCursorPosition: (pos: { line: number; col: number }) => void;

  /** Whether the CoCode AI chat is currently streaming a reply. Drives the status bar's AI indicator. */
  aiStreaming: boolean;
  setAiStreaming: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarExpanded: true,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),

      mobileNavOpen: false,
      setMobileNav: (v) => set({ mobileNavOpen: v }),

      developerMode: false,
      setDeveloperMode: (v) => set({ developerMode: v }),
      toggleDeveloperMode: () => set((s) => ({ developerMode: !s.developerMode })),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),

      activeFileContext: "unknown",
      setActiveFileContext: (ctx) => set({ activeFileContext: ctx }),

      cursorPosition: { line: 1, col: 1 },
      setCursorPosition: (pos) => set({ cursorPosition: pos }),

      aiStreaming: false,
      setAiStreaming: (v) => set({ aiStreaming: v }),
    }),
    {
      name: "aof.ui",
      partialize: (s) => ({
        sidebarExpanded: s.sidebarExpanded,
        developerMode: s.developerMode,
      }),
      // One-time adoption of the legacy diagnostics-store copy of developerMode:
      // users who had turned it on there must not silently lose the setting.
      onRehydrateStorage: () => (state) => {
        if (!state || state.developerMode || typeof window === "undefined") return;
        try {
          const raw = window.localStorage.getItem("aof.diagnostics");
          if (raw && JSON.parse(raw)?.state?.developerMode === true) {
            useUIStore.setState({ developerMode: true });
          }
        } catch {
          // corrupt legacy state — ignore
        }
      },
    },
  ),
);
