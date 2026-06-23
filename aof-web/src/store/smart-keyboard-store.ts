import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SmartKeyboardMode = 'off' | 'suggest' | 'auto';

interface SmartKeyboardState {
  enabled: boolean;
  mode: SmartKeyboardMode;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: SmartKeyboardMode) => void;
}

export const useSmartKeyboardStore = create<SmartKeyboardState>()(
  persist(
    (set) => ({
      enabled: true,
      mode: 'suggest' as SmartKeyboardMode,
      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'aof.smart-keyboard',
      partialize: (s) => ({ enabled: s.enabled, mode: s.mode }),
    }
  )
);
