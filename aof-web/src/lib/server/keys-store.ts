// ── Per-user provider key loading ──────────────────────────────────────────────
// Bridges /api/keys' encrypted storage (provider_keys table) to the runtime
// provider layer. The signed-in user's own key always wins over the server's
// env var for a given provider — see KeyOverrides in ai-providers.ts.

import { getAdminSupabase, isAdminConfigured } from "@/lib/server/supabase-admin";
import { decryptSecret } from "@/lib/server/crypto";
import type { KeyOverrides, ProviderId } from "@/lib/server/ai-providers";

const STORED_PROVIDERS = new Set<string>(["openrouter", "gemini", "deepseek", "qwen", "llama"]);

/** Load + decrypt every provider key the given user has saved. Never throws —
 *  a storage/decryption hiccup just means no override (falls back to env). */
export async function loadUserKeyOverrides(userId: string | undefined): Promise<KeyOverrides> {
  if (!userId || !isAdminConfigured()) return {};

  try {
    const { data, error } = await getAdminSupabase()
      .from("provider_keys")
      .select("provider, encrypted_key")
      .eq("user_id", userId);
    if (error || !data) return {};

    const overrides: KeyOverrides = {};
    for (const row of data) {
      const provider = row.provider as string;
      if (!STORED_PROVIDERS.has(provider)) continue;
      try {
        overrides[provider as ProviderId] = decryptSecret(row.encrypted_key as string);
      } catch {
        /* a corrupt/legacy row shouldn't break the whole request — skip it */
      }
    }
    return overrides;
  } catch {
    return {};
  }
}
