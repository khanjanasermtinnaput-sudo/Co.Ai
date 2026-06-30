// Thin shim so routes can import createAdminClient from "@/lib/server/supabase".
// Delegates to the canonical supabase-admin module (service-role client, server-only).
import { getAdminSupabase } from "./supabase-admin";
export { getAdminSupabase };

/** Alias used by Phase 61–70 routes. Returns the Supabase service-role client. */
export const createAdminClient = getAdminSupabase;
