// ── API-key encryption at rest (AES-256-GCM) ──────────────────────────────────
// Server-only. Mirrors tmap-v2/src/server/crypto.ts so keys are protected the
// same way across both surfaces. v2 ciphertexts derive the AES key with scrypt
// (a slow KDF), so a leaked NEXORA_MASTER_KEY is far harder to brute-force than the
// old single-pass sha256. The plaintext key is never sent back to the browser.

import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from "node:crypto";

// v2 blobs are "aof2:iv:tag:data" (scrypt key); legacy blobs are "iv:tag:data"
// (sha256 key) and stay decryptable so keys stored before the upgrade keep working.
const V2_PREFIX = "aof2";
// Fixed application salt for stretching the master secret (per-record randomness
// comes from the per-ciphertext IV; the salt just binds the KDF to this app).
const KDF_SALT = Buffer.from("nexora-master-key-kdf-v2", "utf8");

function rawMasterKey(): string {
  const raw = process.env.NEXORA_MASTER_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("NEXORA_MASTER_KEY missing or too short — set a long random value (recommended 32+ random bytes) in the environment");
  }
  return raw;
}

// scrypt is intentionally expensive, so cache the derived key per process.
let cachedKey: { raw: string; key: Buffer } | null = null;
function masterKey(): Buffer {
  const raw = rawMasterKey();
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key;
  const key = scryptSync(raw, KDF_SALT, 32);
  cachedKey = { raw, key };
  return key;
}

// Legacy derivation — only used to decrypt ciphertexts written before the KDF upgrade.
function legacyMasterKey(): Buffer {
  return createHash("sha256").update(rawMasterKey()).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(blob: string): string {
  const parts = (blob ?? "").split(":");

  let key: Buffer, ivHex: string, tagHex: string, dataHex: string;
  if (parts.length === 4 && parts[0] === V2_PREFIX) {
    [, ivHex, tagHex, dataHex] = parts;
    key = masterKey();
  } else if (parts.length === 3) {
    [ivHex, tagHex, dataHex] = parts;
    key = legacyMasterKey();
  } else {
    throw new Error("decryptSecret: malformed ciphertext");
  }
  if (!ivHex || !tagHex || !dataHex) throw new Error("decryptSecret: malformed ciphertext");

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/** mask a key for display: sk-or-…wxyz */
export function maskKey(plain: string): string {
  if (plain.length <= 10) return "••••";
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`;
}
