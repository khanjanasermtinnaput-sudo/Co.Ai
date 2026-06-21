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

// ── Supabase (persistent Postgres via PostgREST) ──────────────────────────────
// When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, user accounts and their
// encrypted API keys are stored in Postgres so they survive across requests and
// serverless cold starts. Without it, we fall back to the JSON file below — which
// on Vercel lives in the ephemeral /tmp and is wiped between invocations, so every
// visit would require re-creating the account.
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

interface SupabaseUserRow {
  id: string;
  username: string;
  pin_hash: string;
  encrypted_keys: Partial<Record<ProviderKeyName, string>> | null;
  created_at: string;
}

function rowToUser(row: SupabaseUserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    pinHash: row.pin_hash,
    encryptedKeys: row.encrypted_keys ?? {},
    createdAt: row.created_at,
  };
}

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return res;
}

const PROVIDER_KEY_NAMES: ProviderKeyName[] = ['openrouter', 'gemini', 'deepseek', 'qwen', 'llama'];

/**
 * Load a Supabase-auth user's provider keys from the shared `provider_keys` table
 * (written by aof-web's /api/keys). Returns provider → ciphertext, in the same
 * `encryptedKeys` shape as a tmap UserRecord so the existing endpoints can decrypt
 * them with the shared COAGENTIX_MASTER_KEY. Empty when Supabase is unconfigured
 * or the user has no keys. Never throws.
 */
export async function loadProviderKeysFromSupabase(
  userId: string,
): Promise<Partial<Record<ProviderKeyName, string>>> {
  if (!useSupabase) return {};
  try {
    const res = await sb(
      `provider_keys?user_id=eq.${encodeURIComponent(userId)}&select=provider,encrypted_key`,
    );
    if (!res.ok) return {};
    const rows = (await res.json()) as Array<{ provider: string; encrypted_key: string }>;
    const out: Partial<Record<ProviderKeyName, string>> = {};
    for (const r of rows) {
      if ((PROVIDER_KEY_NAMES as string[]).includes(r.provider) && r.encrypted_key) {
        out[r.provider as ProviderKeyName] = r.encrypted_key;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ── File-based storage (fallback for local/dev) ───────────────────────────────
const DB_PATH = process.env.AOF_DB_PATH
  ?? (process.env.VERCEL ? '/tmp/aof-db.json' : join(process.cwd(), '.aof-server', 'db.json'));

// In production the file store lives on ephemeral disk (e.g. Vercel/Render free
// /tmp) and is wiped on every redeploy/cold start — user accounts and their
// encrypted API keys would silently vanish. Warn loudly so durable storage
// (Supabase) is configured before relying on persistence.
if (!useSupabase && process.env.NODE_ENV === 'production') {
  console.warn(
    '[AOF][WARN] Supabase is NOT configured in production — falling back to the ephemeral ' +
    `file DB at ${DB_PATH}. User accounts & encrypted keys will be LOST on redeploy/cold start. ` +
    'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for durable storage.',
  );
}

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
  const key = username.toLowerCase();
  if (useSupabase) {
    const res = await sb(`users?username=eq.${encodeURIComponent(key)}&select=*&limit=1`);
    if (!res.ok) throw new Error(`supabase findUserByUsername failed: ${res.status}`);
    const rows = (await res.json()) as SupabaseUserRow[];
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  return load().users[key];
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  if (useSupabase) {
    const res = await sb(`users?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    if (!res.ok) throw new Error(`supabase findUserById failed: ${res.status}`);
    const rows = (await res.json()) as SupabaseUserRow[];
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  return Object.values(load().users).find((u) => u.id === id);
}

export async function createUser(username: string, pinHash: string): Promise<UserRecord> {
  const key = username.toLowerCase();
  if (useSupabase) {
    const res = await sb('users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ username: key, pin_hash: pinHash, encrypted_keys: {} }),
    });
    if (res.status === 409) throw new Error('username already taken');
    if (!res.ok) throw new Error(`supabase createUser failed: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as SupabaseUserRow[];
    if (!rows[0]) throw new Error('supabase createUser: empty response');
    return rowToUser(rows[0]);
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
  if (useSupabase) {
    const current = await findUserById(userId);
    if (!current) throw new Error('user not found');
    const encryptedKeys = { ...current.encryptedKeys, [provider]: encrypted };
    const res = await sb(`users?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ encrypted_keys: encryptedKeys }),
    });
    if (!res.ok) throw new Error(`supabase setUserKey failed: ${res.status}`);
    return;
  }
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  user.encryptedKeys[provider] = encrypted;
  save(db);
}

export async function deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
  if (useSupabase) {
    const current = await findUserById(userId);
    if (!current) throw new Error('user not found');
    const encryptedKeys = { ...current.encryptedKeys };
    delete encryptedKeys[provider];
    const res = await sb(`users?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ encrypted_keys: encryptedKeys }),
    });
    if (!res.ok) throw new Error(`supabase deleteUserKey failed: ${res.status}`);
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
  const now = new Date().toISOString();
  const session: SessionRecord = {
    id: randomUUID(), userId, task, mode,
    status: 'running',
    filesCount: 0, iterations: 0, costUsd: 0, tokensUsed: 0,
    createdAt: now, updatedAt: now,
  };

  if (useSupabase) {
    await sb('tmap_sessions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: session.id, user_id: userId, task, mode,
        status: 'running', files_count: 0, iterations: 0,
        cost_usd: 0, tokens_used: 0,
        created_at: now, updated_at: now,
      }),
    });
    return session;
  }

  const db = load();
  db.sessions[session.id] = session;
  save(db);
  return session;
}

export async function updateSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
  const now = new Date().toISOString();

  if (useSupabase) {
    const row: Record<string, unknown> = { updated_at: now };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.filesCount !== undefined) row.files_count = patch.filesCount;
    if (patch.iterations !== undefined) row.iterations = patch.iterations;
    if (patch.costUsd !== undefined) row.cost_usd = patch.costUsd;
    if (patch.tokensUsed !== undefined) row.tokens_used = patch.tokensUsed;
    if (patch.summary !== undefined) row.summary = patch.summary;
    await sb(`tmap_sessions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(row),
    });
    return;
  }

  const db = load();
  if (!db.sessions[id]) return;
  Object.assign(db.sessions[id], patch, { updatedAt: now });
  save(db);
}

export async function getUserSessions(userId: string, limit = 20): Promise<SessionRecord[]> {
  if (useSupabase) {
    const res = await sb(
      `tmap_sessions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}&select=*`,
    );
    if (!res.ok) throw new Error(`supabase getUserSessions failed: ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map(rowToSession);
  }
  const db = load();
  return Object.values(db.sessions)
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  if (useSupabase) {
    const res = await sb(`tmap_sessions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    if (!res.ok) throw new Error(`supabase getSession failed: ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows[0] ? rowToSession(rows[0]) : undefined;
  }
  return load().sessions[id];
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    task: row.task as string,
    mode: row.mode as string,
    status: row.status as SessionRecord['status'],
    filesCount: (row.files_count as number) ?? 0,
    iterations: (row.iterations as number) ?? 0,
    costUsd: Number(row.cost_usd ?? 0),
    tokensUsed: (row.tokens_used as number) ?? 0,
    summary: row.summary as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ── AGENT LOGS ────────────────────────────────────────────────────────────────
export async function appendAgentLog(log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void> {
  const id = randomUUID();
  const ts = new Date().toISOString();

  if (useSupabase) {
    await sb('tmap_agent_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id,
        session_id: log.sessionId,
        role: log.role,
        provider: log.provider,
        model: log.model,
        attempts: log.attempts,
        input_tokens: log.inputTokens,
        output_tokens: log.outputTokens,
        cost_usd: log.costUsd,
        duration_ms: log.durationMs,
        ts,
      }),
    });
    return;
  }

  const db = load();
  db.agentLogs.push({ id, ts, ...log });
  if (db.agentLogs.length > 5000) db.agentLogs = db.agentLogs.slice(-5000);
  save(db);
}

export async function getSessionLogs(sessionId: string): Promise<AgentLogRecord[]> {
  if (useSupabase) {
    const res = await sb(
      `tmap_agent_logs?session_id=eq.${encodeURIComponent(sessionId)}&order=ts.asc&select=*`,
    );
    if (!res.ok) throw new Error(`supabase getSessionLogs failed: ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      role: r.role as string,
      provider: r.provider as string,
      model: r.model as string,
      attempts: (r.attempts as number) ?? 0,
      inputTokens: (r.input_tokens as number) ?? 0,
      outputTokens: (r.output_tokens as number) ?? 0,
      costUsd: Number(r.cost_usd ?? 0),
      durationMs: (r.duration_ms as number) ?? 0,
      ts: r.ts as string,
    }));
  }
  return load().agentLogs.filter((l) => l.sessionId === sessionId);
}

// ── COST TRACKING ─────────────────────────────────────────────────────────────
export async function addCost(userId: string, tokens: number, costUsd: number): Promise<void> {
  if (useSupabase) {
    // Upsert: increment totals if row exists, insert otherwise
    const existing = await getUserCost(userId);
    const now = new Date().toISOString();
    if (existing) {
      await sb(`tmap_costs?user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          total_cost_usd: Math.round((existing.totalCostUsd + costUsd) * 1e8) / 1e8,
          total_tokens: existing.totalTokens + tokens,
          session_count: existing.sessionCount + 1,
          updated_at: now,
        }),
      });
    } else {
      await sb('tmap_costs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          total_cost_usd: Math.round(costUsd * 1e8) / 1e8,
          total_tokens: tokens,
          session_count: 1,
          updated_at: now,
        }),
      });
    }
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
  if (useSupabase) {
    const res = await sb(`tmap_costs?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
    if (!res.ok) throw new Error(`supabase getUserCost failed: ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!rows[0]) return undefined;
    const r = rows[0];
    return {
      userId: r.user_id as string,
      totalCostUsd: Number(r.total_cost_usd ?? 0),
      totalTokens: (r.total_tokens as number) ?? 0,
      sessionCount: (r.session_count as number) ?? 0,
      updatedAt: r.updated_at as string,
    };
  }
  return load().costs[userId];
}
