// Re-export auth utilities from the canonical supabase-admin module.
// Routes that import from "@/lib/server/auth" get the same getUserFromRequest
// that the rest of the codebase uses.
export { getUserFromRequest, getAdminSupabase, isAdminConfigured, tierForUser } from "./supabase-admin";
