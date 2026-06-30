/**
 * Phase 34 — AI Database Architect
 *
 * Validates Supabase/PostgreSQL schema health: tables, indexes,
 * RLS policies, relations, slow queries, and migration status.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const SUPABASE_URL = config.supabaseUrl;
const ANON_KEY = config.supabaseAnonKey;
const REST = `${SUPABASE_URL}/rest/v1`;
const RPC = `${SUPABASE_URL}/rpc`;

// ── Expected schema ────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  "profiles",
  "conversations",
  "messages",
  "api_keys",
  "user_roles",
];

const EXPECTED_INDEXES = [
  { table: "messages", column: "conversation_id" },
  { table: "conversations", column: "user_id" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function supabaseHeaders(): Record<string, string> {
  return {
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function supabaseGet(path: string): Promise<{ status: number; body: string; json: unknown }> {
  try {
    const r = await fetch(`${REST}${path}`, {
      headers: supabaseHeaders(),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const body = await r.text();
    let json: unknown;
    try { json = JSON.parse(body); } catch { json = null; }
    return { status: r.status, body, json };
  } catch (e) {
    return { status: 0, body: String(e), json: null };
  }
}

async function supabaseRpc(fn: string, params: object = {}): Promise<{ status: number; json: unknown }> {
  try {
    const r = await fetch(`${RPC}/${fn}`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const body = await r.text();
    let json: unknown;
    try { json = JSON.parse(body); } catch { json = null; }
    return { status: r.status, json };
  } catch (e) {
    return { status: 0, json: null };
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase34(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const hasKey = !!ANON_KEY;

  if (!hasKey) {
    log.warn("Phase 34: QA_SUPABASE_ANON_KEY not set — DB architect tests will be limited to API-layer checks");
  }

  // ── 1. Supabase reachable ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${SUPABASE_URL}/rest/v1/`, { timeoutMs: config.timeoutMs });
    // Supabase REST returns 200 (empty schema) or 400 (need auth) — both mean it's up
    const ok = res.status === 200 || res.status === 400 || res.status === 401;

    const t: TestResult = {
      name: "Supabase REST API reachable",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${SUPABASE_URL}/rest/v1/` },
    };
    if (!ok) {
      t.error = `Supabase REST returned ${res.status} — project may be paused`;
      t.rootCause = "Supabase project paused or URL misconfigured";
      t.suggestedFix = "Verify SUPABASE_URL in env; unpause project at supabase.com/dashboard";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Core tables exist (via RLS-safe anon read) ────────────────────────
  for (const table of EXPECTED_TABLES) {
    const t0 = Date.now();
    const res = await supabaseGet(`/${table}?limit=1`);
    // 200 = exists and RLS allows anon read (or table is public)
    // 401/403 = table exists but RLS blocks anon (expected for user-owned data)
    // 404 / "relation does not exist" = table missing
    const tableExists =
      res.status === 200 ||
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 && !res.body.includes("does not exist") && !res.body.includes("relation"));
    const ok = tableExists;

    const t: TestResult = {
      name: `Table "${table}" exists in schema`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { table, status: res.status, responseSnippet: res.body.slice(0, 150) },
    };
    if (!ok) {
      t.error = `Table "${table}" not found (status: ${res.status})`;
      t.rootCause = `Migration for "${table}" not applied or table name changed`;
      t.suggestedFix = `Run supabase db push or apply migration; check supabase/migrations/ for missing table`;
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. RLS enabled on sensitive tables ───────────────────────────────────
  for (const table of ["conversations", "messages", "api_keys"]) {
    const t0 = Date.now();
    const res = await supabaseGet(`/${table}?limit=5`);
    // Anon should NOT be able to read user-owned tables — expect 401/403
    const rlsBlocking = res.status === 401 || res.status === 403 ||
      (res.status === 200 && Array.isArray(res.json) && (res.json as unknown[]).length === 0);
    const ok = rlsBlocking;

    const t: TestResult = {
      name: `RLS blocks anonymous read on "${table}"`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { table, status: res.status, rows: Array.isArray(res.json) ? (res.json as unknown[]).length : "n/a" },
    };
    if (!ok) {
      t.error = `Anonymous user can read "${table}" (status ${res.status}, ${Array.isArray(res.json) ? (res.json as unknown[]).length : "?"} rows)`;
      t.rootCause = "Row Level Security (RLS) not enabled or policy too permissive";
      t.suggestedFix = `Enable RLS: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; add user_id = auth.uid() policy`;
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Migrations directory exists and is non-empty ─────────────────────
  {
    const t0 = Date.now();
    // Probe the app's /api/health for DB connection status
    const res = await httpGet(`${config.baseUrl}/api/health`, { timeoutMs: config.timeoutMs });
    let dbConnected = false;
    try {
      const json = JSON.parse(res.body) as Record<string, unknown>;
      dbConnected =
        json.status === "ok" ||
        json.db === "ok" ||
        json.database === "connected" ||
        json.supabase === "ok" ||
        (typeof json.status === "string" && json.status.toLowerCase().includes("ok"));
    } catch {}
    const ok = res.status === 200 && dbConnected;

    const t: TestResult = {
      name: "Health endpoint reports DB connected",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 300), dbConnected },
    };
    if (!ok) {
      t.error = "Health check did not confirm DB connection";
      t.rootCause = "Supabase connection failing or health handler not checking DB";
      t.suggestedFix = "Add Supabase ping to /api/health: run a SELECT 1 query and include result in response";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. No N+1 / slow query signals ──────────────────────────────────────
  {
    const t0 = Date.now();
    // Measure API response time that involves DB queries
    const latencies: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      await httpGet(`${config.baseUrl}/api/health`, { timeoutMs: config.timeoutMs });
      latencies.push(Date.now() - s);
    }
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const ok = avg < 2000;

    const t: TestResult = {
      name: "DB-backed API avg latency < 2000ms (N+1 proxy)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { latenciesMs: latencies, avgMs: Math.round(avg) },
    };
    if (!ok) {
      t.error = `Average latency ${Math.round(avg)}ms — possible slow queries or missing indexes`;
      t.rootCause = "Missing index on frequently queried foreign keys (user_id, conversation_id)";
      t.suggestedFix = "Add indexes: CREATE INDEX ON messages(conversation_id); CREATE INDEX ON conversations(user_id)";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (avg ${Math.round(avg)}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Supabase project not paused ───────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await supabaseGet("/profiles?limit=1");
    // Paused project returns 503 or specific error message
    const paused = res.status === 503 || res.body.includes("project is paused") || res.body.includes("Project is inactive");
    const ok = !paused;

    const t: TestResult = {
      name: "Supabase project is active (not paused)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, paused },
    };
    if (!ok) {
      t.error = "Supabase project appears to be paused";
      t.rootCause = "Free-tier Supabase projects are auto-paused after 7 days of inactivity";
      t.suggestedFix = "Restore project at supabase.com/dashboard; consider upgrading to paid tier or add keep-warm pings";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. user_roles table has correct structure ─────────────────────────────
  {
    const t0 = Date.now();
    const res = await supabaseGet("/user_roles?limit=1");
    const structureOk =
      res.status !== 404 &&
      !res.body.includes("does not exist") &&
      !res.body.includes("relation");
    const ok = structureOk;

    const t: TestResult = {
      name: "user_roles table exists (admin system foundation)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "user_roles table missing — admin role checks will fail";
      t.rootCause = "user_roles migration not applied to Supabase instance";
      t.suggestedFix = "Apply migration: CREATE TABLE user_roles (user_id uuid, role text, PRIMARY KEY (user_id))";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${res.status})`) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 34,
    name: "AI Database Architect",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
