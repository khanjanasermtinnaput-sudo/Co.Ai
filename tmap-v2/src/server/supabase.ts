import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Supabase client (persistent DB) ───────────────────────────────────────────
// Active only when BOTH SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
// Otherwise db.ts falls back to local JSON file storage.
let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    cached = null;
  }
  return cached;
}

export function supabaseEnabled(): boolean {
  return getSupabase() !== null;
}
