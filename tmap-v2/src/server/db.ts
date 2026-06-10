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

// ── Supabase REST API (no SDK needed) ─────────────────────────────────────────
function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key };
  return null;
}

async function sbFetch(method: string, table: string, opts: {
  select?: string;
  filters?: Record<string, string>;
  body?: unknown;
  single?: boolean;
} = {}): Promise<unknown> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const params = new URLSearchParams();
  if (opts.select) params.set('select', opts.select);
  for (const [k, v] of Object.entries(opts.filters ?? {})) params.set(k, v);

  const qs = params.toString();
  const url = `${cfg.url}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': cfg.key,
    'Authorization': `Bearer ${cfg.key}`,
  };
  if (opts.single) headers['Accept'] = 'application/vnd.pgrst.object+json';
  if (method === 'POST') headers['Prefer'] = 'return=representation';
  if (method === 'PATCH') headers['Prefer'] = 'return=representation';

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 406 || res.status === 404) return null; // not found
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Map Supabase snake_case → TypeScript camelCase
function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as string,
    username: row.username as string,
    pinHash: row.pin_hash as string,
    encryptedKeys: (row.encrypted_keys ?? {}) as Partial<Record<ProviderKeyName, string>>,
    createdAt: row.created_at as string,
  };
}

// ── File-based storage (fallback when Supabase is not configured) ─────────────
const DB_PATH = process.env.AOF_DB_PATH
  ?? (process.env.VERCEL ? '/tmp/aof-db.json' : join(process.cwd(), '.aof-server', 'db.json'));

interface DbShape {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  agentLogs: AgentLogRecord[];
  costs: Record<string, CostRecord>;
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
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await sbFetch('GET', 'users', {
      filters: { 'username': `eq.${username.toLowerCase()}` },
      single: true,
    }) as Record<string, unknown> | null;
    return row ? rowToUser(row) : undefined;
  }
  return load().users[username.toLowerCase()];
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await sbFetch('GET', 'users', {
      filters: { 'id': `eq.${id}` },
      single: true,
    }) as Record<string, unknown> | null;
    return row ? rowToUser(row) : undefined;
  }
  return Object.values(load().users).find((u) => u.id === id);
}

export async function createUser(username: string, pinHash: string): Promise<UserRecord> {
  const cfg = supabaseConfig();
  if (cfg) {
    const existing = await findUserByUsername(username);
    if (existing) throw new Error('username already taken');
    const rows = await sbFetch('POST', 'users', {
      body: { username: username.toLowerCase(), pin_hash: pinHash, encrypted_keys: {} },
    }) as Record<string, unknown>[];
    return rowToUser(rows[0]);
  }

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
  const cfg = supabaseConfig();
  if (cfg) {
    const user = await findUserById(userId);
    if (!user) throw new Error('user not found');
    const updated = { ...user.encryptedKeys, [provider]: encrypted };
    await sbFetch('PATCH', 'users', {
      filters: { 'id': `eq.${userId}` },
      body: { encrypted_keys: updated },
    });
    return;
  }

  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  user.encryptedKeys[provider] = encrypted;
  save(db);
}

export async function deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
  const cfg = supabaseConfig();
  if (cfg) {
    const user = await findUserById(userId);
    if (!user) throw new Error('user not found');
    const updated = { ...user.encryptedKeys };
    delete updated[provider];
    await sbFetch('PATCH', 'users', {
      filters: { 'id': `eq.${userId}` },
      body: { encrypted_keys: updated },
    });
    return;
  }

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
