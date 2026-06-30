/**
 * Phase 39 — Enterprise Collaboration Engine
 *
 * Tests multi-user scenarios: session isolation, concurrent access,
 * conversation ownership, role-based access, and API key isolation.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const SUPABASE_URL = config.supabaseUrl;
const ANON_KEY = config.supabaseAnonKey;

// ── Helpers ────────────────────────────────────────────────────────────────

async function anonFetch(path: string): Promise<{ status: number; body: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    return { status: r.status, body: (await r.text()).slice(0, 500) };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase39(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Session isolation: two concurrent anon chat requests ─────────────
  {
    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
      httpPost(`${BASE}/api/chat`, { message: "User A: session test", agent: "chat" }, { timeoutMs: config.timeoutMs }),
      httpPost(`${BASE}/api/chat`, { message: "User B: session test", agent: "chat" }, { timeoutMs: config.timeoutMs }),
    ]);
    // Both must succeed independently (neither should crash the other)
    const ok = r1.status < 500 && r2.status < 500;

    const t: TestResult = {
      name: "Concurrent users: two simultaneous chat requests both succeed",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { user1Status: r1.status, user2Status: r2.status },
    };
    if (!ok) {
      t.error = `Concurrent requests failed: user1=${r1.status}, user2=${r2.status}`;
      t.rootCause = "Race condition or state leak between concurrent requests";
      t.suggestedFix = "Ensure route handlers are stateless; no shared mutable state between requests";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${r1.status}, ${r2.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Conversation ownership: anon cannot read other users' conversations
  {
    const t0 = Date.now();
    const { status, body } = await anonFetch("/conversations?limit=10");
    // Expect RLS to block or return empty — anon should get 0 rows or 401/403
    const rows = (() => { try { return JSON.parse(body); } catch { return null; } })();
    const anonRowCount = Array.isArray(rows) ? rows.length : 0;
    const blocked = status === 401 || status === 403 || (status === 200 && anonRowCount === 0);
    const ok = blocked;

    const t: TestResult = {
      name: "RLS: anonymous user cannot read other users' conversations",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, anonRowCount, body: body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Anonymous user got ${anonRowCount} conversation rows — data leak`;
      t.rootCause = "Row Level Security not restricting conversations table to owner";
      t.suggestedFix = "Add RLS policy: CREATE POLICY user_own_conversations ON conversations USING (user_id = auth.uid())";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${status}, rows: ${anonRowCount})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. API key isolation: anon cannot read others' API keys ──────────────
  {
    const t0 = Date.now();
    const { status, body } = await anonFetch("/api_keys?limit=10");
    const rows = (() => { try { return JSON.parse(body); } catch { return null; } })();
    const anonRowCount = Array.isArray(rows) ? rows.length : 0;
    const blocked = status === 401 || status === 403 || (status === 200 && anonRowCount === 0);
    const ok = blocked;

    const t: TestResult = {
      name: "RLS: anonymous user cannot read api_keys table",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, anonRowCount },
    };
    if (!ok) {
      t.error = `API keys visible to anonymous user (${anonRowCount} rows exposed)`;
      t.rootCause = "RLS not configured on api_keys table";
      t.suggestedFix = "Enable RLS: ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY; add user-scoped policy";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${status}, rows: ${anonRowCount})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Role-based access: admin endpoints require admin role ─────────────
  {
    const t0 = Date.now();
    const adminEndpoints = [
      "/api/admin/users",
      "/api/admin/analytics",
      "/api/admin/logs",
      "/api/admin/subscriptions",
    ];

    const results: Array<{ path: string; status: number; blocked: boolean }> = [];
    for (const path of adminEndpoints) {
      try {
        const r = await fetch(`${BASE}${path}`, {
          redirect: "manual",
          headers: { "User-Agent": "CoAI-Collaboration-39" },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        const loc = r.headers.get("location") ?? "";
        const blocked = r.status === 401 || r.status === 403 ||
          ((r.status === 302 || r.status === 307) && loc.includes("login"));
        results.push({ path, status: r.status, blocked });
      } catch {
        results.push({ path, status: 0, blocked: false });
      }
    }

    const allBlocked = results.every((r) => r.blocked);
    const ok = allBlocked;

    const t: TestResult = {
      name: "Role check: all admin endpoints blocked without admin session",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { results },
    };
    if (!ok) {
      const exposed = results.filter((r) => !r.blocked).map((r) => `${r.path} (${r.status})`);
      t.error = `Admin endpoints exposed: ${exposed.join(", ")}`;
      t.rootCause = "Admin route handler missing role verification";
      t.suggestedFix = "Add requireAdmin() middleware on all /api/admin/* routes checking user_roles table";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Concurrent stress: 10 simultaneous requests ───────────────────────
  {
    const t0 = Date.now();
    const N = 10;
    const promises = Array.from({ length: N }, (_, i) =>
      httpPost(`${BASE}/api/chat`, { message: `Concurrent test #${i}`, agent: "chat" }, { timeoutMs: config.timeoutMs })
    );
    const results = await Promise.all(promises);
    const crashed = results.filter((r) => r.status >= 500);
    const rateLimited = results.filter((r) => r.status === 429);
    // OK if none crash (5xx); rate limiting (429) is acceptable behavior
    const ok = crashed.length === 0;

    const t: TestResult = {
      name: `Concurrent stress: ${N} simultaneous requests — no 5xx crashes`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        total: N,
        statuses: results.map((r) => r.status),
        crashed: crashed.length,
        rateLimited: rateLimited.length,
        succeeded: results.filter((r) => r.status < 400).length,
      },
    };
    if (!ok) {
      t.error = `${crashed.length}/${N} requests returned 5xx — server crashed under concurrent load`;
      t.rootCause = "Unhandled exception or resource exhaustion under concurrent load";
      t.suggestedFix = "Add global error handler; ensure Supabase client supports concurrent connections; upgrade Render tier";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (rate-limited: ${rateLimited.length}, ok: ${results.length - crashed.length - rateLimited.length})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. CORS: cross-origin requests from allowed origins work ─────────────
  {
    const t0 = Date.now();
    let corsStatus = 0;
    let corsHeader = "";
    try {
      const r = await fetch(`${BASE}/api/health`, {
        headers: {
          "Origin": BASE,
          "User-Agent": "CoAI-Collaboration-39",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      corsStatus = r.status;
      corsHeader = r.headers.get("access-control-allow-origin") ?? "";
    } catch {}

    const ok = corsStatus === 200;

    const t: TestResult = {
      name: "CORS: same-origin request to API succeeds",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { corsStatus, corsHeader, origin: BASE },
    };
    if (!ok) {
      t.error = `Same-origin request returned ${corsStatus}`;
      t.rootCause = "CORS misconfiguration blocking legitimate same-origin requests";
      t.suggestedFix = "Check next.config.mjs cors configuration; ensure app's own origin is in allowlist";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (ACAO: ${corsHeader || "not set"})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Profile isolation: profiles table requires auth ───────────────────
  {
    const t0 = Date.now();
    const { status, body } = await anonFetch("/profiles?limit=10");
    const rows = (() => { try { return JSON.parse(body); } catch { return null; } })();
    const rowCount = Array.isArray(rows) ? rows.length : 0;
    // Profiles should be private — anon should get 401/403 or 0 rows
    const blocked = status === 401 || status === 403 || (status === 200 && rowCount === 0);
    const ok = blocked;

    const t: TestResult = {
      name: "RLS: anonymous user cannot list all user profiles",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, rowCount },
    };
    if (!ok) {
      t.error = `${rowCount} user profiles exposed to anonymous access`;
      t.rootCause = "profiles table missing RLS policy or policy too permissive";
      t.suggestedFix = "Add RLS: CREATE POLICY profiles_own ON profiles USING (id = auth.uid()); enable public read only for public profile fields";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${status}, rows: ${rowCount})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 8. Messages isolation ─────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const { status, body } = await anonFetch("/messages?limit=10");
    const rows = (() => { try { return JSON.parse(body); } catch { return null; } })();
    const rowCount = Array.isArray(rows) ? rows.length : 0;
    const blocked = status === 401 || status === 403 || (status === 200 && rowCount === 0);
    const ok = blocked;

    const t: TestResult = {
      name: "RLS: anonymous user cannot read messages table",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, rowCount },
    };
    if (!ok) {
      t.error = `${rowCount} messages exposed to anonymous users — PII leak`;
      t.rootCause = "messages table RLS policy missing or not enabled";
      t.suggestedFix = "Enable RLS on messages; restrict to owner via conversation_id JOIN conversations WHERE user_id = auth.uid()";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${status}, rows: ${rowCount})`) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 39,
    name: "Enterprise Collaboration Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
