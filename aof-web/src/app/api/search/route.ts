// ── /api/search ───────────────────────────────────────────────────────────────
// GET ?q=<query>&limit=<n>
// Full-text search across the authenticated user's messages + conversations.
// Uses Postgres FTS (tsvector/tsquery) — server-side, covers ALL history,
// not just the 20 messages cached in localStorage.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { checkRateLimit, applyRateLimitHeaders } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SearchHit {
  conversationId: string;
  conversationTitle: string;
  conversationUpdatedAt: string;
  messageId: string;
  role: "user" | "assistant";
  excerpt: string;
  createdAt: string;
}

const MAX_RESULTS = 20;
const EXCERPT_LEN = 160;

function excerpt(content: string, query: string): string {
  const lower = content.toLowerCase();
  const q = query.toLowerCase().split(/\s+/).find((w) => lower.includes(w));
  if (!q) return content.slice(0, EXCERPT_LEN);
  const idx = lower.indexOf(q);
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + EXCERPT_LEN - 60);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

export async function GET(req: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rl = await checkRateLimit(user.id, "search");
  if (!rl.allowed) {
    const headers = new Headers({ "Content-Type": "application/json" });
    applyRateLimitHeaders(headers, rl);
    return new NextResponse(JSON.stringify({ error: "rate-limited" }), { status: 429, headers });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10), MAX_RESULTS);

  if (q.length < 2) return NextResponse.json({ hits: [] });

  // Build a websearch-style tsquery that handles multi-word phrases gracefully
  const tsquery = q
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w}:*`)   // prefix matching — "react" also matches "reactjs"
    .join(" & ");

  if (!tsquery) return NextResponse.json({ hits: [] });

  const supabase = getAdminSupabase();

  // FTS query via the convenience view, filtered to this user
  const { data, error } = await supabase
    .from("conversation_search_v")
    .select(
      "message_id, conversation_id, conversation_title, conversation_updated_at, role, content, created_at",
    )
    .eq("user_id", user.id)
    .textSearch("search_vector", tsquery, { type: "plain" })
    .order("conversation_updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Fall back to ilike if FTS fails (e.g. index not ready yet)
    const { data: fallback, error: fallbackErr } = await supabase
      .from("conversation_search_v")
      .select(
        "message_id, conversation_id, conversation_title, conversation_updated_at, role, content, created_at",
      )
      .eq("user_id", user.id)
      .ilike("content", `%${q}%`)
      .order("conversation_updated_at", { ascending: false })
      .limit(limit);

    if (fallbackErr || !fallback) return NextResponse.json({ hits: [] });

    const hits: SearchHit[] = fallback.map((r) => ({
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      conversationUpdatedAt: r.conversation_updated_at,
      messageId: r.message_id,
      role: r.role as "user" | "assistant",
      excerpt: excerpt(r.content ?? "", q),
      createdAt: r.created_at,
    }));
    return NextResponse.json({ hits });
  }

  const hits: SearchHit[] = (data ?? []).map((r) => ({
    conversationId: r.conversation_id,
    conversationTitle: r.conversation_title,
    conversationUpdatedAt: r.conversation_updated_at,
    messageId: r.message_id,
    role: r.role as "user" | "assistant",
    excerpt: excerpt(r.content ?? "", q),
    createdAt: r.created_at,
  }));

  return NextResponse.json({ hits });
}
