// ── Supabase (GoTrue) token verification ──────────────────────────────────────
// Bridge for the aof-web frontend: real users sign in with Supabase/Google, so
// their requests to /v1/* carry a Supabase access token — NOT a tmap-v2 JWT. This
// verifies that token against the Supabase Auth API (no extra dependency; uses the
// service-role key the server already has) so those users can reach the backend.

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface SupabaseIdentity {
  id: string;      // Supabase auth user id (uuid) — matches provider_keys.user_id
  email: string;
}

/**
 * Verify a Supabase access token via GET {SUPABASE_URL}/auth/v1/user.
 * Returns the user identity, or null when the token is invalid / Supabase is not
 * configured. Never throws.
 */
export async function verifySupabaseToken(token: string): Promise<SupabaseIdentity | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; email?: string };
    if (!u?.id) return null;
    return { id: u.id, email: u.email ?? '' };
  } catch {
    return null;
  }
}
