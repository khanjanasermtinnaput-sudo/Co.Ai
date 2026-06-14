// ── Client helper for /api/keys ───────────────────────────────────────────────
// Talks to the server routes that persist AI provider keys for the signed-in
// Google account. Every call carries the user's Supabase access token so the
// server can tie the key to their identity. The plaintext key is sent once on
// save and never returned — reads only ever yield a masked preview.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

export interface StoredKey {
  provider: string;
  preview: string;
  updatedAt: string;
}

/** True when key persistence is possible (Supabase auth is live). */
export function keysEnabled(): boolean {
  return isSupabaseConfigured();
}

async function authToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await authToken();
  if (!token) throw new Error("not-signed-in");
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

/** Load the masked previews of every key the user has saved. */
export async function loadKeys(): Promise<StoredKey[]> {
  const res = await authedFetch("/api/keys");
  if (!res.ok) throw new Error(`load-failed:${res.status}`);
  const json = (await res.json()) as { keys: StoredKey[] };
  return json.keys ?? [];
}

/** Save (or replace) a provider key. Returns the new masked preview. */
export async function saveKey(provider: string, key: string): Promise<string> {
  const res = await authedFetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, key }),
  });
  const json = (await res.json().catch(() => ({}))) as { preview?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? `save-failed:${res.status}`);
  return json.preview ?? "";
}

/** Remove a saved provider key. */
export async function deleteKey(provider: string): Promise<void> {
  const res = await authedFetch(`/api/keys?provider=${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete-failed:${res.status}`);
}
