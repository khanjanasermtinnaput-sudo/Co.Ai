// ── Admin API client ──────────────────────────────────────────────────────────
// Helper functions that call admin API routes with the current user's Bearer token.
// All functions throw on network error and return the parsed JSON on success.

import { getSupabase } from "@/lib/supabase/client";

async function getToken(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = await getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? "request-failed"), { status: res.status, data: json });
  return json;
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const adminApi = {
  users: {
    list: (params?: Record<string, string>) =>
      apiFetch(`/api/admin/users?${new URLSearchParams(params ?? {})}`),
    get: (id: string) =>
      apiFetch(`/api/admin/users/${id}`),
    update: (id: string, body: Record<string, unknown>) =>
      apiFetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) =>
      apiFetch(`/api/admin/users/${id}`, { method: "DELETE" }),
  },

  subscriptions: {
    list: (params?: Record<string, string>) =>
      apiFetch(`/api/admin/subscriptions?${new URLSearchParams(params ?? {})}`),
    grant: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/subscriptions", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      apiFetch(`/api/admin/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    revoke: (id: string) =>
      apiFetch(`/api/admin/subscriptions/${id}`, { method: "DELETE" }),
  },

  redeemCodes: {
    list: (params?: Record<string, string>) =>
      apiFetch(`/api/admin/redeem-codes?${new URLSearchParams(params ?? {})}`),
    get: (id: string) =>
      apiFetch(`/api/admin/redeem-codes/${id}`),
    create: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/redeem-codes", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      apiFetch(`/api/admin/redeem-codes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) =>
      apiFetch(`/api/admin/redeem-codes/${id}`, { method: "DELETE" }),
  },

  featureFlags: {
    list: () =>
      apiFetch("/api/admin/feature-flags"),
    create: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/feature-flags", { method: "POST", body: JSON.stringify(body) }),
    update: (key: string, body: Record<string, unknown>) =>
      apiFetch(`/api/admin/feature-flags/${key}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (key: string) =>
      apiFetch(`/api/admin/feature-flags/${key}`, { method: "DELETE" }),
  },

  analytics: {
    get: (period?: string) =>
      apiFetch(`/api/admin/analytics?period=${period ?? "30d"}`),
  },

  logs: {
    list: (params?: Record<string, string>) =>
      apiFetch(`/api/admin/logs?${new URLSearchParams(params ?? {})}`),
  },

  announcements: {
    list: (activeOnly = false) =>
      apiFetch(`/api/admin/announcements?active=${activeOnly}`),
    create: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/announcements", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      apiFetch(`/api/admin/announcements/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) =>
      apiFetch(`/api/admin/announcements/${id}`, { method: "DELETE" }),
  },

  betaAccess: {
    list: (userId?: string) =>
      apiFetch(`/api/admin/beta-access${userId ? `?userId=${userId}` : ""}`),
    grant: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/beta-access", { method: "POST", body: JSON.stringify(body) }),
    revoke: (userId: string, feature: string) =>
      apiFetch(`/api/admin/beta-access?userId=${userId}&feature=${feature}`, { method: "DELETE" }),
  },

  roles: {
    list: () =>
      apiFetch("/api/admin/roles"),
    grant: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/roles", { method: "POST", body: JSON.stringify(body) }),
    revoke: (userId: string) =>
      apiFetch(`/api/admin/roles?userId=${userId}`, { method: "DELETE" }),
  },

  apiUsage: {
    get: (period?: string, provider?: string) => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (provider) params.set("provider", provider);
      return apiFetch(`/api/admin/api-usage?${params}`);
    },
  },
};
