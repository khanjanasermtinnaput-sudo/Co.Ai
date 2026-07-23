// ── Co.AI Referral API ─────────────────────────────────────────────────────────
// GET  /api/referral        → fetch or create the caller's referral code + stats
// POST /api/referral/click  → record an anonymous click (called on landing page)
// POST /api/referral/convert → record a successful signup via referral code

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getUserFromRequest, getAdminSupabase, isAdminConfigured } from "@/lib/server/supabase-admin";
import { checkRateLimit, applyRateLimitHeaders } from "@/lib/server/rate-limit";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function generateCode(): string {
  return randomBytes(5).toString("base64url").toUpperCase().slice(0, 8);
}

// GET — return (or lazily create) the caller's referral code + lifetime stats
export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req).catch(() => null);
  if (!user) {
    return formatError("AUTH_401", { detail: "Authentication required" });
  }

  const rl = await checkRateLimit(user.id, "api");
  if (!rl.allowed) {
    const res = formatError("API_429", { detail: "Rate limit exceeded" });
    applyRateLimitHeaders(res.headers, rl);
    return res;
  }

  if (!isAdminConfigured()) {
    return formatError("API_500", { detail: "Database not configured" }, 503);
  }

  const supabase = getAdminSupabase();

  // Fetch existing code
  const { data: existing } = await supabase
    .from("referral_codes")
    .select("code, total_clicks, total_signups, created_at")
    .eq("owner_id", user.id)
    .single();

  if (existing) {
    const { data: conversions } = await supabase
      .from("referral_conversions")
      .select("id, converted_at, reward_granted")
      .eq("referrer_id", user.id)
      .order("converted_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      code: existing.code,
      referralUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://coagentix.app"}/?ref=${existing.code}`,
      stats: {
        clicks: existing.total_clicks,
        signups: existing.total_signups,
        rewardsGranted: (conversions ?? []).filter((c) => c.reward_granted).length,
      },
      recentConversions: conversions ?? [],
    });
  }

  // Create a new code (unique — retry on collision)
  let code = generateCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase
      .from("referral_codes")
      .insert({ owner_id: user.id, code });
    if (!error) break;
    code = generateCode();
  }

  return NextResponse.json({
    code,
    referralUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://coagentix.app"}/?ref=${code}`,
    stats: { clicks: 0, signups: 0, rewardsGranted: 0 },
    recentConversions: [],
  });
}

// POST — record a click (unauthenticated, rate-limited by IP)
export async function POST(req: Request): Promise<Response> {
  const ip = (req.headers.get("x-forwarded-for") ?? "anon").split(",")[0].trim();
  const rl = await checkRateLimit(ip, "api");
  if (!rl.allowed) {
    return formatError("API_429", { detail: "Rate limit exceeded" });
  }

  if (!isAdminConfigured()) return NextResponse.json({ ok: true });

  let body: { action?: string; code?: string };
  try { body = await req.json(); } catch { return formatError("SYSTEM_500", { message: "Invalid JSON", detail: "invalid-json-body" }, 400); }

  const { action, code } = body;
  if (!code || typeof code !== "string" || !/^[A-Z0-9]{6,12}$/.test(code)) {
    return formatError("SYSTEM_500", { message: "Invalid referral code format", detail: "invalid-referral-code-format" }, 400);
  }

  const supabase = getAdminSupabase();

  if (action === "click") {
    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null;
    await supabase.rpc("record_referral_click", { p_code: code, p_ip_hash: ipHash, p_ua: ua });
    return NextResponse.json({ ok: true });
  }

  if (action === "convert") {
    const user = await getUserFromRequest(req).catch(() => null);
    if (!user) return formatError("AUTH_401", { detail: "Authentication required" });
    await supabase.rpc("record_referral_conversion", { p_code: code, p_invitee: user.id });
    return NextResponse.json({ ok: true });
  }

  return formatError("SYSTEM_500", { message: "Unknown action", detail: "unknown-action" }, 400);
}
