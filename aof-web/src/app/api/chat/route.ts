// ── Aof Chat — real LLM endpoint (server-side) ───────────────────────────────
// Provider priority (first key found wins):
//   1. ANTHROPIC_API_KEY  → Anthropic SDK (claude-haiku-4-5 by default)
//   2. GROQ_API_KEY       → Groq / Llama 3.3-70B (free, very fast)
//   3. GEMINI_API_KEY     → Google Gemini 2.0 Flash
//   4. DEEPSEEK_API_KEY   → DeepSeek Chat
//   5. DASHSCOPE_API_KEY  → Qwen via DashScope
//   6. OPENROUTER_API_KEY → OpenRouter (google/gemini-2.0-flash-exp:free)
//   7. No key found       → 503, client falls back to offline mock
//
// Keeps all secrets server-side. Browser never sees any API key.

import Anthropic from "@anthropic-ai/sdk";
import type { ResponseStyle, RouteDecision } from "@/lib/types";
import { RAA_SYSTEM, AOF_CODE_CHAT_SYSTEM } from "@/lib/raa";

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
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_GROQ_MODEL      = "llama-3.3-70b-versatile";
const DEFAULT_GEMINI_MODEL    = "gemini-2.0-flash";
const DEFAULT_DEEPSEEK_MODEL  = "deepseek-chat";
const DEFAULT_QWEN_MODEL      = "qwen-plus";
const DEFAULT_OR_MODEL        = "google/gemini-2.0-flash-exp:free";

// OpenAI-compatible base URLs
const GROQ_URL       = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL     = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEEPSEEK_URL   = "https://api.deepseek.com/chat/completions";
const DASHSCOPE_URL  = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

// ── Anthropic streaming ───────────────────────────────────────────────────────

async function streamAnthropic(
  system: string,
  history: ChatHistoryItem[],
  message: string,
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
): Promise<Response> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;

  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((h) => h.role === "user" || h.role === "assistant")
      .map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: message },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const anthropicStream = await anthropic.messages.stream(
          { model, max_tokens: maxTokens, temperature, system, messages },
          { signal },
        );
        for await (const event of anthropicStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          controller.enqueue(encoder.encode(`\n[error: ${(e as Error).message}]`));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

// ── Generic OpenAI-compatible streaming ──────────────────────────────────────

async function streamOpenAICompat(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  history: ChatHistoryItem[],
  message: string,
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: true }),
      signal,
    });
  } catch (e) {
    return Response.json({ error: "network", detail: (e as Error).message }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: "upstream", status: upstream.status, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
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
            if (data === "[DONE]") { controller.close(); return; }
            try {
              const json = JSON.parse(data);
              const delta: string = json?.choices?.[0]?.delta?.content ?? "";
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch { /* ignore malformed frames */ }
          }
        }
      } catch { /* upstream aborted */ } finally { controller.close(); }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const anthropicKey  = process.env.ANTHROPIC_API_KEY?.trim();
  const groqKey       = process.env.GROQ_API_KEY?.trim();
  const geminiKey     = process.env.GEMINI_API_KEY?.trim();
  const deepseekKey   = process.env.DEEPSEEK_API_KEY?.trim();
  const dashscopeKey  = process.env.DASHSCOPE_API_KEY?.trim();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!anthropicKey && !groqKey && !geminiKey && !deepseekKey && !dashscopeKey && !openrouterKey) {
    return Response.json({ error: "no-key" }, { status: 503 });
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
  const isCodeChat     = body.agent === "code-chat";
  const system = isRequirements
    ? RAA_SYSTEM
    : isCodeChat
      ? AOF_CODE_CHAT_SYSTEM
      : buildSystem(body.style, body.route);

  const temperature = isRequirements ? 0.5 : 0.7;
  const maxTokens   = isRequirements ? 1200 : isCodeChat ? 800 : maxTokensFor(body.style);

  const args = [system, history, message, maxTokens, temperature, req.signal] as const;

  if (anthropicKey) return streamAnthropic(...args);

  if (groqKey) {
    const model = process.env.GROQ_MODEL?.trim() || process.env.LLAMA_MODEL?.trim() || DEFAULT_GROQ_MODEL;
    return streamOpenAICompat(GROQ_URL, groqKey, model, ...args);
  }

  if (geminiKey) {
    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    return streamOpenAICompat(GEMINI_URL, geminiKey, model, ...args);
  }

  if (deepseekKey) {
    const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
    return streamOpenAICompat(DEEPSEEK_URL, deepseekKey, model, ...args);
  }

  if (dashscopeKey) {
    const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
    return streamOpenAICompat(DASHSCOPE_URL, dashscopeKey, model, ...args);
  }

  // OpenRouter as final fallback
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OR_MODEL;
  return streamOpenAICompat(OPENROUTER_URL, openrouterKey!, model, ...args, {
    "HTTP-Referer": "https://aof-web.vercel.app",
    "X-Title": "Aof",
  });
}
