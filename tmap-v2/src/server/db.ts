import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from './supabase.js';

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

// ── Row mappers (snake_case DB columns <-> camelCase records) ──────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToUser(r: any): UserRecord {
  return {
    id: r.id,
    username: r.username,
    pinHash: r.pin_hash,
    encryptedKeys: r.encrypted_keys ?? {},
    createdAt: r.created_at,
  };
}

function rowToSession(r: any): SessionRecord {
  return {
    id: r.id,
    userId: r.user_id,
    task: r.task,
    mode: r.mode,
    status: r.status,
    filesCount: r.files_count ?? 0,
    iterations: r.iterations ?? 0,
    costUsd: Number(r.cost_usd ?? 0),
    tokensUsed: Number(r.tokens_used ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    summary: r.summary ?? undefined,
  };
}

function rowToLog(r: any): AgentLogRecord {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    provider: r.provider,
    model: r.model,
    attempts: r.attempts ?? 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    costUsd: Number(r.cost_usd ?? 0),
    durationMs: r.duration_ms ?? 0,
    ts: r.ts,
  };
}

function rowToCost(r: any): CostRecord {
  return {
    userId: r.user_id,
    totalCostUsd: Number(r.total_cost_usd ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    sessionCount: r.session_count ?? 0,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── File-based storage (fallback when Supabase is not configured) ─────────────
// Vercel ephemeral /tmp is OK only for demo; data is wiped on cold starts.
// Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for persistent storage.
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
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('users').select('*').eq('username', username.toLowerCase()).maybeSingle();
    if (error) throw new Error(`supabase findUserByUsername: ${error.message}`);
    return data ? rowToUser(data) : undefined;
  }
  return load().users[username.toLowerCase()];
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`supabase findUserById: ${error.message}`);
    return data ? rowToUser(data) : undefined;
  }
  return Object.values(load().users).find((u) => u.id === id);
}

export async function createUser(username: string, pinHash: string): Promise<UserRecord> {
  const key = username.toLowerCase();
  const sb = getSupabase();
  if (sb) {
    const existing = await findUserByUsername(key);
    if (existing) throw new Error('username already taken');
    const { data, error } = await sb
      .from('users')
      .insert({ username: key, pin_hash: pinHash, encrypted_keys: {} })
      .select('*')
      .single();
    if (error) throw new Error(`supabase createUser: ${error.message}`);
    return rowToUser(data);
  }
  const db = load();
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
  const sb = getSupabase();
  if (sb) {
    const user = await findUserById(userId);
    if (!user) throw new Error('user not found');
    const encryptedKeys = { ...user.encryptedKeys, [provider]: encrypted };
    const { error } = await sb.from('users').update({ encrypted_keys: encryptedKeys }).eq('id', userId);
    if (error) throw new Error(`supabase setUserKey: ${error.message}`);
    return;
  }
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  user.encryptedKeys[provider] = encrypted;
  save(db);
}

export async function deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const user = await findUserById(userId);
    if (!user) throw new Error('user not found');
    const encryptedKeys = { ...user.encryptedKeys };
    delete encryptedKeys[provider];
    const { error } = await sb.from('users').update({ encrypted_keys: encryptedKeys }).eq('id', userId);
    if (error) throw new Error(`supabase deleteUserKey: ${error.message}`);
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
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('sessions')
      .insert({ user_id: userId, task, mode, status: 'running' })
      .select('*')
      .single();
    if (error) throw new Error(`supabase createSession: ${error.message}`);
    return rowToSession(data);
  }
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
  const sb = getSupabase();
  if (sb) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.filesCount !== undefined) row.files_count = patch.filesCount;
    if (patch.iterations !== undefined) row.iterations = patch.iterations;
    if (patch.costUsd !== undefined) row.cost_usd = patch.costUsd;
    if (patch.tokensUsed !== undefined) row.tokens_used = patch.tokensUsed;
    if (patch.summary !== undefined) row.summary = patch.summary;
    const { error } = await sb.from('sessions').update(row).eq('id', id);
    if (error) throw new Error(`supabase updateSession: ${error.message}`);
    return;
  }
  const db = load();
  if (!db.sessions[id]) return;
  Object.assign(db.sessions[id], patch, { updatedAt: new Date().toISOString() });
  save(db);
}

export async function getUserSessions(userId: string, limit = 20): Promise<SessionRecord[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('sessions').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`supabase getUserSessions: ${error.message}`);
    return (data ?? []).map(rowToSession);
  }
  const db = load();
  return Object.values(db.sessions)
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`supabase getSession: ${error.message}`);
    return data ? rowToSession(data) : undefined;
  }
  return load().sessions[id];
}

// ── AGENT LOGS ────────────────────────────────────────────────────────────────
export async function appendAgentLog(log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from('agent_logs').insert({
      session_id: log.sessionId,
      role: log.role,
      provider: log.provider,
      model: log.model,
      attempts: log.attempts,
      input_tokens: log.inputTokens,
      output_tokens: log.outputTokens,
      cost_usd: log.costUsd,
      duration_ms: log.durationMs,
    });
    if (error) throw new Error(`supabase appendAgentLog: ${error.message}`);
    return;
  }
  const db = load();
  db.agentLogs.push({ id: randomUUID(), ts: new Date().toISOString(), ...log });
  // keep last 5000 entries to avoid unbounded growth
  if (db.agentLogs.length > 5000) db.agentLogs = db.agentLogs.slice(-5000);
  save(db);
}

export async function getSessionLogs(sessionId: string): Promise<AgentLogRecord[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('agent_logs').select('*')
      .eq('session_id', sessionId)
      .order('ts', { ascending: true });
    if (error) throw new Error(`supabase getSessionLogs: ${error.message}`);
    return (data ?? []).map(rowToLog);
  }
  return load().agentLogs.filter((l) => l.sessionId === sessionId);
}

// ── COST TRACKING ─────────────────────────────────────────────────────────────
export async function addCost(userId: string, tokens: number, costUsd: number): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const current = await getUserCost(userId);
    const next: CostRecord = {
      userId,
      totalCostUsd: Math.round(((current?.totalCostUsd ?? 0) + costUsd) * 1e8) / 1e8,
      totalTokens: (current?.totalTokens ?? 0) + tokens,
      sessionCount: (current?.sessionCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const { error } = await sb.from('costs').upsert({
      user_id: next.userId,
      total_cost_usd: next.totalCostUsd,
      total_tokens: next.totalTokens,
      session_count: next.sessionCount,
      updated_at: next.updatedAt,
    });
    if (error) throw new Error(`supabase addCost: ${error.message}`);
    return;
  }
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
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('costs').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(`supabase getUserCost: ${error.message}`);
    return data ? rowToCost(data) : undefined;
  }
  return load().costs[userId];
}
