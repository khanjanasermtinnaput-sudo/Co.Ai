// Background Task Engine: long-running tasks survive terminal close, user can reconnect

import {
  writeFileSync, readFileSync, mkdirSync, existsSync,
  readdirSync, unlinkSync, openSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const TASKS_DIR = join(homedir(), ".coai", "tasks");

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface BackgroundTask {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pid?: number;
  outputFile: string;
  error?: string;
  label: string;
}

// ── Task Store ─────────────────────────────────────────────────────────────────

function taskPath(id: string): string {
  return join(TASKS_DIR, `${id}.json`);
}

function outputPath(id: string): string {
  return join(TASKS_DIR, `${id}.out`);
}

export function saveTask(task: BackgroundTask): void {
  mkdirSync(TASKS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
}

export function loadTask(id: string): BackgroundTask | null {
  const p = taskPath(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as BackgroundTask; }
  catch { return null; }
}

export function listTasks(): BackgroundTask[] {
  if (!existsSync(TASKS_DIR)) return [];
  return readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(TASKS_DIR, f), "utf8")) as BackgroundTask; }
      catch { return null; }
    })
    .filter((t): t is BackgroundTask => t !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteTask(id: string): void {
  const tp = taskPath(id);
  const op = outputPath(id);
  if (existsSync(tp)) unlinkSync(tp);
  if (existsSync(op)) unlinkSync(op);
}

// ── Launch Background Task ─────────────────────────────────────────────────────

export function launchBackgroundTask(
  label: string,
  command: string,
  args: string[],
  cwd: string,
): BackgroundTask {
  const id = randomUUID().slice(0, 8);
  const outFile = outputPath(id);

  const task: BackgroundTask = {
    id,
    label,
    command,
    args,
    cwd,
    status: "pending",
    createdAt: new Date().toISOString(),
    outputFile: outFile,
  };

  saveTask(task);

  // Spawn detached process
  const out = openSync(outFile, "w");
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
  });

  task.status    = "running";
  task.startedAt = new Date().toISOString();
  task.pid       = child.pid;
  saveTask(task);

  child.unref(); // allow parent to exit

  child.on("close", (code) => {
    const t = loadTask(id);
    if (!t) return;
    t.status      = code === 0 ? "completed" : "failed";
    t.completedAt = new Date().toISOString();
    if (code !== 0) t.error = `Exited with code ${code}`;
    saveTask(t);
  });

  return task;
}

// ── Read Task Output ───────────────────────────────────────────────────────────

export function readTaskOutput(id: string, tail = 100): string {
  const op = outputPath(id);
  if (!existsSync(op)) return "(no output yet)";
  try {
    const content = readFileSync(op, "utf8");
    const lines   = content.split("\n");
    return lines.slice(-tail).join("\n");
  } catch {
    return "(output unavailable)";
  }
}

// ── Cancel Task ────────────────────────────────────────────────────────────────

export function cancelTask(id: string): boolean {
  const task = loadTask(id);
  if (!task || task.status !== "running" || !task.pid) return false;
  try {
    process.kill(task.pid, "SIGTERM");
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    saveTask(task);
    return true;
  } catch {
    return false;
  }
}
