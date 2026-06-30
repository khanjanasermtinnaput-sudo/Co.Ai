// ── Checkpoint & Recovery System (Phase 20) ──────────────────────────────────
// Every successful Apply Patch creates an immutable checkpoint.
// Stored in memory (Zustand persist) — no server required for local work,
// optionally synced to Supabase for cloud projects.

import type { VirtualDir } from "./virtual-fs";
import type { ParsedDiff } from "./diff";

export type CheckpointStatus = "success" | "build-failed" | "test-failed" | "pending";

export interface Checkpoint {
  id: string;
  index: number;           // monotonic counter (1, 2, 3…)
  timestamp: number;       // epoch ms
  label: string;           // human label ("Applied: add auth middleware")
  prompt: string;          // user prompt that triggered this change
  diff: ParsedDiff;        // what changed
  modifiedPaths: string[]; // quick list of changed file paths
  snapshot: VirtualDir;    // full FS snapshot at this point
  status: CheckpointStatus;
  buildOk: boolean | null;
  testOk: boolean | null;
  branchName?: string;     // if the user created a branch from this
}

// ── Create ────────────────────────────────────────────────────────────────────

let _counter = 0;

export function createCheckpoint(
  prompt: string,
  diff: ParsedDiff,
  snapshot: VirtualDir,
  status: CheckpointStatus = "pending",
): Checkpoint {
  const modifiedPaths = diff.files.map((f) => f.newPath);
  const label = `Applied: ${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}`;

  return {
    id: `ckpt_${Date.now()}_${++_counter}`,
    index: _counter,
    timestamp: Date.now(),
    label,
    prompt,
    diff,
    modifiedPaths,
    snapshot: structuredClone(snapshot),
    status,
    buildOk: null,
    testOk: null,
  };
}

// ── Undo / Redo stack management ──────────────────────────────────────────────

export interface CheckpointStack {
  past: Checkpoint[];     // oldest → newest (past[last] = current)
  future: Checkpoint[];   // newest → oldest (future[0] = next redo)
}

export function pushCheckpoint(
  stack: CheckpointStack,
  checkpoint: Checkpoint,
): CheckpointStack {
  return {
    past: [...stack.past, checkpoint],
    future: [],           // clear redo stack on new change
  };
}

export function undoCheckpoint(stack: CheckpointStack): {
  stack: CheckpointStack;
  restored: Checkpoint | null;
} {
  if (stack.past.length <= 1) return { stack, restored: null };
  const future = [stack.past[stack.past.length - 1], ...stack.future];
  const past = stack.past.slice(0, -1);
  return {
    stack: { past, future },
    restored: past[past.length - 1] ?? null,
  };
}

export function redoCheckpoint(stack: CheckpointStack): {
  stack: CheckpointStack;
  restored: Checkpoint | null;
} {
  if (!stack.future.length) return { stack, restored: null };
  const [next, ...rest] = stack.future;
  return {
    stack: { past: [...stack.past, next], future: rest },
    restored: next,
  };
}

// Jump to any arbitrary checkpoint
export function restoreCheckpoint(
  stack: CheckpointStack,
  id: string,
): { stack: CheckpointStack; restored: Checkpoint | null } {
  const allCheckpoints = [...stack.past, ...stack.future.slice().reverse()];
  const idx = allCheckpoints.findIndex((c) => c.id === id);
  if (idx < 0) return { stack, restored: null };

  const restored = allCheckpoints[idx];
  return {
    stack: {
      past: allCheckpoints.slice(0, idx + 1),
      future: allCheckpoints.slice(idx + 1).reverse(),
    },
    restored,
  };
}

// ── Auto-rollback on failure ──────────────────────────────────────────────────

export function shouldRollback(checkpoint: Checkpoint): boolean {
  return checkpoint.buildOk === false || checkpoint.testOk === false;
}

// ── Serialise (for persistence) ───────────────────────────────────────────────
// Snapshots can be large — keep only the last N for persist.

export function pruneStack(stack: CheckpointStack, maxPast = 20): CheckpointStack {
  return {
    past: stack.past.slice(-maxPast),
    future: stack.future.slice(0, 10),
  };
}
