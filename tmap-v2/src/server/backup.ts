// Backup system — full/incremental exports of all server data, AES-256-GCM
// encryption, checksum verification, and backup manifest management.
// Backups are stored under CGNTX_DATA_DIR/backups/ as encrypted JSON archives.

import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fsList, fsPut, fsGet } from './file-store.js';
import { logger } from './logger.js';
import type { BackupManifest } from '../types.js';

const BACKUP_DIR = process.env.CGNTX_BACKUP_DIR
  ?? (process.env.VERCEL ? '/tmp/cgntx-backups' : '.coagentix-server/backups');

const BACKUP_MASTER_KEY = process.env.COAGENTIX_MASTER_KEY ?? process.env.AOF_MASTER_KEY ?? '';

function ensureBackupDir(): void {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Encryption helpers ────────────────────────────────────────────────────────

function deriveKey(salt: Buffer): Buffer {
  if (!BACKUP_MASTER_KEY) throw new Error('COAGENTIX_MASTER_KEY not set — cannot encrypt backup');
  return scryptSync(BACKUP_MASTER_KEY, salt, 32) as Buffer;
}

function encryptPayload(plaintext: string): { iv: string; salt: string; tag: string; data: string } {
  const salt = randomBytes(16);
  const key  = deriveKey(salt);
  const iv   = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    salt: salt.toString('hex'),
    iv:   iv.toString('hex'),
    tag:  cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('base64'),
  };
}

function decryptPayload(enc: { iv: string; salt: string; tag: string; data: string }): string {
  const salt    = Buffer.from(enc.salt, 'hex');
  const key     = deriveKey(salt);
  const iv      = Buffer.from(enc.iv,   'hex');
  const tag     = Buffer.from(enc.tag,  'hex');
  const data    = Buffer.from(enc.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ── Collection snapshot ────────────────────────────────────────────────────────

const BACKUP_COLLECTIONS = ['users', 'sessions', 'agent_logs', 'teams', 'team_members', 'orgs', 'org_members', 'role_assignments', 'analytics'];

interface BackupArchive {
  id:          string;
  createdAt:   string;
  collections: Record<string, unknown[]>;
  checksum:    string;
}

// ── Create backup ─────────────────────────────────────────────────────────────

export async function createBackup(opts: {
  requestedBy: string;
  encrypt?: boolean;
  collections?: string[];
}): Promise<BackupManifest> {
  ensureBackupDir();
  const id        = `bk-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const encrypt   = opts.encrypt !== false && Boolean(BACKUP_MASTER_KEY);
  const cols      = opts.collections ?? BACKUP_COLLECTIONS;

  const manifest: BackupManifest = {
    id, createdAt, sizeBytes: 0, tables: cols, recordCounts: {}, checksum: '', encrypted: encrypt,
    status: 'running',
  };
  fsPut('backup_manifests', id, manifest);

  try {
    const collections: Record<string, unknown[]> = {};
    const counts: Record<string, number>         = {};
    for (const col of cols) {
      const items = fsList(col);
      collections[col] = items;
      counts[col]      = items.length;
    }

    const archive: BackupArchive = { id, createdAt, collections, checksum: '' };
    const plaintext = JSON.stringify(archive);
    const checksum  = sha256(plaintext);
    archive.checksum = checksum;

    const finalJson = JSON.stringify(archive);
    let fileContent: string;

    if (encrypt) {
      const enc = encryptPayload(finalJson);
      fileContent = JSON.stringify({ encrypted: true, ...enc });
    } else {
      fileContent = finalJson;
    }

    const filePath = join(BACKUP_DIR, `${id}.bak`);
    writeFileSync(filePath, fileContent, 'utf8');
    const sizeBytes = Buffer.byteLength(fileContent, 'utf8');

    const done: BackupManifest = {
      ...manifest, sizeBytes, recordCounts: counts, checksum, status: 'complete',
    };
    fsPut('backup_manifests', id, done);
    logger.info('backup_complete', { id, sizeBytes, collections: cols, encrypted: encrypt, requestedBy: opts.requestedBy });
    return done;
  } catch (e) {
    const failed: BackupManifest = { ...manifest, status: 'failed', error: (e as Error).message };
    fsPut('backup_manifests', id, failed);
    logger.error('backup_failed', { id, error: (e as Error).message });
    throw e;
  }
}

// ── List backups ───────────────────────────────────────────────────────────────

export function listBackups(): BackupManifest[] {
  return fsList<BackupManifest>('backup_manifests')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackup(id: string): BackupManifest | null {
  return fsGet<BackupManifest>('backup_manifests', id);
}

// ── Read archive (for restore) ─────────────────────────────────────────────────

export function readBackupArchive(id: string): BackupArchive {
  const filePath = join(BACKUP_DIR, `${id}.bak`);
  if (!existsSync(filePath)) throw new Error(`Backup file not found: ${id}`);
  const raw = readFileSync(filePath, 'utf8') as string;
  const parsed = JSON.parse(raw) as { encrypted?: boolean; salt?: string; iv?: string; tag?: string; data?: string } & BackupArchive;

  let plaintext: string;
  if (parsed.encrypted) {
    plaintext = decryptPayload(parsed as { iv: string; salt: string; tag: string; data: string });
  } else {
    plaintext = raw;
  }

  const archive = JSON.parse(plaintext) as BackupArchive;
  const expectedChecksum = sha256(JSON.stringify({ ...archive, checksum: '' }));
  if (archive.checksum && archive.checksum !== expectedChecksum) {
    throw new Error(`Backup checksum mismatch — file may be corrupt or tampered`);
  }
  return archive;
}

// ── Validate backup ────────────────────────────────────────────────────────────

export function validateBackup(id: string): { valid: boolean; error?: string; recordCounts: Record<string, number> } {
  try {
    const archive = readBackupArchive(id);
    const counts: Record<string, number> = {};
    for (const [col, items] of Object.entries(archive.collections)) counts[col] = (items as unknown[]).length;
    return { valid: true, recordCounts: counts };
  } catch (e) {
    return { valid: false, error: (e as Error).message, recordCounts: {} };
  }
}
