// ── /api/cli/devices ──────────────────────────────────────────────────────────
// Active CLI session (device) management.
//   GET    → list active devices (sessions) for the signed-in user
//   DELETE → logout all CLI sessions

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured, tierForUser } from "@/lib/server/supabase-admin";
import { hasFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdvanced(req: Request) {
  if (!isAdminConfigured()) {
    return {
      error: NextResponse.json(
        {
          error: "backend-not-configured",
          message:
            "CLI sessions are unavailable: this deployment is missing its Supabase admin configuration (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Ask the site operator to set them.",
        },
        { status: 503 },
      ),
    };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  // Mirrors /api/cli/token: tierForUser + hasFeature("cli"), so CLI access is
  // lenient while plan enforcement is off and ADVANCED-gated once it's on.
  if (!hasFeature(tierForUser(user), "cli")) {
    return { error: NextResponse.json({ error: "advanced-required" }, { status: 403 }) };
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

  if (dbErr) return NextResponse.json({ error: "load-failed" }, { status: 500 });

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

  if (dbErr) return NextResponse.json({ error: "logout-failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
