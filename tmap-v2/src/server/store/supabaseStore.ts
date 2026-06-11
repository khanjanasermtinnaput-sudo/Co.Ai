// Supabase (Postgres) store — talks to PostgREST over fetch, no SDK dependency.
//
// Activated when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (see db.ts).
// Gives durable, indexed, per-row storage so data survives serverless cold
// starts (unlike the ephemeral /tmp file on Vercel). Run supabase/migration.sql
// once to create the tables.
//
// Records are camelCase in app code, snake_case in Postgres — mapped at the edge.

import { randomUUID } from 'node:crypto';
import type {
  Store, UserRecord, SessionRecord, AgentLogRecord, CostRecord, ProviderKeyName,
} from './types.js';

interface DbRowUser {
  id: string; username: string; pin_hash: string;
  encrypted_keys: Partial<Record<ProviderKeyName, string>>; created_at: string;
}
interface DbRowSession {
  id: string; user_id: string; task: string; mode: string; status: string;
  files_count: number; iterations: number; cost_usd: number; tokens_used: number;
  created_at: string; updated_at: string; summary: string | null;
}
interface DbRowLog {
  id: string; session_id: string; role: string; provider: string; model: string;
  attempts: number; input_tokens: number; output_tokens: number;
  cost_usd: number; duration_ms: number; ts: string;
}
interface DbRowCost {
  user_id: string; total_cost_usd: number; total_tokens: number;
  session_count: number; updated_at: string;
}

export class SupabaseStore implements Store {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, serviceKey: string) {
    this.base = `${url.replace(/\/$/, '')}/rest/v1`;
    this.headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };
  }

  // ── PostgREST helpers ───────────────────────────────────────────────────────
  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`supabase ${res.status}: ${detail.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private get(path: string): Promise<any[]> {
    return this.req(path).then((r) => (Array.isArray(r) ? r : []));
  }

  private insert(table: string, row: object): Promise<any[]> {
    return this.req(`/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    }).then((r) => (Array.isArray(r) ? r : []));
  }

  private patch(table: string, filter: string, row: object): Promise<void> {
    return this.req(`/${table}?${filter}`, {
      method: 'PATCH',
      body: JSON.stringify(row),
    }).then(() => undefined);
  }

  // ── mappers ─────────────────────────────────────────────────────────────────
  private toUser(r: DbRowUser): UserRecord {
    return {
      id: r.id, username: r.username, pinHash: r.pin_hash,
      encryptedKeys: r.encrypted_keys ?? {}, createdAt: r.created_at,
    };
  }
  private toSession(r: DbRowSession): SessionRecord {
    return {
      id: r.id, userId: r.user_id, task: r.task, mode: r.mode,
      status: r.status as SessionRecord['status'],
      filesCount: r.files_count, iterations: r.iterations,
      costUsd: r.cost_usd, tokensUsed: r.tokens_used,
      createdAt: r.created_at, updatedAt: r.updated_at,
      summary: r.summary ?? undefined,
    };
  }

  // ── USERS ───────────────────────────────────────────────────────────────────
  async findUserByUsername(username: string): Promise<UserRecord | undefined> {
    const rows = await this.get(`/users?username=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`);
    return rows[0] ? this.toUser(rows[0]) : undefined;
  }

  async findUserById(id: string): Promise<UserRecord | undefined> {
    const rows = await this.get(`/users?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? this.toUser(rows[0]) : undefined;
  }

  async createUser(username: string, pinHash: string): Promise<UserRecord> {
    const key = username.toLowerCase();
    if (await this.findUserByUsername(key)) throw new Error('username already taken');
    const rows = await this.insert('users', {
      id: randomUUID(), username: key, pin_hash: pinHash,
      encrypted_keys: {}, created_at: new Date().toISOString(),
    });
    return this.toUser(rows[0]);
  }

  async setUserKey(userId: string, provider: ProviderKeyName, encrypted: string): Promise<void> {
    const user = await this.findUserById(userId);
    if (!user) throw new Error('user not found');
    const keys = { ...user.encryptedKeys, [provider]: encrypted };
    await this.patch('users', `id=eq.${encodeURIComponent(userId)}`, { encrypted_keys: keys });
  }

  async deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
    const user = await this.findUserById(userId);
    if (!user) throw new Error('user not found');
    const keys = { ...user.encryptedKeys };
    delete keys[provider];
    await this.patch('users', `id=eq.${encodeURIComponent(userId)}`, { encrypted_keys: keys });
  }

  // ── SESSIONS ─────────────────────────────────────────────────────────────────
  async createSession(userId: string, task: string, mode: string): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const rows = await this.insert('sessions', {
      id: randomUUID(), user_id: userId, task, mode, status: 'running',
      files_count: 0, iterations: 0, cost_usd: 0, tokens_used: 0,
      created_at: now, updated_at: now,
    });
    return this.toSession(rows[0]);
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.filesCount !== undefined) row.files_count = patch.filesCount;
    if (patch.iterations !== undefined) row.iterations = patch.iterations;
    if (patch.costUsd !== undefined) row.cost_usd = patch.costUsd;
    if (patch.tokensUsed !== undefined) row.tokens_used = patch.tokensUsed;
    if (patch.summary !== undefined) row.summary = patch.summary;
    await this.patch('sessions', `id=eq.${encodeURIComponent(id)}`, row);
  }

  async getUserSessions(userId: string, limit = 20): Promise<SessionRecord[]> {
    const rows = await this.get(
      `/sessions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`,
    );
    return rows.map((r) => this.toSession(r));
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const rows = await this.get(`/sessions?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? this.toSession(rows[0]) : undefined;
  }

  // ── AGENT LOGS ────────────────────────────────────────────────────────────────
  async appendAgentLog(log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void> {
    await this.insert('agent_logs', {
      id: randomUUID(), session_id: log.sessionId, role: log.role, provider: log.provider,
      model: log.model, attempts: log.attempts, input_tokens: log.inputTokens,
      output_tokens: log.outputTokens, cost_usd: log.costUsd, duration_ms: log.durationMs,
      ts: new Date().toISOString(),
    });
  }

  async getSessionLogs(sessionId: string): Promise<AgentLogRecord[]> {
    const rows: DbRowLog[] = await this.get(
      `/agent_logs?session_id=eq.${encodeURIComponent(sessionId)}&order=ts.asc`,
    );
    return rows.map((r) => ({
      id: r.id, sessionId: r.session_id, role: r.role, provider: r.provider, model: r.model,
      attempts: r.attempts, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
      costUsd: r.cost_usd, durationMs: r.duration_ms, ts: r.ts,
    }));
  }

  // ── COST TRACKING ───────────────────────────────────────────────────────────
  // Best-effort analytics: read-modify-write. (Cross-instance precision would use
  // a Postgres RPC for an atomic increment; not required for usage totals.)
  async addCost(userId: string, tokens: number, costUsd: number): Promise<void> {
    const existing = await this.getUserCost(userId);
    const next: DbRowCost = {
      user_id: userId,
      total_cost_usd: Math.round(((existing?.totalCostUsd ?? 0) + costUsd) * 1e8) / 1e8,
      total_tokens: (existing?.totalTokens ?? 0) + tokens,
      session_count: (existing?.sessionCount ?? 0) + 1,
      updated_at: new Date().toISOString(),
    };
    // upsert on the user_id primary key
    await this.req('/costs', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(next),
    });
  }

  async getUserCost(userId: string): Promise<CostRecord | undefined> {
    const rows: DbRowCost[] = await this.get(`/costs?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    const r = rows[0];
    if (!r) return undefined;
    return {
      userId: r.user_id, totalCostUsd: r.total_cost_usd, totalTokens: r.total_tokens,
      sessionCount: r.session_count, updatedAt: r.updated_at,
    };
  }
}
