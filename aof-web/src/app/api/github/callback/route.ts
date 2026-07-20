// ── GitHub OAuth Callback (Phase 4) ──────────────────────────────────────────
// Exchanges GitHub OAuth code for an access token, stores it in a secure
// httpOnly cookie, and redirects back to the CoCode workspace.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

/** Expire the one-shot CSRF state cookie (used or not, it's done after this hit). */
function clearStateCookie(res: NextResponse): NextResponse {
  res.cookies.set("gh_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(
      new URL("/code?error=github_no_code", url.origin),
    );
  }

  // CSRF check: the state GitHub echoes back must match the one we set as a
  // cookie when the flow started (route.ts PATCH). A mismatch means this
  // callback wasn't initiated by our own connect button.
  const expectedState = cookies().get("gh_oauth_state")?.value ?? null;
  if (!expectedState || state !== expectedState) {
    return clearStateCookie(
      NextResponse.redirect(new URL("/code?error=github_bad_state", url.origin)),
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/code?error=github_not_configured", url.origin),
    );
  }

  try {
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    );

    const data = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!data.access_token) {
      return clearStateCookie(NextResponse.redirect(
        new URL(`/code?error=github_${data.error ?? "token_failed"}`, url.origin),
      ));
    }

    // Store token in httpOnly cookie (7-day expiry)
    const response = NextResponse.redirect(
      new URL("/code?github=connected", url.origin),
    );
    response.cookies.set("gh_token", data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return clearStateCookie(response);
  } catch {
    return clearStateCookie(NextResponse.redirect(
      new URL("/code?error=github_network", url.origin),
    ));
  }
}
