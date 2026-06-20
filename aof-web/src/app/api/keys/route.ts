// ── /api/keys ─────────────────────────────────────────────────────────────────
// Per-user AI provider keys, tied to the signed-in Google account.
//   GET    → which providers have a key + a masked preview (never the plaintext)
//   POST   → { provider, key } save/replace a key (encrypted at rest)
//   DELETE → ?provider=… remove a key
// All routes require a valid Supabase access token in the Authorization header.

import { NextResponse } from "next/server";
import {
  getAdminSupabase,
  getUserFromRequest,
  isAdminConfigured,
} from "@/lib/server/supabase-admin";
import { encryptSecret, maskKey } from "@/lib/server/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = ["openrouter", "gemini", "deepseek", "qwen", "llama"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

/** 503 when the server lacks the env it needs, 401 when the caller isn't signed in. */
async function requireUser(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "keys-backend-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { user };
}

export async function GET(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { data, error: dbErr } = await getAdminSupabase()
    .from("provider_keys")
    .select("provider, key_preview, updated_at")
    .eq("user_id", user.id);

  if (dbErr) return NextResponse.json({ error: "load-failed" }, { status: 500 });

  const keys = (data ?? []).map((r) => ({
    provider: r.provider as Provider,
    preview: r.key_preview as string,
    updatedAt: r.updated_at as string,
  }));
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  let body: { provider?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!isProvider(body.provider)) {
    return NextResponse.json({ error: "unknown-provider" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < 8) {
    return NextResponse.json({ error: "key-too-short" }, { status: 400 });
  }

  const { error: dbErr } = await getAdminSupabase()
    .from("provider_keys")
    .upsert(
      {
        user_id: user.id,
        provider: body.provider,
        encrypted_key: encryptSecret(key),
        key_preview: maskKey(key),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

  if (dbErr) return NextResponse.json({ error: "save-failed" }, { status: 500 });
  return NextResponse.json({ ok: true, provider: body.provider, preview: maskKey(key) });
}

export async function DELETE(req: Request) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const provider = new URL(req.url).searchParams.get("provider");
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "unknown-provider" }, { status: 400 });
  }

  const { error: dbErr } = await getAdminSupabase()
    .from("provider_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (dbErr) return NextResponse.json({ error: "delete-failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
