import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ProviderKeyName = 'openrouter' | 'gemini' | 'deepseek' | 'qwen' | 'llama';

export interface UserRecord {
  id: string;
  username: string;
  pinHash: string;
  encryptedKeys: Partial<Record<ProviderKeyName, string>>;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  task: string;
  mode: string;
  status: 'running' | 'done' | 'error';
  filesCount: number;
  iterations: number;
  costUsd: number;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

export interface AgentLogRecord {
  id: string;
  sessionId: string;
  role: string;
  provider: string;
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  ts: string;
}

export interface CostRecord {
  userId: string;
  totalCostUsd: number;
  totalTokens: number;
  sessionCount: number;
  updatedAt: string;
}

// ── File-based storage (persistent JSON, no 500MB limit) ──────────────────────
// Vercel ephemeral /tmp is OK for demo; for self-hosted this persists across restarts.
const DB_PATH = process.env.AOF_DB_PATH
  ?? (process.env.VERCEL ? '/tmp/aof-db.json' : join(process.cwd(), '.aof-server', 'db.json'));

interface DbShape {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  agentLogs: AgentLogRecord[];
  costs: Record<string, CostRecord>; // userId -> cost
}

function load(): DbShape {
  if (!existsSync(DB_PATH)) return { users: {}, sessions: {}, agentLogs: [], costs: {} };
  try {
    return JSON.parse(readFileSync(DB_PATH, 'utf8')) as DbShape;
  } catch {
    return { users: {}, sessions: {}, agentLogs: [], costs: {} };
  }
}

function save(db: DbShape): void {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ── USER ──────────────────────────────────────────────────────────────────────
export async function findUserByUsername(username: string): Promise<UserRecord | undefined> {
  return load().users[username.toLowerCase()];
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  return Object.values(load().users).find((u) => u.id === id);
}

export async function createUser(username: string, pinHash: string): Promise<UserRecord> {
  const db = load();
  const key = username.toLowerCase();
  if (db.users[key]) throw new Error('username already taken');
  const user: UserRecord = {
    id: randomUUID(), username: key, pinHash,
    encryptedKeys: {}, createdAt: new Date().toISOString(),
  };
  db.users[key] = user;
  save(db);
  return user;
}

export async function setUserKey(userId: string, provider: ProviderKeyName, encrypted: string): Promise<void> {
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  user.encryptedKeys[provider] = encrypted;
  save(db);
}

export async function deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  delete user.encryptedKeys[provider];
  save(db);
}

// ── SESSIONS ─────────────────────────────────────────────────────────────────
export async function createSession(userId: string, task: string, mode: string): Promise<SessionRecord> {
  const db = load();
  const session: SessionRecord = {
    id: randomUUID(), userId, task, mode,
    status: 'running',
    filesCount: 0, iterations: 0, costUsd: 0, tokensUsed: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.sessions[session.id] = session;
  save(db);
  return session;
}

export async function updateSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
  const db = load();
  if (!db.sessions[id]) return;
  Object.assign(db.sessions[id], patch, { updatedAt: new Date().toISOString() });
  save(db);
}

export async function getUserSessions(userId: string, limit = 20): Promise<SessionRecord[]> {
  const db = load();
  return Object.values(db.sessions)
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return load().sessions[id];
}

// ── AGENT LOGS ────────────────────────────────────────────────────────────────
export async function appendAgentLog(log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void> {
  const db = load();
  db.agentLogs.push({ id: randomUUID(), ts: new Date().toISOString(), ...log });
  // keep last 5000 entries to avoid unbounded growth
  if (db.agentLogs.length > 5000) db.agentLogs = db.agentLogs.slice(-5000);
  save(db);
}

export async function getSessionLogs(sessionId: string): Promise<AgentLogRecord[]> {
  return load().agentLogs.filter((l) => l.sessionId === sessionId);
}

// ── COST TRACKING ─────────────────────────────────────────────────────────────
export async function addCost(userId: string, tokens: number, costUsd: number): Promise<void> {
  const db = load();
  const existing = db.costs[userId] ?? { userId, totalCostUsd: 0, totalTokens: 0, sessionCount: 0, updatedAt: '' };
  existing.totalCostUsd = Math.round((existing.totalCostUsd + costUsd) * 1e8) / 1e8;
  existing.totalTokens += tokens;
  existing.sessionCount += 1;
  existing.updatedAt = new Date().toISOString();
  db.costs[userId] = existing;
  save(db);
}

export async function getUserCost(userId: string): Promise<CostRecord | undefined> {
  return load().costs[userId];
}
