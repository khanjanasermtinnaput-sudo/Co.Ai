import {
  randomBytes, scryptSync, timingSafeEqual,
  createCipheriv, createDecipheriv, createHash,
} from 'node:crypto';

// ── Password hashing (scrypt, no native deps) ─────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ── API-key encryption at rest (AES-256-GCM) ──────────────────────────────────
// Master key from env AOF_MASTER_KEY (any string; derived to 32 bytes via sha256).
function masterKey(): Buffer {
  const raw = process.env.AOF_MASTER_KEY;
  if (!raw || raw.length < 16) {
    throw new Error('AOF_MASTER_KEY missing or too short — set a long random value in .env');
  }
  return createHash('sha256').update(raw).digest(); // 32 bytes
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(blob: string): string {
  const [ivHex, tagHex, dataHex] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// mask a key for display: sk-or-v1-abcd...wxyz
export function maskKey(plain: string): string {
  if (plain.length <= 10) return '••••';
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`;
}
