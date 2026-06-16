// ── Aof AI — server-side provider layer ───────────────────────────────────────
// Owns everything that actually talks to an AI provider: the registry of runtime
// providers, key detection, the streaming adapters, unified error extraction,
// the "prime then stream" wrapper that converts an early provider failure into a
// clean structured error (instead of a half-rendered fake answer), and the
// lightweight health ping used by the diagnostics panel.
//
// Only Anthropic (Claude) and OpenRouter are wired into the chat runtime today;
// the registry is shaped so more providers slot in without touching callers.

import Anthropic from "@anthropic-ai/sdk";
import {
  classifyProviderError,
  emptyResponseError,
  encodeErrorFrame,
  encodeFailoverFrame,
  type AofProviderError,
  type FailoverNotice,
} from "@/lib/errors";
import type { ProviderHealth, ProviderStatusLevel } from "@/lib/health";

// ── Registry ──────────────────────────────────────────────────────────────────

export type ProviderId = "anthropic" | "openrouter";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  envVar: string;
  modelEnv: string;
  defaultModel: string;
  /** Lower = higher priority when picking the primary + failover order. */
  priority: number;
}

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Claude (Anthropic)",
    envVar: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-haiku-4-5-20251001",
    priority: 1,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    // Set OPENROUTER_MODEL env var to override. Browse free models at openrouter.ai/models?q=:free
    defaultModel: "deepseek/deepseek-r1:free",
    priority: 2,
  },
};

const ALL_PROVIDERS: ProviderMeta[] = Object.values(PROVIDER_REGISTRY).sort(
  (a, b) => a.priority - b.priority,
);

export function apiKeyFor(p: ProviderMeta): string | undefined {
  const v = process.env[p.envVar];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function modelFor(p: ProviderMeta): string {
  return process.env[p.modelEnv]?.trim() || p.defaultModel;
}

export function isConfigured(p: ProviderMeta): boolean {
  return apiKeyFor(p) !== undefined;
}

/** Configured providers in priority order (primary first). */
export function configuredProviders(): ProviderMeta[] {
  return ALL_PROVIDERS.filter(isConfigured);
}

/** Every registered provider, configured or not, in priority order. */
export function allProviders(): ProviderMeta[] {
  return ALL_PROVIDERS;
}

// ── Error extraction ──────────────────────────────────────────────────────────

/** Thrown by the fetch-based adapter on a non-OK upstream response. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly bodyType?: string,
    bodyMessage?: string,
  ) {
    super(bodyMessage || `HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

/** Was this failure a user-initiated abort (Stop button)? Not a real error. */
export function isAbort(thrown: unknown): boolean {
  const name = (thrown as { name?: string } | null)?.name;
  return name === "AbortError" || name === "APIUserAbortError";
}

interface ErrCtx {
  provider: ProviderMeta;
  model: string;
  requestId: string;
}

/** Normalize anything a provider can throw into a classified AofProviderError. */
export function toAofError(ctx: ErrCtx, thrown: unknown): AofProviderError {
  const base = {
    provider: ctx.provider.label,
    model: ctx.model,
    envVar: ctx.provider.envVar,
    requestId: ctx.requestId,
  };

  if (thrown instanceof ProviderHttpError) {
    return classifyProviderError({
      ...base,
      status: thrown.status,
      message: thrown.message,
      errorType: thrown.bodyType,
      responseBody: thrown.body,
      stack: thrown.stack,
    });
  }

  const e = (thrown ?? {}) as {
    name?: string;
    status?: number;
    message?: string;
    type?: string;
    request_id?: string;
    stack?: string;
    error?: { type?: string; message?: string; error?: { type?: string; message?: string } };
    headers?: Record<string, string>;
  };

  const name = e.name ?? "";
  const status = typeof e.status === "number" ? e.status : undefined;
  // Anthropic nests the upstream error under `.error` (sometimes `.error.error`).
  const bodyErr = e.error?.error ?? e.error;
  const errorType = bodyErr?.type ?? e.type;
  const message = bodyErr?.message ?? e.message ?? String(thrown);
  const requestId = ctx.requestId || e.request_id || e.headers?.["request-id"];

  let hint: "network" | "timeout" | undefined;
  if (/timeout/i.test(name)) hint = "timeout";
  else if (/connection|fetch/i.test(name)) hint = "network";

  return classifyProviderError({
    ...base,
    status,
    message,
    errorType,
    requestId,
    hint,
    stack: e.stack,
  });
}

// ── Streaming adapters (async generators that yield text, throw on failure) ────

export interface AdapterInput {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export async function* anthropicTextStream(input: AdapterInput): AsyncGenerator<string> {
  const meta = PROVIDER_REGISTRY.anthropic;
  const anthropic = new Anthropic({ apiKey: apiKeyFor(meta)! });
  const model = modelFor(meta);

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: input.message },
  ];

  const stream = anthropic.messages.stream(
    {
      model,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      system: input.system,
      messages,
    },
    { signal: input.signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

// Free/community models occasionally return a transient upstream error (overloaded
// or briefly rate-limited) that clears on a quick retry. We retry ONLY the initial
// connection — before any token has streamed — so there is no risk of duplicating
// content. Backoff is short and abort-aware so the Stop button still works.
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
// A bad key/permission won't be fixed by trying another model with the same key.
const FATAL_STATUSES = new Set([401, 403]);
const OPENROUTER_MAX_ATTEMPTS = 3;
const OPENROUTER_BACKOFF_MS = [300, 800];

// Free OpenRouter models get saturated independently, so when the configured one is
// overloaded Aof falls through to another free model — staying answerable with no
// paid key. The configured OPENROUTER_MODEL is always tried first; override the whole
// chain with OPENROUTER_MODELS (comma-separated).
const OPENROUTER_FREE_FALLBACKS = [
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat:free",
  "google/gemma-2-9b-it:free",
  "google/gemma-3-27b-it:free",
];

function openrouterModelChain(): string[] {
  const primary = modelFor(PROVIDER_REGISTRY.openrouter);
  const fromEnv = process.env.OPENROUTER_MODELS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const chain = fromEnv && fromEnv.length ? fromEnv : OPENROUTER_FREE_FALLBACKS;
  // Primary first, then the fallbacks, de-duplicated.
  return [...new Set([primary, ...chain])];
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Open the streaming connection for one model, retrying transient upstream failures. */
async function openrouterConnect(
  meta: ProviderMeta,
  model: string,
  messages: unknown[],
  input: AdapterInput,
  maxAttempts: number,
): Promise<Response> {
  const body = JSON.stringify({
    model,
    messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    stream: true,
  });

  let lastTransient: ProviderHttpError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyFor(meta)!}`,
        "HTTP-Referer": "https://aof-web.vercel.app",
        "X-Title": "Aof",
      },
      body,
      signal: input.signal,
    });

    if (res.ok && res.body) return res;

    const text = await res.text().catch(() => "");
    const { type, message } = parseUpstreamError(text);
    const err = new ProviderHttpError(res.status, text, type, message);

    if (TRANSIENT_STATUSES.has(res.status) && attempt < maxAttempts) {
      lastTransient = err;
      await abortableDelay(OPENROUTER_BACKOFF_MS[attempt - 1] ?? 800, input.signal);
      continue;
    }
    throw err;
  }
  // Exhausted all attempts on transient errors — surface the last one.
  throw lastTransient ?? new ProviderHttpError(502, "", undefined, "Provider unavailable");
}

/** Max time to wait for a model's FIRST token before abandoning it for the next
 *  one. Free models often accept the request (200) but are slow to start when
 *  queued; without this the function would hang until the platform kills it (an
 *  opaque 500). Overridable via OPENROUTER_FIRST_TOKEN_MS (used by tests). */
function firstTokenDeadlineMs(): number {
  const v = Number(process.env.OPENROUTER_FIRST_TOKEN_MS);
  return Number.isFinite(v) && v > 0 ? v : 6000;
}

export async function* openrouterTextStream(input: AdapterInput): AsyncGenerator<string> {
  const meta = PROVIDER_REGISTRY.openrouter;
  const messages = [
    { role: "system", content: input.system },
    ...input.history,
    { role: "user", content: input.message },
  ];

  // Try each model in the chain; an overloaded/rate-limited/unknown/slow model falls
  // through to the next free one. With multiple models we attempt each once (the
  // chain is the resilience); a single configured model still gets retried.
  const chain = openrouterModelChain();
  const perModelAttempts = chain.length > 1 ? 1 : OPENROUTER_MAX_ATTEMPTS;

  let lastError: ProviderHttpError | undefined;

  for (const model of chain) {
    // Per-model deadline covering connect + the FIRST token. A model that is slow
    // to start is abandoned (timedOut) for the next one rather than hanging.
    const ctrl = new AbortController();
    const onUserAbort = () => ctrl.abort();
    input.signal.addEventListener("abort", onUserAbort, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, firstTokenDeadlineMs());
    const clearDeadline = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    let started = false;
    try {
      const res = await openrouterConnect(meta, model, messages, { ...input, signal: ctrl.signal }, perModelAttempts);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            clearDeadline();
            input.signal.removeEventListener("abort", onUserAbort);
            return;
          }
          let delta = "";
          try {
            const json = JSON.parse(data);
            // An error can arrive mid-stream as a data frame.
            if (json?.error) {
              const msg = typeof json.error === "string" ? json.error : json.error?.message;
              throw new ProviderHttpError(json.error?.code ?? 502, data, json.error?.type, msg);
            }
            delta = json?.choices?.[0]?.delta?.content ?? "";
          } catch (e) {
            if (e instanceof ProviderHttpError) throw e;
            /* ignore malformed keep-alive frames */
          }
          if (delta) {
            if (!started) {
              started = true;
              clearDeadline(); // model is alive — stop the first-token clock
            }
            yield delta;
          }
        }
      }
      // Stream ended cleanly.
      if (started) {
        input.signal.removeEventListener("abort", onUserAbort);
        return; // fully streamed this model
      }
      lastError = new ProviderHttpError(502, "", "empty", `No content from ${model}`);
    } catch (thrown) {
      if (started) throw thrown; // mid-stream failure → primeAndStream emits an in-band error frame
      if (timedOut && !input.signal.aborted) {
        lastError = new ProviderHttpError(504, "", "timeout", `No response from ${model} in time`);
      } else if (isAbort(thrown)) {
        throw thrown; // genuine user abort while priming
      } else if (thrown instanceof ProviderHttpError) {
        if (FATAL_STATUSES.has(thrown.status)) throw thrown; // key/permission — stop
        lastError = thrown; // overloaded / rate-limited / invalid model → next model
      } else {
        throw thrown; // network-level failure — same host for every model
      }
    } finally {
      clearDeadline();
      input.signal.removeEventListener("abort", onUserAbort);
    }
  }

  throw lastError ?? new ProviderHttpError(502, "", undefined, "All models unavailable");
}

function parseUpstreamError(body: string): { type?: string; message?: string } {
  try {
    const json = JSON.parse(body);
    const err = json?.error ?? json;
    // `code` is often numeric (e.g. 429) — always hand back strings.
    const rawType = err?.type ?? err?.code;
    return {
      type: rawType == null ? undefined : String(rawType),
      message: err?.message == null ? undefined : String(err.message),
    };
  } catch {
    return { message: body.slice(0, 300) };
  }
}

export function adapterFor(id: ProviderId): (input: AdapterInput) => AsyncGenerator<string> {
  return id === "anthropic" ? anthropicTextStream : openrouterTextStream;
}

// ── Prime then stream ─────────────────────────────────────────────────────────
// The crux of "never fake an answer": we pull the FIRST token from the provider
// before committing to a 200 streaming response. If the provider fails at request
// time (auth, quota, model, network, …) — which is when almost all failures
// surface — we still hold a clean error and can return it as JSON and/or fail
// over. An immediately-finished stream with no content is an Empty Response.

export interface PrimeResult {
  ok: boolean;
  /** Present when ok === false. */
  error?: AofProviderError;
  /** Present when ok === true. */
  stream?: ReadableStream<Uint8Array>;
  /** True when the user aborted while priming (no error should be shown). */
  aborted?: boolean;
}

export async function primeAndStream(opts: {
  ctx: ErrCtx;
  gen: AsyncGenerator<string>;
  /** Optional control frame to emit before the first token (e.g. failover). */
  prefixFrame?: string;
}): Promise<PrimeResult> {
  const { ctx, gen, prefixFrame } = opts;

  // ── Priming phase: find the first non-empty chunk (or a clean failure). ──────
  let firstChunk: string | null = null;
  while (firstChunk === null) {
    let next: IteratorResult<string>;
    try {
      next = await gen.next();
    } catch (thrown) {
      if (isAbort(thrown)) return { ok: false, aborted: true };
      return { ok: false, error: toAofError(ctx, thrown) };
    }
    if (next.done) {
      // Provider closed the stream without producing any content.
      return {
        ok: false,
        error: emptyResponseError(ctx.provider.label, ctx.model, ctx.requestId),
      };
    }
    if (next.value) firstChunk = next.value;
    // Empty-but-not-done frame → keep priming.
  }

  // ── Streaming phase: replay the first chunk, then pump the rest. ─────────────
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        if (prefixFrame) controller.enqueue(encoder.encode(prefixFrame));
        controller.enqueue(encoder.encode(firstChunk as string));
        while (true) {
          let next: IteratorResult<string>;
          try {
            next = await gen.next();
          } catch (thrown) {
            if (!isAbort(thrown)) {
              // Mid-stream failure after content already started: surface it as an
              // in-band error frame so the UI replaces the partial with an error.
              controller.enqueue(encoder.encode(encodeErrorFrame(toAofError(ctx, thrown))));
            }
            break;
          }
          if (next.done) break;
          if (next.value) controller.enqueue(encoder.encode(next.value));
        }
      } finally {
        controller.close();
      }
    },
  });

  return { ok: true, stream };
}

/** Frame that announces a failover, prepended to the successful provider's stream. */
export function failoverFrame(notice: FailoverNotice): string {
  return encodeFailoverFrame(notice);
}

// ── Health ping ───────────────────────────────────────────────────────────────

const HEALTH_TIMEOUT_MS = 8000;
const DEGRADED_LATENCY_MS = 2500;

/** Cheap, non-generative auth check for a single provider. */
export async function pingProvider(p: ProviderMeta): Promise<ProviderHealth> {
  const now = () => new Date().toISOString();
  const model = modelFor(p);
  const primary = p.priority === 1;

  if (!isConfigured(p)) {
    const error = classifyProviderError({ provider: p.label, envVar: p.envVar, model, hint: "missing-key" });
    return {
      id: p.id,
      label: p.label,
      status: "DISCONNECTED",
      note: "Missing API Key",
      configured: false,
      primary,
      model,
      error,
      checkedAt: now(),
    };
  }

  const requestId = `health_${p.id}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  const started = Date.now();
  try {
    if (p.id === "anthropic") {
      const anthropic = new Anthropic({ apiKey: apiKeyFor(p)! });
      await anthropic.models.list({}, { signal: ctrl.signal });
    } else {
      const res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${apiKeyFor(p)!}` },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const { type, message } = parseUpstreamError(body);
        throw new ProviderHttpError(res.status, body, type, message);
      }
    }
    const latencyMs = Date.now() - started;
    const degraded = latencyMs > DEGRADED_LATENCY_MS;
    return {
      id: p.id,
      label: p.label,
      status: degraded ? "DEGRADED" : "CONNECTED",
      note: degraded ? `High latency (${latencyMs}ms)` : `Connected · ${latencyMs}ms`,
      configured: true,
      primary,
      model,
      latencyMs,
      checkedAt: now(),
    };
  } catch (thrown) {
    const error = toAofError({ provider: p, model, requestId }, thrown);
    // A rate-limit means the provider is reachable but throttled → DEGRADED.
    const level: ProviderStatusLevel = error.code === "AOF_ERROR_005" ? "DEGRADED" : "DISCONNECTED";
    return {
      id: p.id,
      label: p.label,
      status: level,
      note: error.problem,
      configured: true,
      primary,
      model,
      error,
      checkedAt: now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
