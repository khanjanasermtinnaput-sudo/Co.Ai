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
//
// Storage: Supabase (memories table) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are set — so memory survives serverless cold starts on Vercel. Otherwise a
// local JSON file per key. Supabase failures fall back to the file silently:
// memory is best-effort and must never break a run.

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

// ── Supabase backend (persists across serverless cold starts) ─────────────────
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function normalize(key: string, raw: Partial<ProjectMemory>): ProjectMemory {
  return {
    ...emptyMemory(key),
    ...raw,
    key: sanitizeKey(key),
    conventions: Array.isArray(raw.conventions) ? raw.conventions : [],
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    failures: Array.isArray(raw.failures) ? raw.failures : [],
  };
}

export async function loadMemory(key: string): Promise<ProjectMemory> {
  if (useSupabase) {
    try {
      const res = await sb(`memories?key=eq.${encodeURIComponent(sanitizeKey(key))}&select=data&limit=1`);
      if (res.ok) {
        const rows = (await res.json()) as Array<{ data: Partial<ProjectMemory> }>;
        if (rows[0]?.data) return normalize(key, rows[0].data);
        return emptyMemory(key);
      }
    } catch { /* fall through to file */ }
  }
  return loadMemoryFile(key);
}

function loadMemoryFile(key: string): ProjectMemory {
  const path = memoryPath(key);
  if (!existsSync(path)) return emptyMemory(key);
  try {
    return normalize(key, JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectMemory>);
  } catch {
    return emptyMemory(key);
  }
}

export async function saveMemory(mem: ProjectMemory): Promise<void> {
  mem.updatedAt = new Date().toISOString();
  if (useSupabase) {
    try {
      const res = await sb('memories', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: mem.key, data: mem, updated_at: mem.updatedAt }),
      });
      if (res.ok) return;
    } catch { /* fall through to file */ }
  }
  try {
    mkdirSync(memoryDir(), { recursive: true });
    writeFileSync(memoryPath(mem.key), JSON.stringify(mem, null, 2), 'utf8');
  } catch { /* non-fatal: memory degraded to in-session only (e.g. ENOSPC) */ }
}

export async function clearMemory(key: string): Promise<void> {
  if (useSupabase) {
    try {
      await sb(`memories?key=eq.${encodeURIComponent(sanitizeKey(key))}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
  }
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
export async function recordSessionMemory(
  key: string, entry: MemorySessionEntry, opts: RecordSessionOpts = {},
): Promise<ProjectMemory> {
  const mem = await loadMemory(key);

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

  await saveMemory(mem);
  return mem;
}

/** Add a free-form architecture decision note. */
export async function recordDecision(key: string, decision: string): Promise<ProjectMemory> {
  const mem = await loadMemory(key);
  mem.decisions = dedupe([...mem.decisions, decision.trim()]).slice(0, MAX_DECISIONS);
  await saveMemory(mem);
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
