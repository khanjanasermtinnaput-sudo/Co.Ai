// MFA — TOTP (RFC 6238) via otplib + encrypted storage + backup codes.
// TOTP secret encrypted at rest with encryptSecret (AES-256-GCM, same key as API keys).
// Backup codes: 10 × 8-char alphanumeric, stored as SHA-256 hashes.

import { authenticator } from 'otplib';
import { createHash, randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from './crypto';
import { getAdminSupabase } from './supabase-admin';

const ISSUER = process.env.MFA_ISSUER ?? 'Coagentix';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LEN   = 8;

authenticator.options = {
  window: 1, // allow ±1 step (30 s) for clock skew
  digits: 6,
  step:   30,
};

function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase()).digest('hex');
}

function generateBackupCodes(): { plain: string[]; hashed: string[] } {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // easy to read, no ambiguous chars
  const plain = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    Array.from({ length: BACKUP_CODE_LEN }, () => chars[randomBytes(1)[0] % chars.length]).join(''),
  );
  return { plain, hashed: plain.map(hashBackupCode) };
}

export interface MfaSetupResult {
  secret:      string;  // base32 — show once for authenticator app
  otpAuthUri:  string;  // otpauth:// URI for QR code
  backupCodes: string[]; // plain codes — show once, never stored plain
}

export async function setupMfa(userId: string, userEmail: string): Promise<MfaSetupResult> {
  const secret = authenticator.generateSecret(20); // 160-bit secret
  const otpAuthUri = authenticator.keyuri(userEmail, ISSUER, secret);
  const { plain: backupCodes, hashed } = generateBackupCodes();

  const encSecret = encryptSecret(secret);

  const db = getAdminSupabase();
  const { error } = await db.from('user_mfa').upsert(
    {
      user_id:         userId,
      totp_secret_enc: encSecret,
      backup_codes:    hashed,
      enabled_at:      null, // confirmed by verifyAndEnable
      updated_at:      new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`MFA setup failed: ${error.message}`);

  return { secret, otpAuthUri, backupCodes };
}

export async function verifyAndEnableMfa(userId: string, token: string): Promise<void> {
  const row = await getMfaRow(userId);
  if (!row) throw new Error('MFA not set up — call setupMfa first');

  const secret = decryptSecret(row.totp_secret_enc as string);
  if (!authenticator.verify({ token, secret })) {
    throw new Error('Invalid TOTP token');
  }

  const { error } = await getAdminSupabase()
    .from('user_mfa')
    .update({ enabled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function verifyTotp(userId: string, token: string): Promise<boolean> {
  const row = await getMfaRow(userId);
  if (!row || !(row.enabled_at as string | null)) return false;

  const secret = decryptSecret(row.totp_secret_enc as string);
  const valid = authenticator.verify({ token, secret });

  if (valid) {
    await getAdminSupabase()
      .from('user_mfa')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId);
  }
  return valid;
}

export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  const row = await getMfaRow(userId);
  if (!row || !(row.enabled_at as string | null)) return false;

  const codes = row.backup_codes as string[];
  const codeHash = hashBackupCode(code);
  const idx = codes.indexOf(codeHash);
  if (idx === -1) return false;

  // Consume the code — single use
  const remaining = codes.filter((_, i) => i !== idx);
  await getAdminSupabase()
    .from('user_mfa')
    .update({ backup_codes: remaining, last_used_at: new Date().toISOString() })
    .eq('user_id', userId);

  return true;
}

export async function isMfaEnabled(userId: string): Promise<boolean> {
  const row = await getMfaRow(userId);
  return Boolean(row?.enabled_at);
}

export async function disableMfa(userId: string): Promise<void> {
  const { error } = await getAdminSupabase()
    .from('user_mfa')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

async function getMfaRow(userId: string): Promise<Record<string, unknown> | null> {
  const { data } = await getAdminSupabase()
    .from('user_mfa')
    .select('totp_secret_enc, backup_codes, enabled_at, last_used_at')
    .eq('user_id', userId)
    .single();
  return data as Record<string, unknown> | null;
}

export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  const row = await getMfaRow(userId);
  if (!row || !(row.enabled_at as string | null)) throw new Error('MFA not enabled');

  const { plain, hashed } = generateBackupCodes();
  const { error } = await getAdminSupabase()
    .from('user_mfa')
    .update({ backup_codes: hashed, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;

  return plain;
}
