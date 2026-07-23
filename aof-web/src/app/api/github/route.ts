// ── GitHub API Proxy (Phase 4) ────────────────────────────────────────────────
// Proxies GitHub API calls from the frontend so the gh_token cookie
// never needs to be exposed to client-side JavaScript.
//
// GET  /api/github?path=/user           → GET https://api.github.com/user
// GET  /api/github?path=/user/repos     → list repos
// POST /api/github?path=/repos/...      → write ops (commit, branch, PR)

import { cookies } from "next/headers";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";

// `await`ed even though Next.js 14's `cookies()` is still synchronous today —
// it becomes async in Next.js 15, and this is the forward-compatible shape
// (awaiting a non-Promise value is valid and resolves immediately, so this
// doesn't change current behavior).
async function getToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("gh_token")?.value ?? null;
}

async function proxyGitHub(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const token = await getToken();
  if (!token) {
    return formatError("AUTH_401", { detail: "GitHub not connected" });
  }

  const ghRes = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await ghRes.json().catch(() => ({}));
  return Response.json(data, { status: ghRes.status });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path || !path.startsWith("/")) {
    return formatError("SYSTEM_500", { message: "Missing or invalid path", detail: "missing-or-invalid-path" }, 400);
  }
  // Forward any query params that aren't "path"
  const forwardParams = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== "path") forwardParams.set(k, v);
  }
  const fullPath = forwardParams.size ? `${path}?${forwardParams}` : path;
  return proxyGitHub(fullPath, "GET");
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return formatError("SYSTEM_500", { message: "Missing path", detail: "missing-path" }, 400);
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, "POST", body);
}

export async function PUT(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return formatError("SYSTEM_500", { message: "Missing path", detail: "missing-path" }, 400);
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, "PUT", body);
}

export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return formatError("SYSTEM_500", { message: "Missing path", detail: "missing-path" }, 400);
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, "DELETE", body);
}

// ── GitHub OAuth connect initiation ──────────────────────────────────────────
export async function PATCH(req: Request): Promise<Response> {
  // PATCH /api/github → returns the OAuth URL to redirect to
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return formatError("API_500", { detail: "GITHUB_CLIENT_ID not configured on server" }, 501);
  }
  const state = crypto.randomUUID();
  // Falls back to the request's own origin so this still works when
  // NEXT_PUBLIC_SITE_URL isn't set — an empty-string prefix would produce a
  // relative redirect_uri, which GitHub rejects as invalid.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const redirectUri = `${origin}/api/github/callback`;
  const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user&state=${state}`;
  return Response.json({ url: oauthUrl, state });
}

// Disconnect — actually clear the httpOnly cookie server-side. (The client can't
// do this itself via document.cookie; JS can't overwrite an httpOnly cookie.)
export async function OPTIONS(): Promise<Response> {
  const jar = await cookies();
  jar.set("gh_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return Response.json({ ok: true });
}
