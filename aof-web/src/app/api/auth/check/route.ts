// ── /api/auth/check ───────────────────────────────────────────────────────────
// Safe diagnostics-only endpoint. Never returns secrets.
// Returns why a token is accepted or rejected so AUTH-401 failures can be
// diagnosed without needing access to server logs.

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
  const serverConfig = {
    supabaseUrl: supabaseUrl ? `${supabaseUrl.slice(0, 30)}…` : null,
    hasServiceKey,
    hasMasterKey,
    adminConfigured: configured,
  };

  if (!configured) {
    return NextResponse.json({
      authenticated: false,
      failedStage: "server-config",
      reason: "Supabase admin not configured — missing SUPABASE_SERVICE_ROLE_KEY",
      serverConfig,
    });
  }

  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const tokenExists = Boolean(header?.startsWith("Bearer "));

  if (!tokenExists) {
    return NextResponse.json({
      authenticated: false,
      failedStage: "token-missing",
      reason: "No Bearer token in Authorization header",
      serverConfig,
    });
  }

  const token = header!.slice(7).trim();
  if (!token) {
    return NextResponse.json({
      authenticated: false,
      failedStage: "token-empty",
      reason: "Authorization header present but token is empty",
      serverConfig,
    });
  }

  const tokenPrefix = token.slice(0, 16);
  const { data, error } = await getAdminSupabase().auth.getUser(token);

  if (error) {
    console.error("[/api/auth/check] token rejected:", error.message, { tokenPrefix });
    return NextResponse.json({
      authenticated: false,
      failedStage: "token-invalid",
      reason: error.message,
      supabaseErrorStatus: error.status,
      tokenPrefix,
      serverConfig,
    });
  }

  if (!data.user) {
    return NextResponse.json({
      authenticated: false,
      failedStage: "token-no-user",
      reason: "getUser returned no user and no error — unexpected Supabase state",
      tokenPrefix,
      serverConfig,
    });
  }

  const user = data.user;

  return NextResponse.json({
    authenticated: true,
    stage: "authenticated",
    userId: user.id,
    email: user.email,
    emailConfirmed: user.email_confirmed_at != null,
    provider: user.app_metadata?.provider ?? "unknown",
    lastSignIn: user.last_sign_in_at,
    tokenPrefix,
    serverConfig,
  });
}
