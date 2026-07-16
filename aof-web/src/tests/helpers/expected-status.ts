// ── Declarative per-route expectations ────────────────────────────────────────
// What each API route is documented/verified to return, unauthenticated, in
// THIS environment (no LLM provider keys, no Supabase keys configured in
// aof-web/.env.local). Verified directly against each route's source before
// being encoded here — see the plan doc for the file-by-file trace. Kept as
// plain data so the test file itself stays declarative.

export interface RouteCase {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string; // relative to baseUrl, may include a query string
  body?: unknown;
  expectedStatus: number[]; // any one of these counts as pass
}

// ── Public / no-auth-required routes ──────────────────────────────────────────
// Idempotent, no side effects, no shared quota — safe to loop 10x.
export const PUBLIC_CASES: RouteCase[] = [
  { name: "GET /api/health", method: "GET", path: "/api/health", expectedStatus: [200] },
  { name: "GET /api/auth/check", method: "GET", path: "/api/auth/check", expectedStatus: [200] },
  {
    name: "POST /api/repo/analyze",
    method: "POST",
    path: "/api/repo/analyze",
    body: { files: [{ path: "package.json", content: '{"name":"x","dependencies":{"react":"18.0.0"}}' }] },
    expectedStatus: [200],
  },
  {
    name: "POST /api/apply",
    method: "POST",
    path: "/api/apply",
    body: {
      diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-line1\n+lineOne\n line2\n",
      files: [{ path: "a.txt", content: "line1\nline2\n" }],
      acceptAll: true,
    },
    expectedStatus: [200],
  },
  {
    name: "POST /api/refactor (rename-symbol, non-AI)",
    method: "POST",
    path: "/api/refactor",
    body: {
      kind: "rename-symbol",
      file: { path: "a.ts", content: "const foo = 1; console.log(foo);" },
      symbol: { name: "foo", newName: "bar" },
    },
    expectedStatus: [200],
  },
  { name: "GET /api/github?path=/user (no cookie)", method: "GET", path: "/api/github?path=/user", expectedStatus: [401] },
];

// ── Direct 401 group ───────────────────────────────────────────────────────────
// Routes that call getUserFromRequest with no isAdminConfigured() gate first —
// verified to return null (not throw) with no Authorization header, so these
// are always a clean 401 regardless of Supabase configuration. All idempotent,
// no side effects — safe to loop 10x.
export const DIRECT_401_CASES: RouteCase[] = [
  { name: "GET /api/ai/cost", method: "GET", path: "/api/ai/cost", expectedStatus: [401] },
  { name: "POST /api/ai/decisions", method: "POST", path: "/api/ai/decisions", body: {}, expectedStatus: [401] },
  { name: "POST /api/ai/mentor", method: "POST", path: "/api/ai/mentor", body: {}, expectedStatus: [401] },
  { name: "POST /api/ai/architecture", method: "POST", path: "/api/ai/architecture", body: {}, expectedStatus: [401] },
  { name: "GET /api/ai/memory", method: "GET", path: "/api/ai/memory", expectedStatus: [401] },
  { name: "GET /api/queue", method: "GET", path: "/api/queue", expectedStatus: [401] },
  { name: "GET /api/tasks", method: "GET", path: "/api/tasks", expectedStatus: [401] },
  { name: "GET /api/timeline", method: "GET", path: "/api/timeline", expectedStatus: [401] },
  { name: "POST /api/voice", method: "POST", path: "/api/voice", body: { transcript: "test" }, expectedStatus: [401] },
  { name: "GET /api/ownership?filePath=a.ts", method: "GET", path: "/api/ownership?filePath=a.ts", expectedStatus: [401] },
  { name: "GET /api/intelligence", method: "GET", path: "/api/intelligence", expectedStatus: [401] },
  { name: "GET /api/control", method: "GET", path: "/api/control", expectedStatus: [401] },
  { name: "GET /api/plugins", method: "GET", path: "/api/plugins", expectedStatus: [401] },
  {
    name: "GET /api/agents/messages",
    method: "GET",
    path: "/api/agents/messages?taskId=t1&agentId=a1",
    expectedStatus: [401],
  },
  { name: "POST /api/vision/design-to-code", method: "POST", path: "/api/vision/design-to-code", body: {}, expectedStatus: [401] },
  { name: "POST /api/vision/screenshot-to-code", method: "POST", path: "/api/vision/screenshot-to-code", body: {}, expectedStatus: [401] },
  { name: "POST /api/ai/learning (POST gates 503 first)", method: "POST", path: "/api/ai/learning", body: {}, expectedStatus: [503] },
  { name: "GET /api/ai/learning (GET degrades to 200 stub, not 503/401)", method: "GET", path: "/api/ai/learning", expectedStatus: [200] },
  { name: "GET /api/referral (401 before its own 503 check)", method: "GET", path: "/api/referral", expectedStatus: [401] },
];

// ── isAdminConfigured()-gated group ────────────────────────────────────────────
// Routes that check isAdminConfigured() BEFORE authenticating the caller —
// with no Supabase keys configured, every one of these returns 503 here,
// never reaching a 401/403. Verified route-by-route (requireAdmin in
// lib/admin/server.ts, and local requireUser/requireAdvanced/requireOwnerOrAdmin
// wrappers that all check isAdminConfigured() first). Idempotent reads only
// where feasible; a couple use POST/DELETE bodies that never get parsed because
// the 503 fires before body access — still safe to loop 10x.
export const CONFIG_GATED_503_CASES: RouteCase[] = [
  { name: "GET /api/conversations", method: "GET", path: "/api/conversations?workspace=cochat", expectedStatus: [503] },
  // These two have no GET handler at all (PATCH/DELETE and POST respectively).
  { name: "DELETE /api/conversations/[id]", method: "DELETE", path: "/api/conversations/abc", expectedStatus: [503] },
  { name: "POST /api/conversations/[id]/messages", method: "POST", path: "/api/conversations/abc/messages", body: {}, expectedStatus: [503] },
  { name: "GET /api/keys", method: "GET", path: "/api/keys", expectedStatus: [503] },
  { name: "GET /api/cli/token", method: "GET", path: "/api/cli/token", expectedStatus: [503] },
  { name: "GET /api/cli/devices", method: "GET", path: "/api/cli/devices", expectedStatus: [503] },
  { name: "GET /api/search?q=test", method: "GET", path: "/api/search?q=test", expectedStatus: [503] },
  { name: "POST /api/admin/redeem", method: "POST", path: "/api/admin/redeem", body: { code: "X" }, expectedStatus: [503] },

  // The 13 /api/admin/* routes — all go through requireAdmin()/local equivalents
  // that check isAdminConfigured() first.
  { name: "GET /api/admin/analytics", method: "GET", path: "/api/admin/analytics", expectedStatus: [503] },
  { name: "GET /api/admin/announcements", method: "GET", path: "/api/admin/announcements", expectedStatus: [503] },
  // No GET handler — this one only exports PATCH/DELETE.
  { name: "PATCH /api/admin/announcements/[id]", method: "PATCH", path: "/api/admin/announcements/abc", body: {}, expectedStatus: [503] },
  { name: "GET /api/admin/api-usage", method: "GET", path: "/api/admin/api-usage", expectedStatus: [503] },
  { name: "GET /api/admin/beta-access", method: "GET", path: "/api/admin/beta-access", expectedStatus: [503] },
  { name: "GET /api/admin/feature-flags", method: "GET", path: "/api/admin/feature-flags", expectedStatus: [503] },
  // No GET handler — this one only exports PATCH/DELETE.
  { name: "PATCH /api/admin/feature-flags/[key]", method: "PATCH", path: "/api/admin/feature-flags/flag1", body: {}, expectedStatus: [503] },
  { name: "GET /api/admin/logs", method: "GET", path: "/api/admin/logs", expectedStatus: [503] },
  { name: "GET /api/admin/redeem-codes", method: "GET", path: "/api/admin/redeem-codes", expectedStatus: [503] },
  { name: "GET /api/admin/redeem-codes/[id]", method: "GET", path: "/api/admin/redeem-codes/abc", expectedStatus: [503] },
  { name: "GET /api/admin/roles", method: "GET", path: "/api/admin/roles", expectedStatus: [503] },
  { name: "GET /api/admin/subscriptions", method: "GET", path: "/api/admin/subscriptions", expectedStatus: [503] },
  // No GET handler — this one only exports PATCH/DELETE.
  { name: "PATCH /api/admin/subscriptions/[id]", method: "PATCH", path: "/api/admin/subscriptions/abc", body: {}, expectedStatus: [503] },
  { name: "GET /api/admin/users", method: "GET", path: "/api/admin/users", expectedStatus: [503] },
  { name: "GET /api/admin/users/[id]", method: "GET", path: "/api/admin/users/abc", expectedStatus: [503] },
];
