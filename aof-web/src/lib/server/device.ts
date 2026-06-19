// Device management — fingerprint-based device registry.
// Fingerprint = SHA-256(User-Agent + Accept-Language + Accept-Encoding).

import { createHash } from 'node:crypto';
import { getAdminSupabase } from './supabase-admin';

export interface DeviceInfo {
  id:          string;
  userId:      string;
  fingerprint: string;
  name:        string;
  lastIp:      string | null;
  lastSeenAt:  string;
  trustedAt:   string | null;
  revokedAt:   string | null;
  sessionCount: number;
  createdAt:   string;
}

export function deviceFingerprint(req: Request): string {
  const ua  = req.headers.get('user-agent') ?? '';
  const lang = req.headers.get('accept-language') ?? '';
  const enc  = req.headers.get('accept-encoding') ?? '';
  return createHash('sha256').update(`${ua}|${lang}|${enc}`).digest('hex');
}

export function parseDeviceName(ua: string): string {
  if (!ua) return 'Unknown Device';

  const browsers: [RegExp, string][] = [
    [/Edg\/[\d.]+/,          'Edge'],
    [/OPR\/[\d.]+/,          'Opera'],
    [/Chrome\/[\d.]+/,       'Chrome'],
    [/Safari\/[\d.]+/,       'Safari'],
    [/Firefox\/[\d.]+/,      'Firefox'],
  ];
  const os: [RegExp, string][] = [
    [/Windows NT 10/,        'Windows 10/11'],
    [/Windows NT/,           'Windows'],
    [/Mac OS X/,             'macOS'],
    [/iPhone/,               'iPhone'],
    [/iPad/,                 'iPad'],
    [/Android/,              'Android'],
    [/Linux/,                'Linux'],
  ];

  const browser = browsers.find(([r]) => r.test(ua))?.[1] ?? 'Browser';
  const system  = os.find(([r]) => r.test(ua))?.[1] ?? 'Unknown OS';
  return `${browser} on ${system}`;
}

export async function getOrCreateDevice(
  userId:      string,
  fingerprint: string,
  name:        string,
  ip:          string,
): Promise<string> {
  const db = getAdminSupabase();

  // Upsert: update last_seen_at and last_ip on conflict
  const { data, error } = await db
    .from('user_devices')
    .upsert(
      { user_id: userId, fingerprint, name, last_ip: ip, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,fingerprint', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error || !data) throw new Error(`device upsert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

export async function listDevices(userId: string): Promise<DeviceInfo[]> {
  const { data, error } = await getAdminSupabase()
    .from('user_devices')
    .select('id, user_id, fingerprint, name, last_ip, last_seen_at, trusted_at, revoked_at, session_count, created_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id:           r.id as string,
    userId:       r.user_id as string,
    fingerprint:  r.fingerprint as string,
    name:         (r.name as string) ?? 'Unknown',
    lastIp:       r.last_ip as string | null,
    lastSeenAt:   r.last_seen_at as string,
    trustedAt:    r.trusted_at as string | null,
    revokedAt:    r.revoked_at as string | null,
    sessionCount: (r.session_count as number) ?? 0,
    createdAt:    r.created_at as string,
  }));
}

export async function trustDevice(deviceId: string, userId: string): Promise<void> {
  const { error } = await getAdminSupabase()
    .from('user_devices')
    .update({ trusted_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function revokeDevice(deviceId: string, userId: string): Promise<void> {
  const { error } = await getAdminSupabase()
    .from('user_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('user_id', userId);
  if (error) throw error;
}
