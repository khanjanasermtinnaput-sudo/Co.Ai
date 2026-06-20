// ── /api/auth/check ───────────────────────────────────────────────────────────
// Safe diagnostics-only endpoint. Never returns secrets.
// Returns why a token is accepted or rejected so 401 failures can be diagnosed
// without needing access to server logs.

import { NextResponse } from "next/server";
import { isAdminConfigured, getAdminSupabase } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasMasterKey = Boolean(
    process.env.COAGENTIX_MASTER_KEY || process.env.AOF_MASTER_KEY,
  );

  const configured = isAdminConfigured();

  if (!configured) {
    return NextResponse.json({
      ok: false,
      stage: "server-config",
      error: "Supabase admin not configured",
      details: {
        supabaseUrl: supabaseUrl ? `${supabaseUrl.slice(0, 20)}…` : null,
        hasServiceKey,
        hasMasterKey,
      },
    });
  }

  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({
      ok: false,
      stage: "token-missing",
      error: "No Bearer token in Authorization header",
      details: { supabaseUrl: `${supabaseUrl!.slice(0, 20)}…`, hasServiceKey, hasMasterKey },
    });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return NextResponse.json({
      ok: false,
      stage: "token-empty",
      error: "Authorization header present but token is empty",
    });
  }

  const { data, error } = await getAdminSupabase().auth.getUser(token);

  if (error) {
    return NextResponse.json({
      ok: false,
      stage: "token-invalid",
      error: error.message,
      supabaseStatus: error.status,
      tokenPrefix: token.slice(0, 12),
      details: { supabaseUrl: `${supabaseUrl!.slice(0, 20)}…` },
    });
  }

  if (!data.user) {
    return NextResponse.json({
      ok: false,
      stage: "token-no-user",
      error: "getUser returned no user and no error",
    });
  }

  return NextResponse.json({
    ok: true,
    stage: "authenticated",
    userId: data.user.id,
    email: data.user.email,
    tokenPrefix: token.slice(0, 12),
    details: { supabaseUrl: `${supabaseUrl!.slice(0, 20)}…`, hasServiceKey, hasMasterKey },
  });
}
