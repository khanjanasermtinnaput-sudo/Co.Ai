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

  /** Developer Mode — OFF by default. Shows TMAP, Agent Monitor, advanced panels. */
  developerMode: boolean;
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
      sidebarExpanded: false,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),

      mobileNavOpen: false,
      setMobileNav: (v) => set({ mobileNavOpen: v }),

      developerMode: false,
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
    },
  ),
);
