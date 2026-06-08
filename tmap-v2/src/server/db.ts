import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * MVP data layer — a file-backed store behind a small repository interface.
 * Production target is PostgreSQL (see AOF_CODE_TDD.md §6); swap this module
 * for a pg-backed implementation without touching routes.
 */

export type ProviderKeyName = 'openrouter' | 'gemini' | 'deepseek' | 'qwen' | 'llama';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  // provider -> encrypted key blob (AES-256-GCM). Never stored in plaintext.
  encryptedKeys: Partial<Record<ProviderKeyName, string>>;
  createdAt: string;
}

interface DbShape {
  users: Record<string, UserRecord>; // keyed by lowercased email
}

const DB_PATH = join(process.cwd(), '.aof-server', 'db.json');

function load(): DbShape {
  if (!existsSync(DB_PATH)) return { users: {} };
  try {
    return JSON.parse(readFileSync(DB_PATH, 'utf8')) as DbShape;
  } catch {
    return { users: {} };
  }
}

function save(db: DbShape): void {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

export function findUserByEmail(email: string): UserRecord | undefined {
  return load().users[email.toLowerCase()];
}

export function findUserById(id: string): UserRecord | undefined {
  return Object.values(load().users).find((u) => u.id === id);
}

export function createUser(email: string, passwordHash: string): UserRecord {
  const db = load();
  const key = email.toLowerCase();
  if (db.users[key]) throw new Error('email already registered');
  const user: UserRecord = {
    id: randomUUID(),
    email,
    passwordHash,
    encryptedKeys: {},
    createdAt: new Date().toISOString(),
  };
  db.users[key] = user;
  save(db);
  return user;
}

export function setUserKey(userId: string, provider: ProviderKeyName, encrypted: string): void {
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  user.encryptedKeys[provider] = encrypted;
  save(db);
}

export function deleteUserKey(userId: string, provider: ProviderKeyName): void {
  const db = load();
  const user = Object.values(db.users).find((u) => u.id === userId);
  if (!user) throw new Error('user not found');
  delete user.encryptedKeys[provider];
  save(db);
}
