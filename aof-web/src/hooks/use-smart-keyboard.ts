'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { useSmartKeyboardContext } from '@/components/providers/smart-keyboard-provider';
import type { DetectionResult } from '@/lib/smart-keyboard';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartKeyboardInputState {
  /** Processed value — may differ from raw input when auto-convert fires. */
  value: string;
  /** Pending suggestion text, or null when no suggestion is active. */
  suggestion: string | null;
  /** Confidence and direction of the last detection run. */
  detection: DetectionResult | null;
  /** onChange handler — drop-in replacement for the textarea onChange prop. */
  onChange: (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** Accept the current suggestion, replacing the input value. */
  onAcceptSuggestion: () => void;
  /** Dismiss the suggestion without applying it. */
  onDismissSuggestion: () => void;
  /** Ref to attach to the input/textarea element for cursor restoration. */
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Wraps a controlled input/textarea with Smart Keyboard layout correction.
 *
 * Usage:
 * ```tsx
 * const sk = useSmartKeyboard(value, setValue);
 * <textarea
 *   ref={sk.inputRef as React.RefObject<HTMLTextAreaElement>}
 *   value={sk.value}
 *   onChange={sk.onChange}
 * />
 * {sk.suggestion && <SuggestionBubble ... onAccept={sk.onAcceptSuggestion} />}
 * ```
 *
 * @param externalValue - The current controlled value from parent state.
 * @param onExternalChange - Setter / onChange callback from parent.
 * @param debounceMs - How long to wait after the last keystroke before running
 *                     detection. Default 100 ms — well within the <10 ms UX
 *                     budget because detection itself is synchronous; only the
 *                     trigger is debounced.
 */
export function useSmartKeyboard(
  externalValue: string,
  onExternalChange: (value: string) => void,
  debounceMs = 100
): SmartKeyboardInputState {
  const ctx = useSmartKeyboardContext();

  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);

  // Ref to the underlying DOM element — used to restore cursor after re-render.
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  // Stores the cursor position we want to restore after React re-renders.
  const pendingCursorRef = useRef<number | null>(null);

  // Debounce timer handle.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore cursor position after every render when a pending restore is queued.
  useEffect(() => {
    if (pendingCursorRef.current !== null && inputRef.current) {
      const pos = pendingCursorRef.current;
      inputRef.current.setSelectionRange(pos, pos);
      pendingCursorRef.current = null;
    }
  });

  // Clear suggestion whenever the external value changes from outside the hook
  // (e.g. form reset, suggestion accepted by parent).
  const prevExternal = useRef(externalValue);
  useEffect(() => {
    if (prevExternal.current !== externalValue) {
      prevExternal.current = externalValue;
      setSuggestion(null);
      setDetection(null);
    }
  }, [externalValue]);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const rawValue = e.target.value;
      const cursorPos = e.target.selectionStart ?? rawValue.length;

      // Cancel any in-flight debounce from the previous keystroke.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      // Evaluate synchronously to decide if we should auto-convert this frame.
      const { shouldAutoConvert, shouldSuggest, detection: det } =
        ctx.evaluate(rawValue);

      if (shouldAutoConvert && det.converted !== null) {
        // Auto-convert: update parent value with the converted string.
        // Cursor position is preserved because the mapping is 1:1 char-for-char.
        pendingCursorRef.current = cursorPos;
        onExternalChange(det.converted);
        setSuggestion(null);
        setDetection(det);
        prevExternal.current = det.converted;
        return;
      }

      // Pass the raw value through immediately so the input stays responsive.
      onExternalChange(rawValue);
      prevExternal.current = rawValue;

      // Debounce suggestion display — avoids flickering while user is mid-word.
      debounceTimerRef.current = setTimeout(() => {
        setDetection(det);
        if (shouldSuggest && det.converted !== null) {
          setSuggestion(det.converted);
        } else {
          setSuggestion(null);
        }
      }, debounceMs);
    },
    [ctx, onExternalChange, debounceMs]
  );

  const onAcceptSuggestion = useCallback(() => {
    if (suggestion === null) return;
    const el = inputRef.current;
    onExternalChange(suggestion);
    prevExternal.current = suggestion;
    setSuggestion(null);
    // Move cursor to end of accepted text.
    if (el) {
      const len = suggestion.length;
      pendingCursorRef.current = len;
    }
  }, [suggestion, onExternalChange]);

  const onDismissSuggestion = useCallback(() => {
    setSuggestion(null);
    setDetection(null);
  }, []);

  // Cleanup debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    value: externalValue,
    suggestion,
    detection,
    onChange,
    onAcceptSuggestion,
    onDismissSuggestion,
    inputRef,
  };
}
