'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useSmartKeyboardStore } from '@/store/smart-keyboard-store';
import type { SmartKeyboardMode } from '@/store/smart-keyboard-store';
import { detectWrongLayout, isSafeToConvert } from '@/lib/smart-keyboard';
import type { DetectionResult } from '@/lib/smart-keyboard';

// ─── Context shape ────────────────────────────────────────────────────────────

export interface SmartKeyboardContextValue {
  enabled: boolean;
  mode: SmartKeyboardMode;
  setEnabled: (v: boolean) => void;
  setMode: (v: SmartKeyboardMode) => void;
  /**
   * Evaluate a text value and return what action (if any) should be taken.
   * Fully synchronous — runs in <10 ms.
   */
  evaluate: (text: string) => {
    detection: DetectionResult;
    shouldAutoConvert: boolean;
    shouldSuggest: boolean;
  };
}

const SmartKeyboardContext = createContext<SmartKeyboardContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SmartKeyboardProvider({ children }: { children: React.ReactNode }) {
  const { enabled, mode, setEnabled, setMode } = useSmartKeyboardStore();

  const value = useMemo<SmartKeyboardContextValue>(
    () => ({
      enabled,
      mode,
      setEnabled,
      setMode,
      evaluate(text) {
        const empty = {
          detection: { confidence: 0, type: 'none' as const, converted: null },
          shouldAutoConvert: false,
          shouldSuggest: false,
        };

        if (!enabled || mode === 'off') return empty;
        if (!isSafeToConvert(text)) return empty;

        const detection = detectWrongLayout(text);

        const shouldAutoConvert =
          mode === 'auto' &&
          detection.confidence >= 80 &&
          detection.type !== 'none' &&
          detection.converted !== null;

        const shouldSuggest =
          (mode === 'suggest' || mode === 'auto') &&
          detection.confidence >= 50 &&
          !shouldAutoConvert &&
          detection.converted !== null;

        return { detection, shouldAutoConvert, shouldSuggest };
      },
    }),
    [enabled, mode, setEnabled, setMode]
  );

  return (
    <SmartKeyboardContext.Provider value={value}>
      {children}
    </SmartKeyboardContext.Provider>
  );
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useSmartKeyboardContext(): SmartKeyboardContextValue {
  const ctx = useContext(SmartKeyboardContext);
  if (!ctx) {
    throw new Error('useSmartKeyboardContext must be used inside <SmartKeyboardProvider>');
  }
  return ctx;
}
