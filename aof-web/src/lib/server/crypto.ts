// ── API-key encryption at rest (AES-256-GCM) ──────────────────────────────────
// Server-only. Mirrors tmap-v2/src/server/crypto.ts so keys are protected the
// same way across both surfaces. The master key comes from AOF_MASTER_KEY (any
// long string; derived to 32 bytes via sha256). The plaintext key is never sent
// back to the browser — only the masked preview is.

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

function masterKey(): Buffer {
  const raw = process.env.AOF_MASTER_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("AOF_MASTER_KEY missing or too short — set a long random value in the environment");
  }
  return createHash("sha256").update(raw).digest(); // 32 bytes
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(blob: string): string {
  const [ivHex, tagHex, dataHex] = blob.split(":");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/** mask a key for display: sk-or-…wxyz */
export function maskKey(plain: string): string {
  if (plain.length <= 10) return "••••";
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`;
}
