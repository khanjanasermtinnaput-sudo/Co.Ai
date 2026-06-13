// ── Supabase browser client ───────────────────────────────────────────────────
// Single shared client for auth + the projects table. Designed to degrade
// gracefully: when the env vars are absent the whole app falls back to the
// offline demo experience (seed projects + a stand-in user), mirroring the
// mock-mode philosophy in lib/api.ts. Real auth + persistence kick in the moment
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when both Supabase env vars are present (i.e. live mode). */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let client: SupabaseClient | null = null;

/** Lazily create (and memoise) the browser Supabase client, or null in demo mode. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  client = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: {
      persistSession: true, // "remember me" — session survives reloads
      autoRefreshToken: true,
      // The /auth/callback page exchanges the OAuth code explicitly, so we turn
      // off automatic URL detection to avoid double-exchanging the code (which
      // throws "code already used" and bounces the user back to /login).
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}
