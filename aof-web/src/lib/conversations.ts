// ── Client helper for /api/conversations ──────────────────────────────────────
// Mirrors the pattern in lib/keys.ts: auth token from Supabase session,
// graceful no-op when Supabase is not configured (offline / demo mode).

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { isSignedIn } from "@/store/auth-store";
import type { ChatMessageT, Conversation, RouteTarget } from "@/lib/types";
import type { Workspace } from "@/lib/server/workspace";

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

export interface RemoteMessage {
  id: string;
  role: string;
  content: string;
  model?: string | null;
  route_target?: string | null;
  route_label?: string | null;
  style?: string | null;
  created_at?: string;
}

/**
 * Fetch all saved messages for a conversation, oldest first.
 * Returns `null` on 404 — the conversation doesn't exist server-side yet
 * (e.g. a brand-new local conversation whose create POST hasn't landed),
 * which is a normal "nothing to hydrate" case, not a fetch failure.
 * Throws on any other non-OK response so callers can surface a real error.
 */
export async function fetchMessages(conversationId: string): Promise<RemoteMessage[] | null> {
  const res = await authedFetch(`/api/conversations/${conversationId}/messages`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch-messages-failed (${res.status})`);
  const json = (await res.json()) as { messages: RemoteMessage[] };
  return json.messages ?? [];
}

/**
 * Convert server message rows into the client's ChatMessageT shape. A pure
 * function so the reconciliation logic (chat-store's loadMessages) can be
 * unit-tested without a network/Supabase mock.
 *
 * `route_target`/`route_label` are all POST /messages ever persists (see
 * saveMessages below) — the original RouteDecision's `reason`/`confidence`
 * are never stored, so a reconstructed route always has `reason: ""`. That's
 * fine: `reason` is only ever shown as an ephemeral "why this route" hint on
 * a freshly-streamed reply, never re-displayed for history loaded from disk.
 */
export function toChatMessages(rows: RemoteMessage[]): ChatMessageT[] {
  return rows.map((m) => ({
    id: m.id,
    role: m.role as ChatMessageT["role"],
    content: m.content,
    createdAt: m.created_at ?? new Date().toISOString(),
    model: (m.model as ChatMessageT["model"]) ?? undefined,
    route:
      m.route_target && m.route_label
        ? { target: m.route_target as RouteTarget, label: m.route_label, reason: "" }
        : undefined,
  }));
}

/**
 * Reconcile a conversation's local messages against a fresh hydration from the
 * server: the server owns anything it's already saved (by id), but any local
 * message the server doesn't know about yet — a turn that's mid-stream, or one
 * whose save is still in flight or failed — is kept, appended after the saved
 * history. A plain replace here would wipe out an in-progress turn any time a
 * hydration fetch lands between conversation creation and that turn's save
 * (see chat-store's loadMessages).
 */
export function mergeServerMessages(
  localMessages: ChatMessageT[],
  serverMessages: ChatMessageT[],
): ChatMessageT[] {
  const serverIds = new Set(serverMessages.map((m) => m.id));
  const localOnly = localMessages.filter((m) => !serverIds.has(m.id));
  return [...serverMessages, ...localOnly];
}

/**
 * Fetch all conversations for the signed-in user in a workspace, newest first.
 * Throws on a non-OK response so callers can tell a real fetch failure apart
 * from a genuinely empty (but successfully loaded) list.
 */
export async function fetchConversations(workspace: Workspace = "cochat"): Promise<RemoteConversation[]> {
  const res = await authedFetch(`/api/conversations?workspace=${workspace}`);
  if (!res.ok) throw new Error(`fetch-conversations-failed (${res.status})`);
  const json = (await res.json()) as { conversations: RemoteConversation[] };
  return json.conversations ?? [];
}

/** Persist a new conversation record. */
export async function createConversation(
  conv: Pick<Conversation, "id" | "title" | "model">,
  workspace: Workspace = "cochat",
): Promise<void> {
  await authedFetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: conv.id, title: conv.title, model: conv.model, workspace }),
  });
}

/** Rename a conversation. */
export async function renameConversation(id: string, title: string, workspace: Workspace = "cochat"): Promise<void> {
  await authedFetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, workspace }),
  });
}

/** Delete a conversation and all its messages. */
export async function deleteConversationRemote(id: string, workspace: Workspace = "cochat"): Promise<void> {
  await authedFetch(`/api/conversations/${id}?workspace=${workspace}`, { method: "DELETE" });
}

/** Delete a specific set of conversations (bulk "Delete Selected"). */
export async function deleteConversationsRemote(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await authedFetch("/api/conversations", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

/** Delete every conversation in a workspace ("Delete All CoChat/CoCode History"). */
export async function deleteAllConversationsRemote(workspace: Workspace): Promise<void> {
  await authedFetch("/api/conversations", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, all: true }),
  });
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

/** Full-text search across saved messages in a workspace. Returns [] when not available. */
export async function searchMessages(q: string, limit = 10, workspace: Workspace = "cochat"): Promise<SearchHit[]> {
  if (!q.trim() || q.length < 2) return [];
  try {
    const res = await authedFetch(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}&workspace=${workspace}`);
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
      created_at: m.createdAt,
    }));

  if (!payload.length) return;

  await authedFetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: payload }),
  });
}
