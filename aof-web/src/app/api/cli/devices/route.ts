// ── /api/cli/devices ──────────────────────────────────────────────────────────
// Active CLI session (device) management.
//   GET    → list active devices (sessions) for the signed-in user
//   DELETE → logout all CLI sessions

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured, tierForUser } from "@/lib/server/supabase-admin";
import { hasFeature } from "@/lib/plans";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdvanced(req: Request) {
  if (!isAdminConfigured()) {
    return {
      error: formatError(
        "API_500",
        {
          detail:
            "backend-not-configured: CLI sessions are unavailable: this deployment is missing its Supabase admin configuration (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Ask the site operator to set them.",
        },
        503,
      ),
    };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: formatError("AUTH_401", { detail: "unauthorized" }) };
  }
  // Mirrors /api/cli/token: tierForUser + hasFeature("cli"), so CLI access is
  // lenient while plan enforcement is off and ADVANCED-gated once it's on.
  if (!hasFeature(tierForUser(user), "cli")) {
    return { error: formatError("AUTH_403", { detail: "advanced-required" }) };
  }
  return { user };
}

export async function GET(req: Request) {
  const { user, error } = await requireAdvanced(req);
  if (error) return error;

  const { data, error: dbErr } = await getAdminSupabase()
    .from("cli_sessions")
    .select("id, device_name, ip_address, created_at, last_active_at")
    .eq("user_id", user.id)
    .order("last_active_at", { ascending: false })
    .limit(20);

  if (dbErr) return formatError("DB_500", { detail: "load-failed: " + dbErr.message });

  return NextResponse.json({
    devices: (data ?? []).map((d) => ({
      id: d.id,
      name: d.device_name ?? "Unknown device",
      ip: d.ip_address,
      createdAt: d.created_at,
      lastActiveAt: d.last_active_at,
    })),
  });
}

export async function DELETE(req: Request) {
  const { user, error } = await requireAdvanced(req);
  if (error) return error;

  const { error: dbErr } = await getAdminSupabase()
    .from("cli_sessions")
    .delete()
    .eq("user_id", user.id);

  if (dbErr) return formatError("DB_500", { detail: "logout-failed: " + dbErr.message });

  return NextResponse.json({ ok: true });
}
