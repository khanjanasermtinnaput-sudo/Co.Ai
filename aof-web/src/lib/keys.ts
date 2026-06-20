// ── Client helper for /api/keys ───────────────────────────────────────────────
// Talks to the server routes that persist AI provider keys for the signed-in
// Google account. Every call carries the user's Supabase access token so the
// server can tie the key to their identity. The plaintext key is sent once on
// save and never returned — reads only ever yield a masked preview.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { isAppError, parseErrorResponse } from "@/lib/errors/api-error";

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
  if (!supabase) {
    console.debug("[keys] authToken: supabase not configured");
    return null;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    console.debug("[keys] authToken: no active session");
    return null;
  }
  const expiresAt = (data.session.expires_at ?? 0) * 1000;
  const msUntilExpiry = expiresAt - Date.now();
  console.debug(`[keys] authToken: session found, expires in ${Math.round(msUntilExpiry / 1000)}s`);

  // Proactively refresh when the token expires within 60 seconds.
  // autoRefreshToken can miss its window when the tab was idle.
  if (msUntilExpiry <= 60_000) {
    console.debug("[keys] authToken: token near/past expiry — refreshing");
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed.session) {
      // Refresh token is itself expired or invalid — the session is dead.
      // Sign out so the UI reflects the true logged-out state and stops
      // allowing requests that will always 401.
      console.warn("[keys] authToken: refresh failed — signing out", refreshErr?.message);
      void supabase.auth.signOut();
      return null;
    }
    console.debug("[keys] authToken: refreshed successfully");
    return refreshed.session.access_token;
  }
  return data.session.access_token;
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await authToken();
  if (!token) {
    console.debug("[keys] authedFetch: no token available — aborting fetch to", input);
    throw new Error("not-signed-in");
  }
  console.debug("[keys] authedFetch: sending", init.method ?? "GET", input, `token prefix=${token.slice(0, 12)}`);
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
  if (!res.ok) {
    const appErr = await parseErrorResponse(res);
    throw appErr ?? new Error(`save-failed:${res.status}`);
  }
  const json = (await res.json().catch(() => ({}))) as { preview?: string };
  return json.preview ?? "";
}

/** Remove a saved provider key. */
export async function deleteKey(provider: string): Promise<void> {
  const res = await authedFetch(`/api/keys?provider=${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const appErr = await parseErrorResponse(res);
    throw appErr ?? new Error(`delete-failed:${res.status}`);
  }
}
