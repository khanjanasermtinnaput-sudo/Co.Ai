import { type NextRequest, NextResponse } from "next/server";
// randomUUID is available in both Node.js and Edge runtimes

import { createServerClient } from "@supabase/ssr";
import { assessBotRisk } from "@/lib/server/bot-protection";

// Routes that require a valid Supabase session.
const PROTECTED_PREFIXES = ["/admin", "/api/admin"];

// Routes that require an elevated admin role (checked client-side too, but
// this middleware is the last line of defense before the page renders).
const ADMIN_REQUIRED_PREFIXES = ["/admin", "/api/admin"];

// ── CSRF: state-mutating API routes that must verify the request origin ───────
// Browser CORS policy prevents cross-origin reads, but form-based POST requests
// can still be sent cross-origin. We verify the Origin (or Referer) header on
// all non-GET /api/ mutations so that a stolen Bearer token alone is not enough
// to forge a write from a third-party site.
const CSRF_PROTECTED_PREFIXES = ["/api/"];
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isTrustedOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return true; // server-to-server (no Origin header)
  try {
    const req = new URL(requestUrl);
    const org = new URL(origin);
    // Allow same host (covers localhost, staging, and prod with custom domain)
    if (org.host === req.host) return true;
    // Allow explicitly configured origins (e.g. a separate mobile/desktop client)
    const allowed = (process.env.NEXT_PUBLIC_COAGENTIX_ALLOWED_ORIGINS ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    return allowed.includes(origin);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Correlation ID ─────────────────────────────────────────────────────────
  // Propagate or generate a correlation ID so every response and downstream
  // log line can be traced back to the originating request.
  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const requestId = crypto.randomUUID();

  // ── Bot protection ─────────────────────────────────────────────────────────
  // Score-based heuristic check on API mutations. Skip CSP report (sent by
  // browser with unusual headers) and same-origin / server-to-server calls.
  const BOT_SKIP = /^\/api\/(csp-report|health)/;
  if (
    pathname.startsWith("/api/") &&
    !CSRF_SAFE_METHODS.has(request.method) &&
    !BOT_SKIP.test(pathname)
  ) {
    const risk = assessBotRisk(request as unknown as Request);
    if (risk.blocked) {
      return new NextResponse(
        JSON.stringify({ error: "forbidden", code: "BOT_DETECTED" }),
        {
          status: 403,
          headers: {
            "Content-Type":     "application/json",
            "X-Correlation-ID": correlationId,
            "X-Bot-Score":      risk.score.toString(),
          },
        },
      );
    }
  }

  // ── CSRF check ─────────────────────────────────────────────────────────────
  // Reject state-mutating requests from untrusted cross-origin pages.
  if (
    CSRF_PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !CSRF_SAFE_METHODS.has(request.method)
  ) {
    const origin = request.headers.get("origin");
    if (!isTrustedOrigin(origin, request.url)) {
      return new NextResponse(
        JSON.stringify({ error: "forbidden", message: "Cross-origin request rejected" }),
        {
          status: 403,
          headers: {
            "Content-Type":     "application/json",
            "X-Correlation-ID": correlationId,
            "X-Request-ID":     requestId,
          },
        },
      );
    }
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) {
    const res = NextResponse.next();
    res.headers.set("X-Correlation-ID", correlationId);
    res.headers.set("X-Request-ID",     requestId);
    return res;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase is not configured let the request through so local dev works.
  if (!supabaseUrl || !supabaseAnonKey) {
    const res = NextResponse.next();
    res.headers.set("X-Correlation-ID", correlationId);
    res.headers.set("X-Request-ID",     requestId);
    return res;
  }

  const response = NextResponse.next({
    request: { headers: new Headers({ ...Object.fromEntries(request.headers), "x-correlation-id": correlationId }) },
  });
  response.headers.set("X-Correlation-ID", correlationId);
  response.headers.set("X-Request-ID",     requestId);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated — redirect to login.
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // For admin routes also verify an elevated role exists in the DB.
  const isAdminRoute = ADMIN_REQUIRED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isAdminRoute) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      const { createClient } = await import("@supabase/supabase-js");
      const adminClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      const ELEVATED = new Set(["OWNER", "ADMIN", "STAFF"]);
      if (!roleRow || !ELEVATED.has(roleRow.role as string)) {
        // Authenticated but not an admin — return 403 for API calls, redirect for pages.
        if (pathname.startsWith("/api/")) {
          return new NextResponse(
            JSON.stringify({ error: "forbidden", message: "Insufficient role" }),
            { status: 403, headers: { "Content-Type": "application/json", "X-Correlation-ID": correlationId } },
          );
        }
        return NextResponse.redirect(new URL("/?error=forbidden", request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};
