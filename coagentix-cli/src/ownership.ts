// Code Ownership Awareness: track every file modification with agent, reason, timestamp, prompt

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { FileChange } from "./files.js";

const OWNERSHIP_FILE = join(process.cwd(), ".coai-ownership.json");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OwnershipEntry {
  file: string;
  op: FileChange["op"];
  agentAction: string;    // e.g. "fix", "refactor", "generate"
  userId: string;
  prompt: string;
  timestamp: string;
  checkpointId: string;
}

export interface OwnershipLedger {
  version: 1;
  entries: OwnershipEntry[];
}

// ── Read / Write ───────────────────────────────────────────────────────────────

function loadLedger(): OwnershipLedger {
  if (!existsSync(OWNERSHIP_FILE)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(OWNERSHIP_FILE, "utf8")) as OwnershipLedger;
  } catch {
    return { version: 1, entries: [] };
  }
}

function saveLedger(ledger: OwnershipLedger): void {
  writeFileSync(OWNERSHIP_FILE, JSON.stringify(ledger, null, 2), "utf8");
}

// ── Record Ownership ──────────────────────────────────────────────────────────

export function recordOwnership(
  changes: FileChange[],
  opts: {
    agentAction: string;
    userId: string;
    prompt: string;
    checkpointId: string;
  },
): void {
  const ledger = loadLedger();
  const ts = new Date().toISOString();

  for (const change of changes) {
    ledger.entries.push({
      file: change.path,
      op: change.op,
      agentAction: opts.agentAction,
      userId: opts.userId,
      prompt: opts.prompt.slice(0, 200),
      timestamp: ts,
      checkpointId: opts.checkpointId,
    });
  }

  // Keep last 1 000 entries
  if (ledger.entries.length > 1000) {
    ledger.entries = ledger.entries.slice(-1000);
  }

  saveLedger(ledger);
}

// ── Query ─────────────────────────────────────────────────────────────────────

export function getFileHistory(filePath: string): OwnershipEntry[] {
  const ledger = loadLedger();
  return ledger.entries
    .filter((e) => e.file === filePath)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getRecentChanges(limit = 20): OwnershipEntry[] {
  const ledger = loadLedger();
  return ledger.entries
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

export function getFileOwner(filePath: string): OwnershipEntry | null {
  const history = getFileHistory(filePath);
  return history[0] ?? null;
}

// ── Print ─────────────────────────────────────────────────────────────────────

export function printOwnershipHistory(entries: OwnershipEntry[]): void {

  if (entries.length === 0) {
    console.log(chalk.dim("  No ownership history found."));
    return;
  }

  console.log(chalk.bold(`\n  Change History (${entries.length} entries)`));
  console.log(chalk.dim("─".repeat(70)));

  for (const e of entries) {
    const ts     = chalk.dim(e.timestamp.replace("T", " ").slice(0, 19));
    const op     = e.op === "create" ? chalk.green(e.op.padEnd(7))
                 : e.op === "delete" ? chalk.red(e.op.padEnd(7))
                 : chalk.yellow(e.op.padEnd(7));
    const action = chalk.cyan(e.agentAction.padEnd(12));
    const file   = chalk.bold(e.file);
    const prompt = chalk.dim(e.prompt.slice(0, 60) + (e.prompt.length > 60 ? "…" : ""));
    console.log(`  ${ts}  ${op} ${action} ${file}`);
    console.log(`  ${" ".repeat(21)}${prompt}`);
  }
  console.log();
}
