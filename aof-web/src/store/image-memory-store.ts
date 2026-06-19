"use client";

// ── Image Memory Store ────────────────────────────────────────────────────────
// Zustand store that wraps the localStorage image memory layer.
// Components call `useImageMemoryStore` to save, search, and clear memories.

import { create } from "zustand";
import {
  type LocalImageMemory,
  loadLocalImageMemories,
  saveLocalImageMemory,
  clearLocalImageMemories,
  searchLocalImageMemories,
  getImageContextForQuery,
  type RankedLocalMemory,
} from "@/lib/image-memory";

interface ImageMemoryState {
  /** All non-expired memories, keyed by imageHash */
  memories: Map<string, LocalImageMemory>;
  /** Save (or update) a memory and sync to localStorage */
  addMemory: (mem: LocalImageMemory) => void;
  /** Reload memories from localStorage (e.g. after page focus) */
  reload: () => void;
  /** Remove all image memories from localStorage + state */
  clear: () => void;
  /** Search memories by query, returning ranked results */
  search: (query: string, k?: number) => RankedLocalMemory[];
  /** Get prompt-ready context block for a given query */
  getContext: (query: string, k?: number) => string;
}

export const useImageMemoryStore = create<ImageMemoryState>((set, get) => ({
  memories: loadLocalImageMemories(),

  addMemory(mem) {
    saveLocalImageMemory(mem);
    set({ memories: loadLocalImageMemories() });
  },

  reload() {
    set({ memories: loadLocalImageMemories() });
  },

  clear() {
    clearLocalImageMemories();
    set({ memories: new Map() });
  },

  search(query, k = 3) {
    return searchLocalImageMemories(query, k);
  },

  getContext(query, k = 3) {
    return getImageContextForQuery(query, k);
  },
}));
