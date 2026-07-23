// File operations: read, create, edit, delete, move, rename
// Every write goes through applyWithConfirm (see apply.ts), which checkpoints
// before applying and auto-rolls-back on a failed build — a strictly
// stronger safety net than a plain pre-change file backup, so this module
// doesn't need its own snapshot/rollback pair.

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  renameSync, rmSync, readdirSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";

export interface FileChange {
  op: "create" | "edit" | "delete" | "rename" | "move";
  path: string;     // relative to repo root
  newPath?: string; // for rename/move
  content?: string; // for create/edit
  oldContent?: string;
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
