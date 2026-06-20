// ── Supabase admin client (server-only) ───────────────────────────────────────
// Uses the SERVICE ROLE key, which bypasses RLS — so it must NEVER be imported
// into a client component. The provider_keys table has RLS enabled with no
// policies, meaning the browser (anon/authenticated) cannot touch it at all; the
// only path in is through API routes that first verify the caller's Supabase JWT
// here and then act strictly on that user's own rows.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True when the server has everything it needs to persist keys. */
export function isAdminConfigured(): boolean {
  const ok = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
  if (!ok) {
    console.warn("[auth] Supabase admin not configured — missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return ok;
}

let admin: SupabaseClient | null = null;

/** Lazily create the service-role client. Throws if the server isn't configured. */
export function getAdminSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase admin not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  if (admin) return admin;
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/**
 * Verify the caller from the `Authorization: Bearer <access_token>` header and
 * return the authenticated Supabase user, or null when the token is missing or
 * invalid. The token is the user's own Supabase session token (issued via Google
 * OAuth), so the resulting `user.id` is the same identity used by the projects
 * table — i.e. keys are tied to the signed-in email account.
 */
export async function getUserFromRequest(req: Request): Promise<User | null> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    console.warn("[auth] getUserFromRequest: missing or malformed Authorization header");
    return null;
  }
  const token = header.slice(7).trim();
  if (!token) {
    console.warn("[auth] getUserFromRequest: empty token after Bearer prefix");
    return null;
  }

  const { data, error } = await getAdminSupabase().auth.getUser(token);
  if (error) {
    // Log token prefix (safe — first 8 chars only) to correlate client/server
    const prefix = token.slice(0, 8);
    console.error(`[auth] getUserFromRequest: token validation failed (prefix=${prefix}):`, error.message, error.status);
    return null;
  }
  if (!data.user) {
    console.warn("[auth] getUserFromRequest: getUser returned no user and no error");
    return null;
  }
  return data.user;
}
