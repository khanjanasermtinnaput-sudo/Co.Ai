import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export type ProviderKeyName = 'openrouter' | 'gemini' | 'deepseek' | 'qwen' | 'llama';

export interface UserRecord {
  id: string;
  username: string;
  pinHash: string;
  encryptedKeys: Partial<Record<ProviderKeyName, string>>;
  createdAt: string;
}

// ── Supabase client (used when SUPABASE_URL is set) ────────────────────────────
function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

function useSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Supabase implementations ───────────────────────────────────────────────────
async function sbFindByUsername(username: string): Promise<UserRecord | undefined> {
  const { data } = await supabase().from('users').select('*').eq('username', username.toLowerCase()).maybeSingle();
  return data ? rowToUser(data) : undefined;
}

async function sbFindById(id: string): Promise<UserRecord | undefined> {
  const { data } = await supabase().from('users').select('*').eq('id', id).maybeSingle();
  return data ? rowToUser(data) : undefined;
}

async function sbCreateUser(username: string, pinHash: string): Promise<UserRecord> {
  const { data, error } = await supabase().from('users')
    .insert({ username: username.toLowerCase(), pin_hash: pinHash, encrypted_keys: {} })
    .select().single();
  if (error) throw new Error(error.message);
  return rowToUser(data);
}

async function sbSetKey(userId: string, provider: ProviderKeyName, encrypted: string): Promise<void> {
  const { data } = await supabase().from('users').select('encrypted_keys').eq('id', userId).single();
  const keys = { ...(data?.encrypted_keys ?? {}), [provider]: encrypted };
  const { error } = await supabase().from('users').update({ encrypted_keys: keys }).eq('id', userId);
  if (error) throw new Error(error.message);
}

async function sbDeleteKey(userId: string, provider: ProviderKeyName): Promise<void> {
  const { data } = await supabase().from('users').select('encrypted_keys').eq('id', userId).single();
  const keys = { ...(data?.encrypted_keys ?? {}) };
  delete keys[provider];
  await supabase().from('users').update({ encrypted_keys: keys }).eq('id', userId);
}

function rowToUser(row: any): UserRecord {
  return {
    id: row.id,
    username: row.username,
    pinHash: row.pin_hash,
    encryptedKeys: row.encrypted_keys ?? {},
    createdAt: row.created_at,
  };
}

// ── File-based fallback (local dev / Vercel /tmp) ─────────────────────────────
const DB_PATH = process.env.VERCEL
  ? '/tmp/aof-db.json'
  : join(process.cwd(), '.aof-server', 'db.json');

interface DbShape { users: Record<string, UserRecord> }

function load(): DbShape {
  if (!existsSync(DB_PATH)) return { users: {} };
  try { return JSON.parse(readFileSync(DB_PATH, 'utf8')) as DbShape; } catch { return { users: {} }; }
}
function save(db: DbShape): void {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ── Public API (async, works with both backends) ───────────────────────────────
export async function findUserByUsername(username: string): Promise<UserRecord | undefined> {
  if (useSupabase()) return sbFindByUsername(username);
  return load().users[username.toLowerCase()];
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  if (useSupabase()) return sbFindById(id);
  return Object.values(load().users).find((u) => u.id === id);
}

export async function createUser(username: string, pinHash: string): Promise<UserRecord> {
  if (useSupabase()) return sbCreateUser(username, pinHash);
  const db = load();
  const key = username.toLowerCase();
  if (db.users[key]) throw new Error('username already taken');
  const user: UserRecord = {
    id: randomUUID(), username: key, pinHash,
    encryptedKeys: {}, createdAt: new Date().toISOString(),
  };
  db.users[key] = user; save(db); return user;
}

export async function setUserKey(userId: string, provider: ProviderKeyName, encrypted: string): Promise<void> {
  if (useSupabase()) return sbSetKey(userId, provider, encrypted);
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  user.encryptedKeys[provider] = encrypted; save(db);
}

export async function deleteUserKey(userId: string, provider: ProviderKeyName): Promise<void> {
  if (useSupabase()) return sbDeleteKey(userId, provider);
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  delete user.encryptedKeys[provider]; save(db);
}
