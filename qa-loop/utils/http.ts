export interface HttpResult {
  status: number;
  ok: boolean;
  body: string;
  headers: Record<string, string>;
  durationMs: number;
  error?: string;
}

export async function httpGet(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; token?: string } = {},
): Promise<HttpResult> {
  return httpReq("GET", url, undefined, opts);
}

export async function httpPost(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; headers?: Record<string, string>; token?: string } = {},
): Promise<HttpResult> {
  return httpReq("POST", url, body, opts);
}

export async function httpPatch(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; headers?: Record<string, string>; token?: string } = {},
): Promise<HttpResult> {
  return httpReq("PATCH", url, body, opts);
}

export async function httpDelete(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; token?: string } = {},
): Promise<HttpResult> {
  return httpReq("DELETE", url, undefined, opts);
}

async function httpReq(
  method: string,
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; headers?: Record<string, string>; token?: string },
): Promise<HttpResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "CoAI-QA-Loop/1.0",
    ...opts.headers,
  };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });

    const text = await res.text().catch(() => "");
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });

    return { status: res.status, ok: res.ok, body: text, headers: resHeaders, durationMs: Date.now() - start };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, ok: false, body: "", headers: {}, durationMs: Date.now() - start, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Consume a raw text/plain stream (this app's /api/chat wire format — NOT SSE:
 *  no "data:" prefix, no reliable "\n\n" framing) and return the full concatenated
 *  body. Unlike collectSSE, this never drops a trailing chunk that lacks a "\n\n"
 *  terminator, which matters for short answers. */
export async function collectRawStream(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; token?: string } = {},
): Promise<{ text: string; status: number; durationMs: number; error?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CoAI-QA-Loop/1.0",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { text: "", status: res.status, durationMs: Date.now() - start, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }
    return { text: raw, status: res.status, durationMs: Date.now() - start };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: "", status: 0, durationMs: Date.now() - start, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip this app's NUL-delimited control frames (model/failover/sources/error
 *  notices — see lib/errors.ts encode*Frame) leaving only the assistant's
 *  plain-text answer. Built from String.fromCharCode(0) rather than a literal
 *  NUL in the regex source, so this file stays plain ASCII/UTF-8 text. */
const NUL = String.fromCharCode(0);
const CONTROL_FRAME_RE = new RegExp(`${NUL}CGNTX_[A-Z]+${NUL}[\\s\\S]*?${NUL}/CGNTX_[A-Z]+${NUL}`, "g");
export function stripControlFrames(raw: string): string {
  return raw.replace(CONTROL_FRAME_RE, "");
}

/** Consume an SSE stream and collect all data frames. Returns when stream ends or timeout. */
export async function collectSSE(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; token?: string } = {},
): Promise<{ frames: string[]; durationMs: number; error?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CoAI-QA-Loop/1.0",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { frames: [], durationMs: Date.now() - start, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const frames: string[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.replace(/^data:\s*/m, "").trim();
        if (line && line !== "[DONE]") frames.push(line);
      }
    }

    // /api/chat streams text/plain with in-band control frames, not SSE — a
    // short answer ("4") may contain no \n\n at all and would otherwise be
    // discarded here, making the stream look empty (false "no frames" failure).
    const tail = buf.replace(/^data:\s*/m, "").trim();
    if (tail && tail !== "[DONE]") frames.push(tail);

    return { frames, durationMs: Date.now() - start };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { frames: [], durationMs: Date.now() - start, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Run N concurrent requests against a URL, return latency stats. */
export async function loadBurst(
  url: string,
  concurrency: number,
  timeoutMs: number,
): Promise<{ p50: number; p95: number; p99: number; successRate: number; rps: number; errors: string[] }> {
  const start = Date.now();
  const latencies: number[] = [];
  const errors: string[] = [];

  const BATCH = 20; // avoid overwhelming in one shot
  for (let sent = 0; sent < concurrency; sent += BATCH) {
    const batch = Math.min(BATCH, concurrency - sent);
    const results = await Promise.allSettled(
      Array.from({ length: batch }, () => httpGet(url, { timeoutMs })),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.ok) latencies.push(r.value.durationMs);
        else errors.push(`HTTP ${r.value.status}`);
      } else {
        errors.push(String(r.reason));
      }
    }
    // small breath between batches to avoid pure hammering
    await new Promise((r) => setTimeout(r, 50));
  }

  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.floor(latencies.length * p)] ?? 0;

  const totalMs = Date.now() - start;
  return {
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    successRate: latencies.length / concurrency,
    rps: Math.round((latencies.length / totalMs) * 1000),
    errors: errors.slice(0, 10),
  };
}
