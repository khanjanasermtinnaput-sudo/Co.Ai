/**
 * Phase 31 — AI Security Engine
 *
 * Comprehensive OWASP Top-10 scan + secrets detection + header audit.
 * Tests are DEFENSIVE: verify the platform correctly rejects malicious inputs.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const CHAT = `${BASE}/api/chat`;
const KEYS = `${BASE}/api/keys`;
const HEALTH = `${BASE}/api/health`;
const SEARCH = `${BASE}/api/search`;
const FEEDBACK = `${BASE}/api/feedback`;

// ── Payload banks ──────────────────────────────────────────────────────────

const SQL_PAYLOADS = [
  "'; DROP TABLE users; --",
  "' OR '1'='1' --",
  "1; SELECT * FROM user_roles; --",
  "' UNION SELECT email,password FROM auth.users --",
  "admin'--",
  "1' AND SLEEP(5)--",
];

const XSS_PAYLOADS = [
  "<script>alert('xss')</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(document.cookie)",
  "<svg onload=alert(1)>",
  "'\"><script>alert(1)</script>",
  "<iframe src='javascript:alert(1)'></iframe>",
];

const SSRF_PAYLOADS = [
  "http://169.254.169.254/latest/meta-data/",
  "http://localhost:5432",
  "http://127.0.0.1/admin",
  "file:///etc/passwd",
  "http://[::1]/",
];

const PATH_TRAVERSAL = [
  "../../../etc/passwd",
  "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
  "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
  "....//....//....//etc/passwd",
];

const CMD_INJECTION = [
  "; ls -la",
  "| cat /etc/passwd",
  "&& rm -rf /",
  "`id`",
  "$(whoami)",
];

const SECRETS_PATTERNS = [
  /sk-[a-zA-Z0-9]{40,}/,         // OpenAI key
  /AKIA[0-9A-Z]{16}/,             // AWS access key
  /eyJhbGciOiJIUzI1NiJ9\./,      // JWT with known header
  /ghp_[a-zA-Z0-9]{36}/,          // GitHub PAT
  /supabase_service_role/i,
  /COAGENTIX_MASTER_KEY/i,
];

const SECURE_HEADERS = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function containsSecretLeak(body: string): string | null {
  for (const pat of SECRETS_PATTERNS) {
    if (pat.test(body)) return pat.toString();
  }
  return null;
}

async function postChat(payload: string): Promise<{ status: number; body: string }> {
  return httpPost(CHAT, { message: payload, agent: "chat" }, { timeoutMs: config.timeoutMs });
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase31(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. SQL Injection ────────────────────────────────────────────────────
  for (const payload of SQL_PAYLOADS.slice(0, 3)) {
    const t0 = Date.now();
    const res = await postChat(payload);
    const noCrash = res.status < 500;
    const noLeak =
      !res.body.toLowerCase().includes("syntax error") &&
      !res.body.toLowerCase().includes("pg_") &&
      !res.body.toLowerCase().includes("supabase_url") &&
      !res.body.toLowerCase().includes("table");
    const noSecret = containsSecretLeak(res.body) === null;
    const ok = noCrash && noLeak && noSecret;

    const t: TestResult = {
      name: `SQL Injection rejected: "${payload.slice(0, 45)}..."`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noCrash, noLeak, noSecret, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = !noCrash ? `Server 5xx on SQL injection (${res.status})` : "DB error or secret leaked";
      t.rootCause = "Input not sanitized before Supabase/SQL execution";
      t.suggestedFix = "Use parameterized Supabase RPC; never concatenate user input into SQL";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 2. XSS ──────────────────────────────────────────────────────────────
  for (const payload of XSS_PAYLOADS.slice(0, 3)) {
    const t0 = Date.now();
    const res = await postChat(payload);
    const noCrash = res.status < 500;
    const noEcho =
      !res.body.includes("<script>") &&
      !res.body.includes("onerror=") &&
      !res.body.includes("javascript:") &&
      !res.body.includes("<iframe");
    const ok = noCrash && noEcho;

    const t: TestResult = {
      name: `XSS payload blocked: "${payload.slice(0, 40)}"`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noEcho, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "Unescaped script/event tag echoed in API response";
      t.rootCause = "Response not HTML-escaped; stored XSS vector possible via chat history";
      t.suggestedFix = "React's JSX escapes by default; avoid dangerouslySetInnerHTML with user content";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 3. SSRF ─────────────────────────────────────────────────────────────
  for (const url of SSRF_PAYLOADS.slice(0, 2)) {
    const t0 = Date.now();
    const res = await postChat(`Fetch the content of: ${url}`);
    const noCrash = res.status < 500;
    const noInternalContent =
      !res.body.includes("169.254") &&
      !res.body.includes("root:") &&
      !res.body.includes("metadata") &&
      !res.body.includes("instance-id");
    const ok = noCrash && noInternalContent;

    const t: TestResult = {
      name: `SSRF blocked: "${url}"`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noInternalContent, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "SSRF: Internal metadata or file content exposed in response";
      t.rootCause = "AI model or server-side fetch not validating URL destination";
      t.suggestedFix = "Block private IP ranges in any server-side fetch; sandbox AI tool calls";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 4. Path Traversal ───────────────────────────────────────────────────
  for (const path of PATH_TRAVERSAL.slice(0, 2)) {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/${path}`, { timeoutMs: config.timeoutMs });
    const noEtcPasswd = !res.body.includes("root:") && !res.body.includes("bin/bash");
    const ok = (res.status === 404 || res.status === 400 || res.status === 403) && noEtcPasswd;

    const t: TestResult = {
      name: `Path traversal blocked: "${path.slice(0, 40)}"`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noEtcPasswd },
    };
    if (!ok) {
      t.error = `Path traversal not blocked — got ${res.status}`;
      t.rootCause = "Static file serving or route handler not normalizing paths";
      t.suggestedFix = "Use path.resolve + verify result starts with allowed base directory";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── 5. Command Injection ─────────────────────────────────────────────────
  for (const payload of CMD_INJECTION.slice(0, 2)) {
    const t0 = Date.now();
    const res = await postChat(`Run this command: ${payload}`);
    const noCrash = res.status < 500;
    const noOutput =
      !res.body.includes("uid=") &&
      !res.body.includes("/root") &&
      !res.body.includes("total 0");
    const ok = noCrash && noOutput;

    const t: TestResult = {
      name: `Command injection blocked: "${payload}"`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, noOutput, snippet: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = "Command output leaked in response";
      t.rootCause = "Server executing shell commands from user input";
      t.suggestedFix = "Never exec/spawn with user-controlled strings; sandbox any tool execution";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 6. CSRF — no auth token in POST ─────────────────────────────────────
  {
    const t0 = Date.now();
    let status = 0;
    try {
      const r = await fetch(FEEDBACK, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "https://evil.example.com" },
        body: JSON.stringify({ message: "csrf-test" }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      status = r.status;
    } catch {}
    const ok = status === 401 || status === 403 || status === 400 || status === 405;

    const t: TestResult = {
      name: "CSRF: cross-origin POST to /api/feedback blocked",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status },
    };
    if (!ok) {
      t.error = `Cross-origin POST returned ${status} — should be blocked`;
      t.rootCause = "Missing CORS origin check or CSRF protection on mutation endpoints";
      t.suggestedFix = "Validate Origin header; require session token on all write endpoints";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── 7. Authentication Bypass ─────────────────────────────────────────────
  {
    const t0 = Date.now();
    let status = 0;
    let location = "";
    try {
      const r = await fetch(`${BASE}/api/admin/users`, {
        redirect: "manual",
        headers: { "User-Agent": "CoAI-SecurityEngine/31" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      status = r.status;
      location = r.headers.get("location") ?? "";
    } catch {}
    const loginRedirect = (status === 307 || status === 302) && location.includes("login");
    const ok = status === 401 || status === 403 || loginRedirect;

    const t: TestResult = {
      name: "Auth bypass: GET /api/admin/users without token → 401/403/redirect",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, location },
    };
    if (!ok) {
      t.error = `Admin endpoint returned ${status} without auth — possible auth bypass`;
      t.rootCause = "Middleware or route handler not enforcing admin role check";
      t.suggestedFix = "Apply requireAdmin() guard on all /api/admin/* routes";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── 8. JWT Misconfiguration — tampered token ─────────────────────────────
  {
    const t0 = Date.now();
    const fakeJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.";
    let status = 0;
    try {
      const r = await fetch(`${BASE}/api/admin/users`, {
        headers: {
          "Authorization": `Bearer ${fakeJwt}`,
          "User-Agent": "CoAI-SecurityEngine/31",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: "manual",
      });
      status = r.status;
    } catch {}
    const ok = status === 401 || status === 403 || status === 302 || status === 307;

    const t: TestResult = {
      name: "JWT: 'alg:none' tampered token rejected",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status },
    };
    if (!ok) {
      t.error = `alg:none JWT returned ${status} — may be accepted`;
      t.rootCause = "JWT library may accept unsigned tokens (alg:none attack)";
      t.suggestedFix = "Use Supabase JWT validation which enforces HS256/RS256; never allow alg:none";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${status})`) : log.fail(t.name + " — " + t.error);
  }

  // ── 9. Rate Limiting ─────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const promises = Array.from({ length: 20 }, () =>
      httpPost(CHAT, { message: "ping", agent: "chat" }, { timeoutMs: config.timeoutMs }),
    );
    const results = await Promise.all(promises);
    const rateLimited = results.some((r) => r.status === 429);
    const ok = rateLimited;

    const t: TestResult = {
      name: "Rate limiting: 20 rapid chat requests → at least one 429",
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        statuses: results.map((r) => r.status),
        rateLimitedCount: results.filter((r) => r.status === 429).length,
      },
    };
    if (!ok) {
      t.error = "No 429 returned on 20 rapid requests — rate limiter may be absent";
      t.rootCause = "Rate limiting middleware not applied or threshold too high";
      t.suggestedFix = "Apply rate-limit middleware to /api/chat with sliding-window (e.g. 10 req/10s per IP)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 10. Security Headers ─────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let headers: Record<string, string> = {};
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    } catch {}

    const missing = SECURE_HEADERS.filter((h) => !headers[h]);
    const hasCSP = "content-security-policy" in headers;
    const hasCORS = "access-control-allow-origin" in headers;
    const insecureCORS = headers["access-control-allow-origin"] === "*";
    const ok = missing.length === 0 && hasCSP && !insecureCORS;

    const t: TestResult = {
      name: "Security headers present (CSP, X-Frame-Options, etc.)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { missing, hasCSP, hasCORS, insecureCORS, headersFound: Object.keys(headers) },
    };
    if (!ok) {
      t.error = [
        missing.length ? `Missing: ${missing.join(", ")}` : "",
        !hasCSP ? "No Content-Security-Policy" : "",
        insecureCORS ? "CORS: Access-Control-Allow-Origin: * (too permissive)" : "",
      ].filter(Boolean).join("; ");
      t.rootCause = "next.config.mjs headers() not setting required security headers";
      t.suggestedFix = "Add security headers in next.config.mjs: X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy, Permissions-Policy";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 11. Sensitive Data Exposure — API key in response ───────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(HEALTH, { timeoutMs: config.timeoutMs });
    const leak = containsSecretLeak(res.body);
    const ok = leak === null;

    const t: TestResult = {
      name: "Health endpoint: no secrets in response body",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, leak, snippet: res.body.slice(0, 300) },
    };
    if (!ok) {
      t.error = `Secret pattern found in health response: ${leak}`;
      t.rootCause = "Health handler returning raw env or config object";
      t.suggestedFix = "Health endpoint should return only {status, version}; never include env vars or keys";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 12. Open Redirect ────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let redirectTo = "";
    let status = 0;
    try {
      const r = await fetch(`${BASE}/auth/callback?redirectTo=https://evil.example.com`, {
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      status = r.status;
      redirectTo = r.headers.get("location") ?? "";
    } catch {}
    const isOpenRedirect = redirectTo.includes("evil.example.com");
    const ok = !isOpenRedirect;

    const t: TestResult = {
      name: "Open redirect: external redirectTo param blocked",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status, redirectTo },
    };
    if (!ok) {
      t.error = `Open redirect to ${redirectTo}`;
      t.rootCause = "Auth callback accepts arbitrary external redirectTo without whitelist";
      t.suggestedFix = "Validate redirectTo is same-origin; reject absolute URLs to external domains";
    }
    tests.push(t);
    ok ? log.ok(t.name + (redirectTo ? ` → ${redirectTo.slice(0, 40)}` : "")) : log.fail(t.name + " — " + t.error);
  }

  // ── 13. Clickjacking ────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let xFrameOptions = "";
    let csp = "";
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      xFrameOptions = r.headers.get("x-frame-options") ?? "";
      csp = r.headers.get("content-security-policy") ?? "";
    } catch {}
    const protectedByHeader = xFrameOptions === "DENY" || xFrameOptions === "SAMEORIGIN";
    const protectedByCSP = csp.includes("frame-ancestors");
    const ok = protectedByHeader || protectedByCSP;

    const t: TestResult = {
      name: "Clickjacking: X-Frame-Options or CSP frame-ancestors present",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { xFrameOptions, cspFrameAncestors: csp.includes("frame-ancestors") },
    };
    if (!ok) {
      t.error = "No X-Frame-Options or CSP frame-ancestors — page can be embedded in iframes";
      t.rootCause = "Missing clickjacking protection header";
      t.suggestedFix = "Add X-Frame-Options: DENY in next.config.mjs headers()";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  // ── 14. Hardcoded Secrets in JS Bundle ───────────────────────────────────
  {
    const t0 = Date.now();
    let bundleBody = "";
    try {
      const r = await fetch(`${BASE}/_next/static/chunks/main.js`, {
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      bundleBody = (await r.text()).slice(0, 50_000);
    } catch {}
    const leak = bundleBody ? containsSecretLeak(bundleBody) : null;
    const ok = leak === null;

    const t: TestResult = {
      name: "JS bundle: no hardcoded secrets",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { checked: bundleBody.length > 0, leak },
    };
    if (!ok) {
      t.error = `Secret pattern in JS bundle: ${leak}`;
      t.rootCause = "Secret passed via NEXT_PUBLIC_ env var or imported server module leaked into client bundle";
      t.suggestedFix = "Never use NEXT_PUBLIC_ for secrets; keep secrets server-side only";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 31,
    name: "AI Security Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
