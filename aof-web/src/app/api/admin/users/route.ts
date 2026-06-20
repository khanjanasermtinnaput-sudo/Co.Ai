// ── /api/admin/users ──────────────────────────────────────────────────────────
// GET - List all users with pagination, search, and filtering.
// Accessible by OWNER, ADMIN, STAFF.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getCallerRole(userId: string): Promise<string> {
  const { data } = await getAdminSupabase()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  return data?.role ?? "USER";
}

async function requireAdminUser(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "admin-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = await getCallerRole(user.id);
  if (!["OWNER", "ADMIN", "STAFF"].includes(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, role };
}

export async function GET(req: Request) {
  const { user: _user, role: _role, error } = await requireAdminUser(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get("page")  ?? "1", 10));
  const limit   = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const search  = searchParams.get("search")?.trim().toLowerCase() ?? "";
  const roleFilter = searchParams.get("role")?.toUpperCase() ?? "";
  const planFilter = searchParams.get("plan")?.toUpperCase() ?? "";
  const statusFilter = searchParams.get("status")?.toLowerCase() ?? ""; // "active" | "banned"

  const supabase = getAdminSupabase();

  // ── Fast path (P-1): server-side filtering + pagination via RPC. ─────────────
  // Falls back to the in-memory path below if the migration (0007) isn't applied
  // yet or the function errors, so deploys never break the admin panel.
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_list_users", {
      p_search: search,
      p_role: roleFilter,
      p_plan: planFilter,
      p_status: statusFilter,
      p_page: page,
      p_limit: limit,
    });
    if (!rpcErr && rpcData) {
      const payload = rpcData as {
        users: Array<{
          id: string; email: string | null; name: string | null; avatar_url: string | null;
          role: string; role_expires_at: string | null; plan: string; plan_expires_at: string | null;
          banned_until: string | null; created_at: string; last_sign_in_at: string | null;
        }>;
        total: number;
      };
      const users = (payload.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        avatarUrl: u.avatar_url,
        role: u.role,
        roleExpiresAt: u.role_expires_at,
        plan: u.plan,
        planExpiresAt: u.plan_expires_at,
        bannedUntil: u.banned_until,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at,
      }));
      const total = payload.total ?? users.length;
      return NextResponse.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    // rpcErr set (e.g. function missing) → fall through to the in-memory path.
  } catch {
    // Network/unexpected error → fall through to the in-memory path.
  }

  // Fetch all users from auth.admin (Supabase paginates with per_page/page)
  // We load a large batch and filter client-side because auth.admin doesn't
  // support arbitrary SQL filters. For very large user bases this should be
  // replaced with a DB view + RPC.
  let allUsers: import("@supabase/supabase-js").User[] = [];
  let fetchPage = 1;
  const BATCH = 1000;
  while (true) {
    const { data, error: listErr } = await supabase.auth.admin.listUsers({
      page: fetchPage,
      perPage: BATCH,
    });
    if (listErr) {
      return NextResponse.json({ error: "failed-to-list-users", detail: listErr.message }, { status: 500 });
    }
    if (!data?.users?.length) break;
    allUsers = allUsers.concat(data.users);
    if (data.users.length < BATCH) break;
    fetchPage++;
  }

  // Fetch all elevated roles in one query
  const { data: rolesData } = await supabase
    .from("user_roles")
    .select("user_id, role, expires_at");
  const roleMap = new Map<string, { role: string; expires_at: string | null }>(
    (rolesData ?? []).map((r) => [r.user_id, { role: r.role, expires_at: r.expires_at }])
  );

  // Fetch active subscriptions
  const { data: subsData } = await supabase
    .from("subscriptions")
    .select("user_id, plan, expires_at")
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  const subMap = new Map<string, { plan: string; expires_at: string | null }>();
  for (const s of subsData ?? []) {
    if (!subMap.has(s.user_id)) {
      subMap.set(s.user_id, { plan: s.plan, expires_at: s.expires_at });
    }
  }

  // Apply filters
  let filtered = allUsers.filter((u) => {
    const email = (u.email ?? "").toLowerCase();
    const name  = ((u.user_metadata?.name as string) ?? "").toLowerCase();
    if (search && !email.includes(search) && !name.includes(search) && !u.id.includes(search)) {
      return false;
    }
    if (roleFilter) {
      const r = roleMap.get(u.id)?.role ?? "USER";
      if (r !== roleFilter) return false;
    }
    if (planFilter) {
      const plan = subMap.get(u.id)?.plan ?? (u.app_metadata?.tier as string | undefined) ?? "FREE";
      if (plan !== planFilter) return false;
    }
    if (statusFilter === "banned") {
      if (!(u as { banned_until?: string }).banned_until) return false;
    } else if (statusFilter === "active") {
      if ((u as { banned_until?: string }).banned_until) return false;
    }
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  filtered = filtered.slice((page - 1) * limit, page * limit);

  const users = filtered.map((u) => {
    const roleEntry = roleMap.get(u.id);
    const subEntry  = subMap.get(u.id);
    return {
      id:           u.id,
      email:        u.email ?? null,
      name:         (u.user_metadata?.name as string | null) ?? null,
      avatarUrl:    (u.user_metadata?.avatar_url as string | null) ?? null,
      role:         roleEntry?.role ?? "USER",
      roleExpiresAt: roleEntry?.expires_at ?? null,
      plan:         subEntry?.plan ?? (u.app_metadata?.tier as string | undefined) ?? "FREE",
      planExpiresAt: subEntry?.expires_at ?? null,
      bannedUntil:  (u as { banned_until?: string }).banned_until ?? null,
      createdAt:    u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
    };
  });

  return NextResponse.json({ users, total, page, limit, totalPages });
}
