// Storage abstraction for the AOF Code server.
//
// Two backends implement this interface:
//   - FileStore     — atomic JSON file (default; render disk / local dev)
//   - SupabaseStore — Postgres via PostgREST (persistent on serverless/Vercel)
//
// db.ts picks one at startup based on env and delegates to it, so the rest of
// the server is storage-agnostic.

export type ProviderKeyName = 'openrouter' | 'gemini' | 'deepseek' | 'qwen' | 'llama' | 'claude';

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

export interface Store {
  // users
  findUserByUsername(username: string): Promise<UserRecord | undefined>;
  findUserById(id: string): Promise<UserRecord | undefined>;
  createUser(username: string, pinHash: string): Promise<UserRecord>;
  setUserKey(userId: string, provider: ProviderKeyName, encrypted: string): Promise<void>;
  deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void>;
  // sessions
  createSession(userId: string, task: string, mode: string): Promise<SessionRecord>;
  updateSession(id: string, patch: Partial<SessionRecord>): Promise<void>;
  getUserSessions(userId: string, limit: number): Promise<SessionRecord[]>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  // agent logs
  appendAgentLog(log: Omit<AgentLogRecord, 'id' | 'ts'>): Promise<void>;
  getSessionLogs(sessionId: string): Promise<AgentLogRecord[]>;
  // cost
  addCost(userId: string, tokens: number, costUsd: number): Promise<void>;
  getUserCost(userId: string): Promise<CostRecord | undefined>;
}
