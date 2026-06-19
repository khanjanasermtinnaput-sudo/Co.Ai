// Repository Protection Layer: patch generation, validation, checkpoint management
// AI never overwrites files directly — changes flow through: patch → validate → diff → approve → apply → checkpoint

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  copyFileSync, readdirSync, rmSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { FileChange } from "./files.js";

const CHECKPOINT_DIR = join(process.cwd(), ".coai-checkpoints");
const COAI_DIR       = join(homedir(), ".coai");

// ── Patch ──────────────────────────────────────────────────────────────────────

export interface Patch {
  id: string;
  createdAt: string;
  changes: FileChange[];
  prompt?: string;
  agentAction?: string;
}

export function generatePatch(
  changes: FileChange[],
  opts: { prompt?: string; agentAction?: string } = {},
): Patch {
  return {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    changes,
    prompt: opts.prompt,
    agentAction: opts.agentAction,
  };
}

// ── Patch Validation ───────────────────────────────────────────────────────────

export interface PatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePatch(root: string, patch: Patch): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const change of patch.changes) {
    // Block path traversal
    if (change.path.includes("..") || change.path.startsWith("/")) {
      errors.push(`Unsafe path: ${change.path}`);
      continue;
    }

    // Block sensitive paths
    const sensitive = [".env", ".git/", "node_modules/", "~/.coai", "~/.ssh", "~/.aws"];
    if (sensitive.some((s) => change.path.startsWith(s) || change.path.includes(s))) {
      errors.push(`Protected path: ${change.path}`);
      continue;
    }

    // Warn on deletions
    if (change.op === "delete") {
      warnings.push(`Deletion: ${change.path} — verify this is intentional`);
    }

    // Verify edit target exists
    if (change.op === "edit" && !existsSync(join(root, change.path))) {
      errors.push(`Edit target does not exist: ${change.path}`);
    }

    // Enforce content present for create/edit
    if ((change.op === "create" || change.op === "edit") && change.content === undefined) {
      errors.push(`No content provided for ${change.op}: ${change.path}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Checkpoint ─────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  createdAt: string;
  root: string;
  patch: Patch;
  files: string[]; // relative paths that were backed up
}

export function createCheckpoint(root: string, patch: Patch): Checkpoint {
  const id = new Date().toISOString().replace(/[:.]/g, "-") + "_" + patch.id;
  const snapDir = join(CHECKPOINT_DIR, id);
  mkdirSync(snapDir, { recursive: true });

  const backedUp: string[] = [];

  for (const change of patch.changes) {
    if (change.op === "create") continue;
    const abs = join(root, change.path);
    if (!existsSync(abs)) continue;
    const dest = join(snapDir, change.path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
    backedUp.push(change.path);
  }

  const checkpoint: Checkpoint = {
    id,
    createdAt: new Date().toISOString(),
    root,
    patch,
    files: backedUp,
  };

  writeFileSync(join(snapDir, "checkpoint.json"), JSON.stringify(checkpoint, null, 2));
  return checkpoint;
}

export function rollbackCheckpoint(checkpointId: string): void {
  const snapDir = join(CHECKPOINT_DIR, checkpointId);
  const metaPath = join(snapDir, "checkpoint.json");

  if (!existsSync(metaPath)) throw new Error(`Checkpoint not found: ${checkpointId}`);

  const cp = JSON.parse(readFileSync(metaPath, "utf8")) as Checkpoint;

  for (const change of cp.patch.changes) {
    const backed = join(snapDir, change.path);
    const target = join(cp.root, change.path);

    if (change.op === "create") {
      if (existsSync(target)) rmSync(target);
    } else if (existsSync(backed)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(backed, target);
    }
  }
}

export function listCheckpoints(): Checkpoint[] {
  if (!existsSync(CHECKPOINT_DIR)) return [];
  return readdirSync(CHECKPOINT_DIR)
    .map((name) => {
      const metaPath = join(CHECKPOINT_DIR, name, "checkpoint.json");
      if (!existsSync(metaPath)) return null;
      try { return JSON.parse(readFileSync(metaPath, "utf8")) as Checkpoint; }
      catch { return null; }
    })
    .filter((c): c is Checkpoint => c !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCheckpoint(id: string): Checkpoint | null {
  const snapDir = join(CHECKPOINT_DIR, id);
  const metaPath = join(snapDir, "checkpoint.json");
  if (!existsSync(metaPath)) return null;
  try { return JSON.parse(readFileSync(metaPath, "utf8")) as Checkpoint; }
  catch { return null; }
}
