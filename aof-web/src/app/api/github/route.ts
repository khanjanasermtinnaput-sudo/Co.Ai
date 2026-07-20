// ── GitHub API Proxy (Phase 4) ────────────────────────────────────────────────
// Proxies GitHub API calls from the frontend so the gh_token cookie
// never needs to be exposed to client-side JavaScript.
//
// GET  /api/github?path=/user           → GET https://api.github.com/user
// GET  /api/github?path=/user/repos     → list repos
// POST /api/github?path=/repos/...      → write ops (commit, branch, PR)

import { cookies } from "next/headers";

export const runtime = "nodejs";

function getToken(): string | null {
  const jar = cookies();
  return jar.get("gh_token")?.value ?? null;
}

async function proxyGitHub(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const token = getToken();
  if (!token) {
    return Response.json({ error: "GitHub not connected" }, { status: 401 });
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
    return Response.json({ error: "Missing or invalid path" }, { status: 400 });
  }
  // Forward any query params that aren't "path"
  const forwardParams = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== "path") forwardParams.set(k, v);
  }
  const fullPath = forwardParams.size ? `${path}?${forwardParams}` : path;
  return proxyGitHub(fullPath, "GET");
}

async function proxyWithBody(req: Request, method: string): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path || !path.startsWith("/")) {
    return Response.json({ error: "Missing or invalid path" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, method, body);
}

export async function POST(req: Request): Promise<Response> {
  return proxyWithBody(req, "POST");
}

export async function PUT(req: Request): Promise<Response> {
  return proxyWithBody(req, "PUT");
}

export async function DELETE(req: Request): Promise<Response> {
  return proxyWithBody(req, "DELETE");
}

// ── GitHub OAuth connect initiation (and PATCH proxy) ────────────────────────
export async function PATCH(req: Request): Promise<Response> {
  // PATCH /api/github?path=/... → proxied GitHub PATCH (e.g. updating a git
  // ref during an atomic multi-file push). Without ?path=, PATCH initiates
  // the OAuth flow and returns the URL to redirect to.
  const url = new URL(req.url);
  if (url.searchParams.get("path")) {
    return proxyWithBody(req, "PATCH");
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: "GITHUB_CLIENT_ID not configured on server" },
      { status: 501 },
    );
  }
  const state = crypto.randomUUID();
  // Falls back to the request's own origin so this still works when
  // NEXT_PUBLIC_SITE_URL isn't set — an empty-string prefix would produce a
  // relative redirect_uri, which GitHub rejects as invalid.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const redirectUri = `${origin}/api/github/callback`;
  const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user&state=${state}`;
  // Persist the CSRF state so the callback can verify GitHub echoed it back.
  const jar = cookies();
  jar.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // the OAuth round-trip should take minutes, not hours
    path: "/",
  });
  return Response.json({ url: oauthUrl, state });
}

// Disconnect — actually clear the httpOnly cookie server-side. (The client can't
// do this itself via document.cookie; JS can't overwrite an httpOnly cookie.)
export async function OPTIONS(): Promise<Response> {
  const jar = cookies();
  jar.set("gh_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return Response.json({ ok: true });
}
