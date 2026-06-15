import {
  randomBytes, scryptSync, timingSafeEqual,
  createCipheriv, createDecipheriv, createHash,
} from 'node:crypto';

// Ciphertext format version. v2 blobs are prefixed "aof2:" and use a scrypt-
// derived key (KDF, brute-force resistant). Legacy blobs (no prefix, 3 hex
// segments) used a plain sha256 derivation and are still decryptable so existing
// stored keys keep working after the upgrade.
const V2_PREFIX = 'aof2';
// Fixed application salt for stretching the master secret. A static salt is fine
// here: its job is to bind the KDF to this app, not to protect per-record data
// (each ciphertext already has its own random IV).
const KDF_SALT = Buffer.from('aof-master-key-kdf-v2', 'utf8');

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
// Master key from env AOF_MASTER_KEY. New (v2) ciphertexts derive the 32-byte AES
// key with scrypt (a slow KDF) so a leaked env value is far harder to brute-force
// than the old single-pass sha256. The derived key is cached per process because
// scrypt is intentionally expensive and /v1/me decrypts several keys per request.
function rawMasterKey(): string {
  const raw = process.env.AOF_MASTER_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      'AOF_MASTER_KEY missing or too short — set a long random value in .env ' +
      '(recommended: 32+ random bytes, e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`)',
    );
  }
  return raw;
}

let cachedKey: { raw: string; key: Buffer } | null = null;
function masterKey(): Buffer {
  const raw = rawMasterKey();
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key;
  const key = scryptSync(raw, KDF_SALT, 32); // 32 bytes, KDF-stretched
  cachedKey = { raw, key };
  return key;
}

// Legacy derivation — only used to decrypt ciphertexts written before the KDF upgrade.
function legacyMasterKey(): Buffer {
  return createHash('sha256').update(rawMasterKey()).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(blob: string): string {
  const parts = (blob ?? '').split(':');

  // v2: "aof2:iv:tag:data" (scrypt key) | legacy: "iv:tag:data" (sha256 key)
  let key: Buffer, ivHex: string, tagHex: string, dataHex: string;
  if (parts.length === 4 && parts[0] === V2_PREFIX) {
    [, ivHex, tagHex, dataHex] = parts;
    key = masterKey();
  } else if (parts.length === 3) {
    [ivHex, tagHex, dataHex] = parts;
    key = legacyMasterKey();
  } else {
    throw new Error('decryptSecret: malformed ciphertext');
  }
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('decryptSecret: malformed ciphertext');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
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
