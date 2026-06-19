import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Blackboard, Mode, AgentEvent } from '../types.js';

// Vercel: /var/task is read-only; use /tmp instead.
const AOF_DIR = process.env.VERCEL ? '/tmp/.coagentix' : join(process.cwd(), '.coagentix');
const SESSIONS_DIR = join(AOF_DIR, 'sessions');

export function createBlackboard(task: string, mode: Mode, context = ''): Blackboard {
  return {
    sessionId: randomUUID(),
    task, mode, context,
    plan: [], planText: '',
    files: [],
    review: [], reviewText: '',
    validations: [],
    iterations: 0,
    log: [],
  };
}

export function logEvent(bb: Blackboard, ev: Omit<AgentEvent, 'ts'>): void {
  bb.log.push({ ts: Date.now(), ...ev });
}

/** Persist the working memory snapshot (Project Memory, TDD §5). */
export function persist(bb: Blackboard): string {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const path = join(SESSIONS_DIR, `${bb.sessionId}.json`);
  writeFileSync(path, JSON.stringify(bb, null, 2), 'utf8');
  return path;
}

export function loadSession(id: string): Blackboard | null {
  const path = join(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Blackboard;
}
