// ── /api/image/memories — Image Memory Management ─────────────────────────────
// GET  ?q=<query>  → search or list memories from server (tmap-v2 or stub)
// DELETE            → clear all image memories for this user

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/supabase-admin";

const TMAP_URL = process.env.NEXT_PUBLIC_TMAP_URL ?? process.env.TMAP_URL ?? "";

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (TMAP_URL) {
    const tmapToken = req.cookies.get("tmap_token")?.value
      ?? req.headers.get("x-tmap-token") ?? "";
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const limit = req.nextUrl.searchParams.get("limit") ?? "50";
    try {
      const res = await fetch(
        `${TMAP_URL}/v1/image/memories?q=${encodeURIComponent(q)}&limit=${limit}`,
        { headers: tmapToken ? { Authorization: `Bearer ${tmapToken}` } : {} },
      );
      return NextResponse.json(await res.json(), { status: res.ok ? 200 : res.status });
    } catch {
      return NextResponse.json({ memories: [] });
    }
  }

  // Without tmap-v2 the authoritative store is the client's localStorage;
  // this endpoint returns an empty list (client already has the data locally).
  return NextResponse.json({ memories: [] });
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (TMAP_URL) {
    const tmapToken = req.cookies.get("tmap_token")?.value
      ?? req.headers.get("x-tmap-token") ?? "";
    try {
      await fetch(`${TMAP_URL}/v1/image/memories`, {
        method: "DELETE",
        headers: tmapToken ? { Authorization: `Bearer ${tmapToken}` } : {},
      });
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true });
}
