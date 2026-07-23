// File operations: read, create, edit, delete, move, rename
// Every write operation creates a backup snapshot first.

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  copyFileSync, renameSync, rmSync, readdirSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { randomUUID } from "node:crypto";

export interface FileChange {
  op: "create" | "edit" | "delete" | "rename" | "move";
  path: string;     // relative to repo root
  newPath?: string; // for rename/move
  content?: string; // for create/edit
  oldContent?: string;
}

const SNAPSHOT_DIR = join(process.cwd(), ".coai-snapshots");

function snapshotId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-") + "_" + randomUUID().slice(0, 8);
}

/** Backup affected files before making changes. Returns snapshot ID for rollback. */
export function createSnapshot(root: string, changes: FileChange[]): string {
  const id = snapshotId();
  const snapDir = join(SNAPSHOT_DIR, id);

  for (const change of changes) {
    if (change.op === "create") continue; // nothing to back up
    const abs = join(root, change.path);
    if (!existsSync(abs)) continue;
    const dest = join(snapDir, change.path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
  }

  // Write manifest so rollback knows what to restore.
  const manifest = { id, root, changes, createdAt: new Date().toISOString() };
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return id;
}

/** Rollback a snapshot: restore original files. */
export function rollbackSnapshot(snapshotId: string): void {
  const snapDir = join(SNAPSHOT_DIR, snapshotId);
  const manifestPath = join(snapDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    root: string;
    changes: FileChange[];
  };

  for (const change of manifest.changes) {
    const originalBackup = join(snapDir, change.path);
    const targetAbs = join(manifest.root, change.path);

    if (change.op === "create") {
      // Undo the create — delete the new file.
      if (existsSync(targetAbs)) rmSync(targetAbs);
    } else if (existsSync(originalBackup)) {
      // Restore the backed-up original.
      mkdirSync(dirname(targetAbs), { recursive: true });
      copyFileSync(originalBackup, targetAbs);
    }
  }
}

/** Apply a set of file changes to the repo. */
export function applyChanges(root: string, changes: FileChange[]): void {
  for (const change of changes) {
    const abs = join(root, change.path);

    switch (change.op) {
      case "create":
      case "edit": {
        if (change.content === undefined) throw new Error(`No content for ${change.path}`);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, change.content, "utf8");
        break;
      }
      case "delete": {
        if (existsSync(abs)) rmSync(abs);
        break;
      }
      case "rename":
      case "move": {
        if (!change.newPath) throw new Error(`newPath required for ${change.op}`);
        const newAbs = join(root, change.newPath);
        mkdirSync(dirname(newAbs), { recursive: true });
        renameSync(abs, newAbs);
        break;
      }
    }
  }
}

export function fileExists(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

export function readFileContent(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

export function listDir(root: string, rel = "."): string[] {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).map((f) => relative(root, join(abs, f)));
}

/** Parse AI-generated fenced code blocks into FileChange[] */
export function parseCodeBlocks(raw: string, root: string): FileChange[] {
  const changes: FileChange[] = [];
  // Match ```lang\n// path: foo/bar.ts\n<content>\n```
  const blockRe = /```[\w]*\n(?:\/\/\s*(?:path|file):\s*(.+?)\n)([\s\S]*?)```/gm;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw)) !== null) {
    const [, pathLine, content] = m;
    const relPath = pathLine.trim();
    if (!relPath) continue;
    const op = existsSync(join(root, relPath)) ? "edit" : "create";
    changes.push({ op, path: relPath, content: content.trimEnd() + "\n" });
  }
  return changes;
}
