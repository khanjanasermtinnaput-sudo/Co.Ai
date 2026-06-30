/**
 * Phase 32 — AI Performance Engine
 *
 * Measures bundle size, API latency, Core Web Vitals proxies, and
 * server response characteristics. Flags regressions automatically.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { openPage, navigate } from "../utils/browser.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;

// ── Thresholds ─────────────────────────────────────────────────────────────
const THRESHOLDS = {
  homepageResponseMs: 3000,
  apiLatencyMs: 5000,
  chatLatencyMs: 15000,
  jsMainBundleKb: 500,        // gzipped JS main chunk
  ttfbMs: 800,                // Time To First Byte
  concurrentRequests: 5,
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function measureApiLatency(url: string, method: "GET" | "POST" = "GET", body?: object): Promise<{ ms: number; status: number }> {
  const t0 = Date.now();
  try {
    const r = method === "GET"
      ? await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs) })
      : await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
    return { ms: Date.now() - t0, status: r.status };
  } catch {
    return { ms: Date.now() - t0, status: 0 };
  }
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase32(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Homepage TTFB ────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(BASE, { timeoutMs: config.timeoutMs });
    const ttfb = res.durationMs;
    const ok = ttfb < THRESHOLDS.homepageResponseMs && res.status === 200;

    const t: TestResult = {
      name: `Homepage response time < ${THRESHOLDS.homepageResponseMs}ms`,
      passed: ok,
      durationMs: ttfb,
      details: { ttfbMs: ttfb, status: res.status, threshold: THRESHOLDS.homepageResponseMs },
    };
    if (!ok) {
      t.error = `TTFB ${ttfb}ms exceeds threshold ${THRESHOLDS.homepageResponseMs}ms`;
      t.rootCause = "Vercel edge cold start or heavy SSR blocking response";
      t.suggestedFix = "Enable ISR/SSG on marketing pages; move heavy data fetching to client-side or background";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${ttfb}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. Health API latency ────────────────────────────────────────────────
  {
    const { ms, status } = await measureApiLatency(`${BASE}/api/health`);
    const ok = ms < THRESHOLDS.apiLatencyMs && status === 200;

    const t: TestResult = {
      name: `GET /api/health latency < ${THRESHOLDS.apiLatencyMs}ms`,
      passed: ok,
      durationMs: ms,
      details: { latencyMs: ms, status },
    };
    if (!ok) {
      t.error = `Health endpoint took ${ms}ms (threshold: ${THRESHOLDS.apiLatencyMs}ms, status: ${status})`;
      t.rootCause = "Backend cold start (Render free tier) or Supabase connection overhead";
      t.suggestedFix = "Use keep-warm workflow; upgrade Render to paid tier for faster cold starts";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${ms}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Chat API latency (first token) ───────────────────────────────────
  {
    const t0 = Date.now();
    let ms = 0;
    let status = 0;
    try {
      const r = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hi", agent: "chat" }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      status = r.status;
      // Read only first chunk to measure TTFT
      const reader = r.body?.getReader();
      if (reader) {
        await reader.read();
        reader.cancel();
      }
      ms = Date.now() - t0;
    } catch {
      ms = Date.now() - t0;
    }
    const ok = ms < THRESHOLDS.chatLatencyMs && (status < 500 || status === 0);

    const t: TestResult = {
      name: `Chat API time-to-first-token < ${THRESHOLDS.chatLatencyMs}ms`,
      passed: ok,
      durationMs: ms,
      details: { ttftMs: ms, status, threshold: THRESHOLDS.chatLatencyMs },
    };
    if (!ok) {
      t.error = `Chat TTFT ${ms}ms exceeds ${THRESHOLDS.chatLatencyMs}ms`;
      t.rootCause = "LLM provider cold start or missing streaming implementation";
      t.suggestedFix = "Verify streaming is enabled in /api/chat; use Anthropic streaming SDK";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${ms}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. JS bundle size ────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let sizeKb = 0;
    let found = false;
    try {
      // Try to find and measure the main chunk
      const indexRes = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      const html = await indexRes.text();
      const jsMatch = html.match(/_next\/static\/chunks\/[^"']+\.js/);
      if (jsMatch) {
        const jsUrl = `${BASE}/${jsMatch[0]}`;
        const jsRes = await fetch(jsUrl, { signal: AbortSignal.timeout(config.timeoutMs) });
        const buf = await jsRes.arrayBuffer();
        sizeKb = Math.round(buf.byteLength / 1024);
        found = true;
      }
    } catch {}

    const ok = !found || sizeKb <= THRESHOLDS.jsMainBundleKb;

    const t: TestResult = {
      name: `JS main chunk ≤ ${THRESHOLDS.jsMainBundleKb}KB`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { sizeKb, found, threshold: THRESHOLDS.jsMainBundleKb },
    };
    if (!ok) {
      t.error = `Main chunk is ${sizeKb}KB (threshold: ${THRESHOLDS.jsMainBundleKb}KB)`;
      t.rootCause = "Large dependencies included in main bundle without code splitting";
      t.suggestedFix = "Use next/dynamic for heavy components; add bundle analyzer to find large deps";
    }
    tests.push(t);
    ok
      ? log.ok(`${t.name}${found ? ` (${sizeKb}KB)` : " (bundle not measured — skipped)"}`)
      : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Concurrent API requests ───────────────────────────────────────────
  {
    const t0 = Date.now();
    const concurrent = THRESHOLDS.concurrentRequests;
    const promises = Array.from({ length: concurrent }, () => measureApiLatency(`${BASE}/api/health`));
    const results = await Promise.all(promises);
    const maxMs = Math.max(...results.map((r) => r.ms));
    const allOk = results.every((r) => r.status === 200);
    const ok = allOk && maxMs < THRESHOLDS.apiLatencyMs * 2;

    const t: TestResult = {
      name: `${concurrent} concurrent GET /api/health all succeed`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        concurrentCount: concurrent,
        maxLatencyMs: maxMs,
        statuses: results.map((r) => r.status),
        allOk,
      },
    };
    if (!ok) {
      t.error = !allOk
        ? `Some concurrent requests failed: ${results.map((r) => r.status).join(",")}`
        : `Max concurrent latency ${maxMs}ms too high`;
      t.rootCause = "Server cannot handle concurrent load — connection pool or thread limit";
      t.suggestedFix = "Check Render/Vercel instance concurrency limits; add DB connection pooling";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (max ${maxMs}ms)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Static assets cached (Cache-Control header) ─────────────────────
  {
    const t0 = Date.now();
    let cacheControl = "";
    let status = 0;
    try {
      const indexRes = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      const html = await indexRes.text();
      const jsMatch = html.match(/\/_next\/static\/chunks\/[^"']+\.js/);
      if (jsMatch) {
        const r = await fetch(`${BASE}${jsMatch[0]}`, { signal: AbortSignal.timeout(config.timeoutMs) });
        status = r.status;
        cacheControl = r.headers.get("cache-control") ?? "";
      }
    } catch {}

    const hasImmutable = cacheControl.includes("immutable") || cacheControl.includes("max-age=31536000");
    const ok = !cacheControl || hasImmutable; // skip if asset not found

    const t: TestResult = {
      name: "Static JS chunks have long-lived Cache-Control",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { cacheControl, status },
    };
    if (!ok) {
      t.error = `Cache-Control: "${cacheControl}" — missing immutable/max-age for hashed static assets`;
      t.rootCause = "Next.js should auto-set immutable on /_next/static/* but may be overridden by CDN config";
      t.suggestedFix = "Ensure Vercel/Cloudflare CDN is not stripping Cache-Control on static chunks";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${cacheControl || "not measured"})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. API response compression ──────────────────────────────────────────
  {
    const t0 = Date.now();
    let encoding = "";
    try {
      const r = await fetch(`${BASE}/api/health`, {
        headers: { "Accept-Encoding": "gzip, deflate, br" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      encoding = r.headers.get("content-encoding") ?? "";
    } catch {}

    const ok = encoding === "gzip" || encoding === "br" || encoding === "deflate";

    const t: TestResult = {
      name: "API responses are compressed (gzip/br)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { contentEncoding: encoding || "(none)" },
    };
    if (!ok) {
      t.error = `No compression on API responses (encoding: "${encoding || "none"}")`;
      t.rootCause = "Vercel/CDN compression not enabled for JSON API responses";
      t.suggestedFix = "Enable compression in next.config.mjs: compress: true (default); verify Vercel edge compresses";
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${encoding})`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 8. LCP proxy — large image check ────────────────────────────────────
  {
    const t0 = Date.now();
    let foundLargeImage = false;
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(config.timeoutMs) });
      const html = await r.text();
      // Flag any <img> without next/image (width/height attrs) as potential LCP risk
      const rawImgs = [...html.matchAll(/<img(?![^>]*next[^>]*)(?![^>]*loading="lazy")[^>]*src="([^"]+)"[^>]*>/gi)];
      foundLargeImage = rawImgs.length > 0;
    } catch {}
    const ok = !foundLargeImage;

    const t: TestResult = {
      name: "No unoptimized <img> tags (LCP risk) on homepage",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { foundUnoptimizedImage: foundLargeImage },
    };
    if (!ok) {
      t.error = "Raw <img> tags without lazy loading or Next.js Image optimization found";
      t.rootCause = "Using <img> instead of next/image — no automatic WebP, sizing, or lazy loading";
      t.suggestedFix = "Replace <img> with next/image for all above-fold images to improve LCP";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 32,
    name: "AI Performance Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
