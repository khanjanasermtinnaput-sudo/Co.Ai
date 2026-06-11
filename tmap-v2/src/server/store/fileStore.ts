// File-backed store — hardened JSON storage.
//
// Fixes over the original load/mutate/save approach:
//   1. ATOMIC writes — write to a temp file then rename(), so a crash mid-write
//      can never leave a truncated/corrupt db.json (rename is atomic on POSIX).
//   2. SERIALIZED writes — every read-modify-write runs through a single promise
//      chain, so concurrent requests can't interleave and clobber each other's
//      updates (lost-update protection), even if the operation awaits internally.
//
// Good for self-hosted (render persistent disk) and local dev. For serverless
// where /tmp is ephemeral, use SupabaseStore instead (see db.ts selection).

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Store, UserRecord, SessionRecord, AgentLogRecord, CostRecord, ProviderKeyName,
} from './types.js';

interface DbShape {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  agentLogs: AgentLogRecord[];
  costs: Record<string, CostRecord>; // userId -> cost
}

const MAX_AGENT_LOGS = 5000;

export class FileStore implements Store {
  private readonly path: string;
  // Single-writer promise chain — serializes all mutating ops in this process.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(path?: string) {
    this.path = path
      ?? process.env.AOF_DB_PATH
      ?? (process.env.VERCEL ? '/tmp/aof-db.json' : join(process.cwd(), '.aof-server', 'db.json'));
  }

  // ── serialization ─────────────────────────────────────────────────────────
  /** Run `fn` after all previously-queued ops complete (lost-update safe). */
  private serialize<T>(fn: () => T): Promise<T> {
    const next = this.chain.then(() => fn());
    // keep the chain alive even if this op throws
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  // ── persistence ───────────────────────────────────────────────────────────
  private load(): DbShape {
    if (!existsSync(this.path)) return { users: {}, sessions: {}, agentLogs: [], costs: {} };
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as DbShape;
    } catch {
      return { users: {}, sessions: {}, agentLogs: [], costs: {} };
    }
  }

  private save(db: DbShape): void {
    mkdirSync(dirname(this.path), { recursive: true });
    // atomic write: temp file + rename (rename is atomic on the same filesystem)
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  // ── USERS ───────────────────────────────────────────────────────────────────
  async findUserByUsername(username: string): Promise<UserRecord | undefined> {
    return this.load().users[username.toLowerCase()];
  }

  async findUserById(id: string): Promise<UserRecord | undefined> {
    return Object.values(this.load().users).find((u) => u.id === id);
  }

  createUser(username: string, pinHash: string): Promise<UserRecord> {
    return this.serialize(() => {
      const db = this.load();
      const key = username.toLowerCase();
      if (db.users[key]) throw new Error('username already taken');
      const user: UserRecord = {
        id: randomUUID(), username: key, pinHash,
        encryptedKeys: {}, createdAt: new Date().toISOString(),
      };
      db.users[key] = user;
      this.save(db);
      return user;
    });
  }

  setUserKey(userId: string, provider: ProviderKeyName, encrypted: string): Promise<void> {
    return this.serialize(() => {
      const db = this.load();
      const user = Object.values(db.users).find((u) => u.id === userId);
      if (!user) throw new Error('user not found');
      user.encryptedKeys[provider] = encrypted;
      this.save(db);
    });
  }

  deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
    return this.serialize(() => {
      const db = this.load();
      const user = Object.values(db.users).find((u) => u.id === userId);
      if (!user) throw new Error('user not found');
      delete user.encryptedKeys[provider];
      this.save(db);
    });
  }

  // ── SESSIONS ─────────────────────────────────────────────────────────────────
  createSession(userId: string, task: string, mode: string): Promise<SessionRecord> {
    return this.serialize(() => {
      const db = this.load();
      const now = new Date().toISOString();
      const session: SessionRecord = {
        id: randomUUID(), userId, task, mode,
        status: 'running', filesCount: 0, iterations: 0, costUsd: 0, tokensUsed: 0,
        createdAt: now, updatedAt: now,
      };
      db.sessions[session.id] = session;
      this.save(db);
      return session;
    });
  }

  updateSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
    return this.serialize(() => {
      const db = this.load();
      if (!db.sessions[id]) return;
      Object.assign(db.sessions[id], patch, { updatedAt: new Date().toISOString() });
      this.save(db);
    });
  }

  async getUserSessions(userId: string, limit = 20): Promise<SessionRecord[]> {
    return Object.values(this.load().sessions)
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    return this.load().sessions[id];
  }

  // ── AGENT LOGS ────────────────────────────────────────────────────────────────
  appendAgentLog(log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void> {
    return this.serialize(() => {
      const db = this.load();
      db.agentLogs.push({ id: randomUUID(), ts: new Date().toISOString(), ...log });
      if (db.agentLogs.length > MAX_AGENT_LOGS) db.agentLogs = db.agentLogs.slice(-MAX_AGENT_LOGS);
      this.save(db);
    });
  }

  async getSessionLogs(sessionId: string): Promise<AgentLogRecord[]> {
    return this.load().agentLogs.filter((l) => l.sessionId === sessionId);
  }

  // ── COST TRACKING ───────────────────────────────────────────────────────────
  addCost(userId: string, tokens: number, costUsd: number): Promise<void> {
    return this.serialize(() => {
      const db = this.load();
      const existing = db.costs[userId]
        ?? { userId, totalCostUsd: 0, totalTokens: 0, sessionCount: 0, updatedAt: '' };
      existing.totalCostUsd = Math.round((existing.totalCostUsd + costUsd) * 1e8) / 1e8;
      existing.totalTokens += tokens;
      existing.sessionCount += 1;
      existing.updatedAt = new Date().toISOString();
      db.costs[userId] = existing;
      this.save(db);
    });
  }

  async getUserCost(userId: string): Promise<CostRecord | undefined> {
    return this.load().costs[userId];
  }
}
