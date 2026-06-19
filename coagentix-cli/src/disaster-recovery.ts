// Disaster Recovery: session recovery, workspace recovery, checkpoint recovery

import {
  writeFileSync, readFileSync, mkdirSync, existsSync,
  readdirSync, copyFileSync, rmSync, statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { globSync } from "glob";
import chalk from "chalk";
import { listCheckpoints, type Checkpoint } from "./patch.js";

const RECOVERY_DIR = join(homedir(), ".coai", "recovery");
const SESSION_FILE = join(homedir(), ".coai", "session.json");

// ── Session Recovery ───────────────────────────────────────────────────────────

export interface SessionState {
  id: string;
  savedAt: string;
  cwd: string;
  history: Array<{ command: string; ts: string; result: "ok" | "error" }>;
  pendingChanges?: string;  // serialized FileChange[] waiting for approval
}

export function saveSession(state: Partial<SessionState>): void {
  mkdirSync(dirname(SESSION_FILE), { recursive: true, mode: 0o700 });
  const existing = loadSession() ?? { id: randomUUID().slice(0, 8), history: [], cwd: process.cwd() };
  const merged: SessionState = {
    ...existing,
    ...state,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(merged, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function loadSession(): SessionState | null {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as SessionState; }
  catch { return null; }
}

export function appendSessionHistory(command: string, result: "ok" | "error"): void {
  const session = loadSession();
  if (!session) return;
  session.history.push({ command, ts: new Date().toISOString(), result });
  // Keep last 100 commands
  if (session.history.length > 100) session.history = session.history.slice(-100);
  saveSession(session);
}

export function clearSession(): void {
  if (existsSync(SESSION_FILE)) rmSync(SESSION_FILE);
}

// ── Workspace Snapshot ─────────────────────────────────────────────────────────

export interface WorkspaceSnapshot {
  id: string;
  createdAt: string;
  root: string;
  label: string;
  files: string[];   // relative paths snapshotted
}

export function snapshotWorkspace(root: string, label: string, patterns?: string[]): WorkspaceSnapshot {
  const id      = new Date().toISOString().replace(/[:.]/g, "-") + "_" + randomUUID().slice(0, 6);
  const snapDir = join(RECOVERY_DIR, "workspaces", id);
  mkdirSync(snapDir, { recursive: true });

  const defaultPatterns = [
    "src/**/*",
    "app/**/*",
    "pages/**/*",
    "lib/**/*",
    "*.config.*",
    "package.json",
    "tsconfig.json",
  ];

  const filePaths: string[] = globSync(patterns ?? defaultPatterns, {
    cwd: root,
    ignore: ["node_modules/**", ".next/**", "dist/**", "build/**", ".git/**"],
    absolute: false,
  });

  const snapshotted: string[] = [];
  for (const rel of filePaths) {
    const src  = join(root, rel);
    const dest = join(snapDir, rel);
    try {
      if (statSync(src).isFile()) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        snapshotted.push(rel);
      }
    } catch { /* ignore individual file errors */ }
  }

  const ws: WorkspaceSnapshot = {
    id,
    createdAt: new Date().toISOString(),
    root,
    label,
    files: snapshotted,
  };

  writeFileSync(join(snapDir, "workspace.json"), JSON.stringify(ws, null, 2));
  return ws;
}

export function restoreWorkspace(snapshotId: string, root: string): void {
  const snapDir  = join(RECOVERY_DIR, "workspaces", snapshotId);
  const metaPath = join(snapDir, "workspace.json");

  if (!existsSync(metaPath)) throw new Error(`Workspace snapshot not found: ${snapshotId}`);
  const ws = JSON.parse(readFileSync(metaPath, "utf8")) as WorkspaceSnapshot;

  for (const rel of ws.files) {
    const src  = join(snapDir, rel);
    const dest = join(root, rel);
    if (existsSync(src)) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
}

export function listWorkspaceSnapshots(): WorkspaceSnapshot[] {
  const dir = join(RECOVERY_DIR, "workspaces");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => {
      const mp = join(dir, name, "workspace.json");
      if (!existsSync(mp)) return null;
      try { return JSON.parse(readFileSync(mp, "utf8")) as WorkspaceSnapshot; }
      catch { return null; }
    })
    .filter((w): w is WorkspaceSnapshot => w !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Recovery Summary ───────────────────────────────────────────────────────────

export interface RecoverySummary {
  session: SessionState | null;
  checkpoints: Checkpoint[];
  workspaceSnapshots: WorkspaceSnapshot[];
}

export function getRecoverySummary(): RecoverySummary {
  return {
    session:            loadSession(),
    checkpoints:        listCheckpoints().slice(0, 10),
    workspaceSnapshots: listWorkspaceSnapshots().slice(0, 10),
  };
}

// ── Print ─────────────────────────────────────────────────────────────────────

export function printRecoverySummary(summary: RecoverySummary): void {
  console.log(chalk.bold("\n  Disaster Recovery Status"));
  console.log(chalk.dim("─".repeat(60)));

  // Session
  if (summary.session) {
    console.log(chalk.bold("\n  Last Session"));
    console.log(`  ID:      ${chalk.dim(summary.session.id)}`);
    console.log(`  Saved:   ${chalk.dim(summary.session.savedAt.replace("T", " ").slice(0, 19))}`);
    console.log(`  Dir:     ${chalk.dim(summary.session.cwd)}`);
    console.log(`  History: ${chalk.dim(summary.session.history.length + " commands")}`);
  } else {
    console.log(chalk.dim("\n  No saved session."));
  }

  // Checkpoints
  if (summary.checkpoints.length > 0) {
    console.log(chalk.bold("\n  Checkpoints (most recent)"));
    for (const cp of summary.checkpoints.slice(0, 5)) {
      const ts = chalk.dim(cp.createdAt.replace("T", " ").slice(0, 19));
      console.log(`  ${ts}  ${chalk.dim(cp.id)}  ${chalk.bold(cp.patch.changes.length + " file(s)")}`);
    }
    console.log(chalk.dim(`  Total: ${summary.checkpoints.length}  →  coai checkpoint`));
  }

  // Workspace snapshots
  if (summary.workspaceSnapshots.length > 0) {
    console.log(chalk.bold("\n  Workspace Snapshots"));
    for (const ws of summary.workspaceSnapshots.slice(0, 5)) {
      const ts = chalk.dim(ws.createdAt.replace("T", " ").slice(0, 19));
      console.log(`  ${ts}  ${chalk.cyan(ws.label.slice(0, 30))}  ${chalk.dim(ws.id)}`);
    }
  }

  console.log(chalk.dim("\n  coai recover --help  for recovery options\n"));
}
