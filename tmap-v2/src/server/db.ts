// Storage facade — picks a backend at startup and delegates to it.
//
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set  → SupabaseStore (durable, serverless-safe)
//   otherwise                                     → FileStore (atomic JSON, render disk / local)
//
// The rest of the server imports these functions and stays storage-agnostic.

import type { Store } from './store/types.js';
import { FileStore } from './store/fileStore.js';
import { SupabaseStore } from './store/supabaseStore.js';

export type {
  ProviderKeyName, UserRecord, SessionRecord, AgentLogRecord, CostRecord,
} from './store/types.js';
import type {
  ProviderKeyName, UserRecord, SessionRecord, AgentLogRecord, CostRecord,
} from './store/types.js';

function pickStore(): Store {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    console.log('AOF Code → storage: Supabase (Postgres)');
    return new SupabaseStore(url, key);
  }
  return new FileStore();
}

const store: Store = pickStore();

// ── USERS ───────────────────────────────────────────────────────────────────
export const findUserByUsername = (username: string): Promise<UserRecord | undefined> =>
  store.findUserByUsername(username);
export const findUserById = (id: string): Promise<UserRecord | undefined> =>
  store.findUserById(id);
export const createUser = (username: string, pinHash: string): Promise<UserRecord> =>
  store.createUser(username, pinHash);
export const setUserKey = (userId: string, provider: ProviderKeyName, encrypted: string): Promise<void> =>
  store.setUserKey(userId, provider, encrypted);
export const deleteUserKey = (userId: string, provider: ProviderKeyName): Promise<void> =>
  store.deleteUserKey(userId, provider);

// ── SESSIONS ─────────────────────────────────────────────────────────────────
export const createSession = (userId: string, task: string, mode: string): Promise<SessionRecord> =>
  store.createSession(userId, task, mode);
export const updateSession = (id: string, patch: Partial<SessionRecord>): Promise<void> =>
  store.updateSession(id, patch);
export const getUserSessions = (userId: string, limit = 20): Promise<SessionRecord[]> =>
  store.getUserSessions(userId, limit);
export const getSession = (id: string): Promise<SessionRecord | undefined> =>
  store.getSession(id);

// ── AGENT LOGS ────────────────────────────────────────────────────────────────
export const appendAgentLog = (log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void> =>
  store.appendAgentLog(log);
export const getSessionLogs = (sessionId: string): Promise<AgentLogRecord[]> =>
  store.getSessionLogs(sessionId);

// ── COST TRACKING ───────────────────────────────────────────────────────────
export const addCost = (userId: string, tokens: number, costUsd: number): Promise<void> =>
  store.addCost(userId, tokens, costUsd);
export const getUserCost = (userId: string): Promise<CostRecord | undefined> =>
  store.getUserCost(userId);
