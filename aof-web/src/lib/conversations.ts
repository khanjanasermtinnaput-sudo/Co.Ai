// ── Client helper for /api/conversations ──────────────────────────────────────
// Mirrors the pattern in lib/keys.ts: auth token from Supabase session,
// graceful no-op when Supabase is not configured (offline / demo mode).

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { isSignedIn } from "@/store/auth-store";
import type { ChatMessageT, Conversation } from "@/lib/types";

/**
 * Server sync is available only when Supabase is configured AND a real user is
 * signed in. Guests keep everything in localStorage (the chat-store persist
 * layer), so we must not attempt authed fetches for them — they would 401.
 */
export function conversationsEnabled(): boolean {
  return isSupabaseConfigured() && isSignedIn();
}

async function authToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  // If the access token expires within 60 seconds, proactively refresh it.
  // Supabase's autoRefreshToken timer can miss its window when the tab was idle.
  const expiresAt = (data.session.expires_at ?? 0) * 1000;
  if (Date.now() >= expiresAt - 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }
  return data.session.access_token;
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await authToken();
  if (!token) throw new Error("not-signed-in");
  return fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

export interface RemoteConversation {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

/** Fetch all conversations for the signed-in user, newest first. */
export async function fetchConversations(): Promise<RemoteConversation[]> {
  const res = await authedFetch("/api/conversations");
  if (!res.ok) return [];
  const json = (await res.json()) as { conversations: RemoteConversation[] };
  return json.conversations ?? [];
}

/** Persist a new conversation record. */
export async function createConversation(conv: Pick<Conversation, "id" | "title" | "model">): Promise<void> {
  await authedFetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: conv.id, title: conv.title, model: conv.model }),
  });
}

/** Rename a conversation. */
export async function renameConversation(id: string, title: string): Promise<void> {
  await authedFetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

/** Delete a conversation and all its messages. */
export async function deleteConversationRemote(id: string): Promise<void> {
  await authedFetch(`/api/conversations/${id}`, { method: "DELETE" });
}

export interface SearchHit {
  conversationId: string;
  conversationTitle: string;
  conversationUpdatedAt: string;
  messageId: string;
  role: "user" | "assistant";
  excerpt: string;
  createdAt: string;
}

/** Full-text search across all saved messages on the server. Returns [] when not available. */
export async function searchMessages(q: string, limit = 10): Promise<SearchHit[]> {
  if (!q.trim() || q.length < 2) return [];
  try {
    const res = await authedFetch(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { hits: SearchHit[] };
    return json.hits ?? [];
  } catch {
    return [];
  }
}

/** Persist a batch of messages for a conversation. Fire-and-forget safe. */
export async function saveMessages(conversationId: string, msgs: ChatMessageT[]): Promise<void> {
  const payload = msgs
    .filter((m) => m.role !== "system" && m.content)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model ?? undefined,
      route_target: m.route?.target ?? undefined,
      route_label: m.route?.label ?? undefined,
      style: m.style ?? undefined,
      created_at: m.createdAt,
    }));

  if (!payload.length) return;

  await authedFetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: payload }),
  });
}
