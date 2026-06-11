// Persistent Memory Layer — cross-session project memory (TDD §5 "Memory layers").
//
// Remembers, per user (web) or per project root (CLI):
//   - tech stack last seen
//   - detected coding conventions
//   - architecture decisions (free-form notes agents/users can add)
//   - summaries of recent sessions (task, files produced, outcome)
//
// Injected into the Blackboard context at run start so the Planner knows what
// was built before, instead of treating every session as the first one.

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface MemorySessionEntry {
  task: string;
  status: 'done' | 'error';
  files: string[];
  iterations: number;
  at: string;
}

export interface FailureEntry {
  task: string;
  problem: string;
  at: string;
}

export interface ProjectMemory {
  key: string;
  techStack?: string;
  conventions: string[];
  decisions: string[];
  sessions: MemorySessionEntry[];
  failures: FailureEntry[];
  updatedAt: string;
}

const MAX_SESSIONS = 10;
const MAX_CONVENTIONS = 12;
const MAX_DECISIONS = 20;
const MAX_FAILURES = 15;

function memoryDir(): string {
  return process.env.AOF_MEMORY_DIR
    ?? (process.env.VERCEL ? '/tmp/aof-memory' : join(process.cwd(), '.aof-server', 'memory'));
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default';
}

function memoryPath(key: string): string {
  return join(memoryDir(), sanitizeKey(key) + '.json');
}

export function emptyMemory(key: string): ProjectMemory {
  return { key: sanitizeKey(key), conventions: [], decisions: [], sessions: [], failures: [], updatedAt: '' };
}

export function loadMemory(key: string): ProjectMemory {
  const path = memoryPath(key);
  if (!existsSync(path)) return emptyMemory(key);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectMemory>;
    return {
      ...emptyMemory(key),
      ...raw,
      conventions: Array.isArray(raw.conventions) ? raw.conventions : [],
      decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      failures: Array.isArray(raw.failures) ? raw.failures : [],
    };
  } catch {
    return emptyMemory(key);
  }
}

export function saveMemory(mem: ProjectMemory): void {
  mkdirSync(memoryDir(), { recursive: true });
  mem.updatedAt = new Date().toISOString();
  writeFileSync(memoryPath(mem.key), JSON.stringify(mem, null, 2), 'utf8');
}

export function clearMemory(key: string): void {
  const path = memoryPath(key);
  if (existsSync(path)) unlinkSync(path);
}

export interface RecordSessionOpts {
  techStack?: string;
  conventions?: string[];
  decisions?: string[];
  failures?: string[];
}

/** Append a finished session to memory (newest first, capped). */
export function recordSessionMemory(
  key: string, entry: MemorySessionEntry, opts: RecordSessionOpts = {},
): ProjectMemory {
  const mem = loadMemory(key);

  mem.sessions.unshift(entry);
  if (mem.sessions.length > MAX_SESSIONS) mem.sessions.length = MAX_SESSIONS;

  if (opts.techStack) mem.techStack = opts.techStack;
  if (opts.conventions?.length) {
    mem.conventions = dedupe([...opts.conventions, ...mem.conventions]).slice(0, MAX_CONVENTIONS);
  }
  if (opts.decisions?.length) {
    mem.decisions = dedupe([...mem.decisions, ...opts.decisions]).slice(0, MAX_DECISIONS);
  }
  if (opts.failures?.length) {
    const fresh: FailureEntry[] = dedupe(opts.failures).map((problem) => ({ task: entry.task, problem, at: entry.at }));
    const seen = new Set<string>();
    mem.failures = [...fresh, ...mem.failures]
      .filter((f) => (seen.has(f.problem) ? false : (seen.add(f.problem), true)))
      .slice(0, MAX_FAILURES);
  }

  saveMemory(mem);
  return mem;
}

/** Add a free-form architecture decision note. */
export function recordDecision(key: string, decision: string): ProjectMemory {
  const mem = loadMemory(key);
  mem.decisions = dedupe([...mem.decisions, decision.trim()]).slice(0, MAX_DECISIONS);
  saveMemory(mem);
  return mem;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

/** Render memory as a context block for the Planner. Empty string when nothing useful. */
export function memoryToContext(mem: ProjectMemory): string {
  const hasContent = mem.sessions.length || mem.decisions.length || mem.conventions.length
    || mem.techStack || mem.failures.length;
  if (!hasContent) return '';

  const lines: string[] = ['## Project Memory (from previous sessions)'];
  if (mem.techStack) lines.push(`Tech stack: ${mem.techStack}`);
  if (mem.conventions.length) lines.push(`Conventions: ${mem.conventions.join(' · ')}`);
  if (mem.decisions.length) {
    lines.push('Architecture decisions:');
    for (const d of mem.decisions.slice(0, 8)) lines.push(`- ${d}`);
  }
  if (mem.failures.length) {
    lines.push('Known failure patterns to avoid (do NOT repeat these):');
    for (const f of mem.failures.slice(0, 8)) lines.push(`- ${f.problem}`);
  }
  if (mem.sessions.length) {
    lines.push(`Recent sessions (${mem.sessions.length}):`);
    for (const s of mem.sessions.slice(0, 5)) {
      const files = s.files.slice(0, 6).join(', ') + (s.files.length > 6 ? ', …' : '');
      lines.push(`- [${s.status}] ${s.task}${files ? ` → ${files}` : ''}`);
    }
  }
  lines.push('Stay consistent with the stack, conventions and decisions above. Extend previously generated files instead of recreating them.');
  return lines.join('\n');
}
