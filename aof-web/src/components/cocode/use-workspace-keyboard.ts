"use client";

// Surface-local shortcuts (undo/redo). Palette + developer-mode shortcuts are
// global — see providers/keyboard-shortcuts.tsx.

import { useEffect } from "react";

export function useWorkspaceKeyboard(undo: () => void, redo: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        // Monaco handles its own undo; only intercept when editor not focused
        const active = document.activeElement;
        if (active?.tagName === "BODY" || active?.closest(".cocode-workspace-outer")) {
          e.preventDefault();
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        const active = document.activeElement;
        if (active?.tagName === "BODY" || active?.closest(".cocode-workspace-outer")) {
          e.preventDefault();
          redo();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
}
