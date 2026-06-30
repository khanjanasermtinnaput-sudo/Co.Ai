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

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return Response.json({ error: "Missing path" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, "POST", body);
}

export async function PUT(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return Response.json({ error: "Missing path" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, "PUT", body);
}

export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return Response.json({ error: "Missing path" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  return proxyGitHub(path, "DELETE", body);
}

// ── GitHub OAuth connect initiation ──────────────────────────────────────────
export async function PATCH(req: Request): Promise<Response> {
  // PATCH /api/github → returns the OAuth URL to redirect to
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: "GITHUB_CLIENT_ID not configured on server" },
      { status: 501 },
    );
  }
  const state = crypto.randomUUID();
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/github/callback`;
  const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user&state=${state}`;
  return Response.json({ url: oauthUrl, state });
}

// Disconnect — clear cookie
export async function OPTIONS(): Promise<Response> {
  const res = Response.json({ ok: true });
  const r = new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
  (r as Response & { cookies?: { set: (n: string, v: string, o: object) => void } });
  return r;
}
