// ── IndexedDB-backed zustand persist storage ─────────────────────────────────
// The CoCode IDE store's virtual FS + checkpoint history are far too large for
// localStorage's ~5-10MB quota (that's why they were excluded from persistence
// before, wiping every generated/edited file on reload). IndexedDB has a much
// larger quota and is async-native, which zustand's `persist` already supports.
//
// Deliberately hand-rolled rather than a library: the surface zustand needs
// (StateStorage's getItem/setItem/removeItem) is tiny, and the one dependency
// worth adding (schema/version handling) doesn't apply here — this is a single
// object store holding one JSON blob per key, no migrations.

import { useSyncExternalStore } from "react";
import type { StateStorage } from "zustand/middleware";

export const IDB_WRITE_DEBOUNCE_MS = 800;

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(storeName)) {
        req.result.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

// ── Write-status pub/sub ──────────────────────────────────────────────────────
// Describes the persistence PROCESS, not app state — deliberately kept outside
// the zustand store itself (persisting "are we currently persisting" is circular).

export type IDBWriteStatus = "idle" | "saving" | "saved" | "error";

let writeStatus: IDBWriteStatus = "idle";
const listeners = new Set<() => void>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function setWriteStatus(status: IDBWriteStatus) {
  writeStatus = status;
  listeners.forEach((l) => l());
  if (status === "saved") {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setWriteStatus("idle"), 1500);
  }
}

function subscribeWriteStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getWriteStatusSnapshot(): IDBWriteStatus {
  return writeStatus;
}

/** Reactive "Saving…" / "Saved" indicator for the workspace status bar. */
export function useIDBWriteStatus(): IDBWriteStatus {
  return useSyncExternalStore(subscribeWriteStatus, getWriteStatusSnapshot, () => "idle");
}

// ── StateStorage adapter ──────────────────────────────────────────────────────

/** A zustand `StateStorage` backed by one IndexedDB object store. Every method
 *  degrades to a no-op/null on any failure (missing IndexedDB, Safari private
 *  mode, blocked opens) instead of throwing — losing persistence should never
 *  crash the editor, just fall back to session-only state. */
export function createIDBStorage(dbName: string, storeName: string): StateStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) dbPromise = openDB(dbName, storeName);
    return dbPromise;
  }

  // Debounce the actual IndexedDB write — persist calls setItem on every
  // store `set()` with the whole partialized blob, so debouncing here (the
  // one choke point) covers fs + checkpoints + everything else together.
  let pendingValue: string | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  async function flush(key: string): Promise<void> {
    if (pendingValue === null) return;
    const value = pendingValue;
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      });
      setWriteStatus("saved");
    } catch (e) {
      console.error("[cocode] IndexedDB persist failed:", e);
      setWriteStatus("error");
    }
  }

  return {
    async getItem(key) {
      if (!hasIndexedDB()) return null;
      try {
        const db = await getDB();
        return await new Promise<string | null>((resolve, reject) => {
          const tx = db.transaction(storeName, "readonly");
          const req = tx.objectStore(storeName).get(key);
          req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
          req.onerror = () => reject(req.error);
        });
      } catch (e) {
        console.error("[cocode] IndexedDB read failed:", e);
        return null;
      }
    },

    setItem(key, value) {
      if (!hasIndexedDB()) return;
      pendingValue = value;
      setWriteStatus("saving");
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void flush(key), IDB_WRITE_DEBOUNCE_MS);
    },

    async removeItem(key) {
      if (!hasIndexedDB()) return;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      pendingValue = null;
      try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        console.error("[cocode] IndexedDB delete failed:", e);
      }
    },
  };
}
