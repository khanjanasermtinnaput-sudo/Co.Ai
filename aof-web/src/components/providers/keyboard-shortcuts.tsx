"use client";

// ── Global keyboard shortcuts ─────────────────────────────────────────────────
// The one place app-wide shortcuts are registered (surface-specific keys like
// CoCode's undo/redo stay with their surface). Mounted once in (app)/layout.

import { useEffect } from "react";
import { useUIStore } from "@/store/ui-store";

export function KeyboardShortcuts() {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const toggleDeveloperMode = useUIStore((s) => s.toggleDeveloperMode);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      // ⌘K or Ctrl/⌘+Shift+P — command palette
      if ((mod && !e.shiftKey && e.key.toLowerCase() === "k") || (mod && e.shiftKey && e.key === "P")) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      // Ctrl/⌘+Shift+` — developer mode
      if (mod && e.shiftKey && e.key === "`") {
        e.preventDefault();
        toggleDeveloperMode();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandPaletteOpen, toggleDeveloperMode]);

  return null;
}
