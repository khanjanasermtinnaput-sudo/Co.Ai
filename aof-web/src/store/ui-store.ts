import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  /** Desktop sidebar expanded (labels visible) vs. collapsed (icons only). */
  sidebarExpanded: boolean;
  toggleSidebar: () => void;
  setSidebarExpanded: (v: boolean) => void;

  /** Mobile slide-over navigation. */
  mobileNavOpen: boolean;
  setMobileNav: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),

      mobileNavOpen: false,
      setMobileNav: (v) => set({ mobileNavOpen: v }),
    }),
    {
      name: "cgntx.ui",
      partialize: (s) => ({ sidebarExpanded: s.sidebarExpanded }),
    },
  ),
);
