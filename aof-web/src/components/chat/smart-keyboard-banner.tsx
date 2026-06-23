'use client';

import { Languages, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SmartKeyboardBannerProps {
  suggestion: string;
  confidence: number;
  direction: 'en->th' | 'th->en';
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Floating suggestion banner rendered below the chat composer when the
 * Smart Keyboard detects a probable layout error in "suggest" mode.
 *
 * Place this immediately after the <Composer> in chat-view.tsx.
 */
export function SmartKeyboardBanner({
  suggestion,
  confidence,
  direction,
  onAccept,
  onDismiss,
}: SmartKeyboardBannerProps) {
  const label = direction === 'en->th' ? 'Thai' : 'English';

  return (
    <AnimatePresence>
      <motion.div
        key="sk-banner"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.15 }}
        className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm shadow-sm"
      >
        <Languages className="h-4 w-4 shrink-0 text-primary" aria-hidden />

        <span className="flex-1 truncate text-muted-foreground">
          Did you mean{' '}
          <button
            type="button"
            onClick={onAccept}
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none"
          >
            {suggestion}
          </button>
          {'  '}
          <span className="text-xs text-muted-foreground/70">
            ({label} · {confidence}%)
          </span>
        </span>

        <button
          type="button"
          onClick={onAccept}
          aria-label="Accept suggestion"
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Check className="h-3 w-3" />
          Use
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="rounded-md p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
