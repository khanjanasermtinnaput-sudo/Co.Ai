import { create } from "zustand";
import { persist } from "zustand/middleware";

interface IDEPrefsState {
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  setDeveloperMode: (on: boolean) => void;
}

export const useIDEPrefsStore = create<IDEPrefsState>()(
  persist(
    (set) => ({
      developerMode: false,
      toggleDeveloperMode: () => set((s) => ({ developerMode: !s.developerMode })),
      setDeveloperMode: (on) => set({ developerMode: on }),
    }),
    { name: "cocode-ide-prefs" },
  ),
);
