// ── Aof Chat — real LLM endpoint (server-side) ───────────────────────────────
// Provider priority (first configured key wins; failover walks the rest):
//   1. ANTHROPIC_API_KEY  → Anthropic SDK (claude-haiku-4-5 by default)
//   2. GROQ_API_KEY       → Groq / Llama 3.3-70B (free, very fast)
//   3. GEMINI_API_KEY     → Google Gemini 2.0 Flash
//   4. DEEPSEEK_API_KEY   → DeepSeek Chat
//   5. DASHSCOPE_API_KEY  → Qwen via DashScope
//   6. OPENROUTER_API_KEY → OpenRouter (google/gemini-2.0-flash-exp:free)
//   7. No key found       → AOF_ERROR_001 (503); the client shows the error panel
//
// Golden rule: NEVER pretend AI is working. Every provider failure is classified
// (provider-errors.ts), logged server-side as [AOF ERROR], and surfaced to the
// client — as a JSON error body (failure before streaming), an in-band sentinel
// (failure mid-stream), or an x-aof-failover header (a fallback took over).

import Anthropic from "@anthropic-ai/sdk";
import type { ResponseStyle, RouteDecision } from "@/lib/types";
import { RAA_SYSTEM, AOF_CODE_CHAT_SYSTEM } from "@/lib/raa";
import {
  type AofProviderError,
  type FailoverInfo,
  type ProviderId,
  PROVIDERS,
  PROVIDER_ORDER,
  buildProviderError,
  classifyException,
  classifyHttpStatus,
  encodeErrorSentinel,
  formatErrorLog,
  publicError,
} from "@/lib/provider-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  message?: string;
  style?: ResponseStyle;
  route?: RouteDecision;
  history?: ChatHistoryItem[];
  /** "chat" = general assistant; "requirements" = RAA (DISCOVERY);
   *  "code-chat" = Aof Code NORMAL_CHAT */
  agent?: "chat" | "requirements" | "code-chat";
}

// ── Provider defaults ─────────────────────────────────────────────────────────
const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic:  process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
  groq:       process.env.GROQ_MODEL?.trim() || process.env.LLAMA_MODEL?.trim() || "llama-3.3-70b-versatile",
  gemini:     process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
  deepseek:   process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
  dashscope:  process.env.QWEN_MODEL?.trim() || "qwen-plus",
  openrouter: process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.0-flash-exp:free",
};

// OpenAI-compatible base URLs (anthropic uses its SDK, not this map)
const OPENAI_COMPAT: Partial<Record<ProviderId, { url: string; headers?: Record<string, string> }>> = {
  groq:       { url: "https://api.groq.com/openai/v1/chat/completions" },
  gemini:     { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
  deepseek:   { url: "https://api.deepseek.com/chat/completions" },
  dashscope:  { url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: { "HTTP-Referer": "https://aof-web.vercel.app", "X-Title": "Aof" },
  },
};

const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
};

/** Per-request context threaded through the provider calls. */
interface ProviderCtx {
  providerId: ProviderId;
  model: string;
  requestId: string;
  devMode: boolean;
  signal: AbortSignal;
}

/** Pre-stream outcome: a committed streaming response, or a classified error. */
type ProviderResult =
  | { ok: true; response: Response }
  | { ok: false; error: AofProviderError; status: number };

// ── System prompt builder (Aof Chat) ─────────────────────────────────────────

function buildSystem(style: ResponseStyle | undefined, route: RouteDecision | undefined): string {
  const persona =
    "You are Aof, a friendly, knowledgeable AI assistant. Have natural conversations, " +
    "answer general questions, explain ideas clearly, and help the user think things through. " +
    "You can use Markdown when it helps readability.";
  const language =
    "RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in. " +
    "Thai input → Thai reply. English input → English reply.";
  const verbosity =
    style === "short"
      ? "Keep your answer brief and to the point — a few sentences at most."
      : style === "detailed"
        ? "Give a thorough, well-structured answer with helpful detail and examples where useful."
        : "Answer clearly and helpfully at a natural length.";
  const search =
    route?.target === "search"
      ? "The user is looking for information. Answer from your knowledge. If the answer depends on " +
        "very recent or live data (today's news, current prices, live events) that you may not have, " +
        "say so briefly and still give your best general answer."
      : "";
  return [persona, language, verbosity, search].filter(Boolean).join("\n\n");
}

function maxTokensFor(style: ResponseStyle | undefined): number {
  if (style === "short") return 500;
  if (style === "detailed") return 1800;
  return 1000;
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function exceptionError(e: unknown, ctx: ProviderCtx): AofProviderError {
  return buildProviderError({
    code: classifyException(e),
    providerId: ctx.providerId,
    httpStatus: (e as { status?: number })?.status,
    model: ctx.model,
    requestId: ctx.requestId,
    rawError: (e as Error)?.message,
    stack: (e as Error)?.stack,
  });
}

function isAbort(e: unknown): boolean {
  return (e as Error)?.name === "AbortError";
}

// ── Anthropic streaming ───────────────────────────────────────────────────────

async function callAnthropic(
  system: string,
  history: ChatHistoryItem[],
  message: string,
  maxTokens: number,
  temperature: number,
  ctx: ProviderCtx,
): Promise<ProviderResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((h) => h.role === "user" || h.role === "assistant")
      .map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: message },
  ];

  // Pull the first event up-front so auth/quota/rate errors surface as a proper
  // status BEFORE we commit to a 200 stream (and can still failover).
  const iterator = anthropic.messages
    .stream({ model: ctx.model, max_tokens: maxTokens, temperature, system, messages }, { signal: ctx.signal })
    [Symbol.asyncIterator]();

  let first: IteratorResult<Anthropic.MessageStreamEvent>;
  try {
    first = await iterator.next();
  } catch (e) {
    if (isAbort(e)) return { ok: true, response: new Response(null, { status: 499 }) };
    const error = exceptionError(e, ctx);
    return { ok: false, error, status: error.httpStatus ?? 502 };
  }

  const textOf = (event: Anthropic.MessageStreamEvent): string =>
    event.type === "content_block_delta" && event.delta.type === "text_delta" ? event.delta.text : "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let emitted = 0;
      const push = (t: string) => {
        if (t) {
          emitted += t.length;
          controller.enqueue(encoder.encode(t));
        }
      };
      try {
        if (!first.done) push(textOf(first.value));
        while (true) {
          const { value, done } = await iterator.next();
          if (done) break;
          push(textOf(value));
        }
        if (emitted === 0) emitSentinel(controller, encoder, emptyError(ctx), ctx);
      } catch (e) {
        if (!isAbort(e)) emitSentinel(controller, encoder, exceptionError(e, ctx), ctx);
      } finally {
        controller.close();
      }
    },
  });

  return { ok: true, response: new Response(stream, { headers: { ...STREAM_HEADERS } }) };
}

// ── Generic OpenAI-compatible streaming ──────────────────────────────────────

async function callOpenAICompat(
  url: string,
  apiKey: string,
  system: string,
  history: ChatHistoryItem[],
  message: string,
  maxTokens: number,
  temperature: number,
  ctx: ProviderCtx,
  extraHeaders?: Record<string, string>,
): Promise<ProviderResult> {
  const messages = [
    { role: "system", content: system },
    ...history
      .filter((h) => h.role === "user" || h.role === "assistant")
      .map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({ model: ctx.model, messages, temperature, max_tokens: maxTokens, stream: true }),
      signal: ctx.signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: true, response: new Response(null, { status: 499 }) };
    return { ok: false, error: exceptionError(e, ctx), status: 502 };
  }

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => "");
    const code = classifyHttpStatus(upstream.status, body);
    const error = buildProviderError({
      code,
      providerId: ctx.providerId,
      httpStatus: upstream.status,
      model: ctx.model,
      requestId: ctx.requestId,
      providerResponse: body,
    });
    return { ok: false, error, status: upstream.status || 502 };
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let emitted = 0;
      try {
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
              if (emitted === 0) emitSentinel(controller, encoder, emptyError(ctx), ctx);
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const delta: string = json?.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                emitted += delta.length;
                controller.enqueue(encoder.encode(delta));
              }
            } catch { /* ignore malformed frames */ }
          }
        }
        if (emitted === 0) emitSentinel(controller, encoder, emptyError(ctx), ctx);
      } catch (e) {
        if (!isAbort(e)) emitSentinel(controller, encoder, exceptionError(e, ctx), ctx);
      } finally {
        controller.close();
      }
    },
  });

  return { ok: true, response: new Response(stream, { headers: { ...STREAM_HEADERS } }) };
}

function emptyError(ctx: ProviderCtx): AofProviderError {
  return buildProviderError({
    code: "AOF_ERROR_011",
    providerId: ctx.providerId,
    model: ctx.model,
    requestId: ctx.requestId,
  });
}

/** Log + append an in-band error sentinel (failure after streaming began). */
function emitSentinel(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  error: AofProviderError,
  ctx: ProviderCtx,
): void {
  console.error(formatErrorLog(error));
  controller.enqueue(encoder.encode(encodeErrorSentinel(publicError(error, ctx.devMode))));
}

// ── Dispatch one provider ─────────────────────────────────────────────────────

function dispatch(
  id: ProviderId,
  apiKey: string,
  system: string,
  history: ChatHistoryItem[],
  message: string,
  maxTokens: number,
  temperature: number,
  baseCtx: Omit<ProviderCtx, "providerId" | "model">,
): Promise<ProviderResult> {
  const ctx: ProviderCtx = { ...baseCtx, providerId: id, model: DEFAULT_MODELS[id] };
  if (id === "anthropic") {
    return callAnthropic(system, history, message, maxTokens, temperature, ctx);
  }
  const compat = OPENAI_COMPAT[id]!;
  return callOpenAICompat(compat.url, apiKey, system, history, message, maxTokens, temperature, ctx, compat.headers);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const requestId = (globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}`).slice(0, 36);
  const devMode = req.headers.get("x-aof-dev") === "1" || process.env.AOF_DEV_MODE?.trim() === "1";

  const keys: Record<ProviderId, string | undefined> = {
    anthropic:  process.env.ANTHROPIC_API_KEY?.trim(),
    groq:       process.env.GROQ_API_KEY?.trim(),
    gemini:     process.env.GEMINI_API_KEY?.trim(),
    deepseek:   process.env.DEEPSEEK_API_KEY?.trim(),
    dashscope:  process.env.DASHSCOPE_API_KEY?.trim(),
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
  };
  const configured = PROVIDER_ORDER.filter((id) => keys[id]);

  // No provider configured at all → AOF_ERROR_001 (transparent, not a silent mock).
  if (configured.length === 0) {
    const err = buildProviderError({
      code: "AOF_ERROR_001",
      provider: "AI Provider",
      requestId,
      details:
        "No AI provider key is configured. Set one of ANTHROPIC_API_KEY, GROQ_API_KEY, " +
        "GEMINI_API_KEY, DEEPSEEK_API_KEY, DASHSCOPE_API_KEY or OPENROUTER_API_KEY.",
    });
    console.error(formatErrorLog(err));
    return Response.json({ aofError: publicError(err, devMode) }, { status: 503 });
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const message = String(body.message ?? "").trim();
  if (!message) return Response.json({ error: "message required" }, { status: 400 });

  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];

  const isRequirements = body.agent === "requirements";
  const isCodeChat = body.agent === "code-chat";
  const system = isRequirements
    ? RAA_SYSTEM
    : isCodeChat
      ? AOF_CODE_CHAT_SYSTEM
      : buildSystem(body.style, body.route);

  const temperature = isRequirements ? 0.5 : 0.7;
  const maxTokens = isRequirements ? 1200 : isCodeChat ? 800 : maxTokensFor(body.style);
  const baseCtx = { requestId, devMode, signal: req.signal };

  // Try providers in priority order; on a pre-stream failure, failover to the next
  // configured key. Every failure is logged; the user is told if a fallback took over.
  const failures: FailoverInfo["from"] = [];
  let lastError: AofProviderError | null = null;
  let lastStatus = 502;

  for (const id of configured) {
    const result = await dispatch(id, keys[id]!, system, history, message, maxTokens, temperature, baseCtx);

    if (result.ok) {
      if (failures.length > 0) {
        const failover: FailoverInfo = { to: id, toLabel: PROVIDERS[id].label, from: failures };
        result.response.headers.set("x-aof-failover", JSON.stringify(failover));
        console.warn(`[AOF FAILOVER] → ${PROVIDERS[id].label} after ${failures.map((f) => `${f.provider}(${f.code})`).join(", ")}`);
      }
      result.response.headers.set("x-aof-active-provider", id);
      return result.response;
    }

    console.error(formatErrorLog(result.error));
    failures.push({ provider: PROVIDERS[id].label, code: result.error.code, status: result.status });
    lastError = result.error;
    lastStatus = result.status;
  }

  // Every configured provider failed — surface the last error, enriched.
  const finalError: AofProviderError = lastError
    ? {
        ...lastError,
        details:
          failures.length > 1
            ? `${lastError.details} (all ${failures.length} providers failed: ${failures.map((f) => `${f.provider} ${f.code}`).join(", ")})`
            : lastError.details,
      }
    : buildProviderError({ code: "AOF_ERROR_012", requestId });
  return Response.json({ aofError: publicError(finalError, devMode) }, { status: lastStatus });
}
