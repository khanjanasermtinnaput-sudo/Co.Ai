// ── Aof Chat — real LLM endpoint (server-side) ───────────────────────────────
// Streams a general-assistant reply from an OpenAI-compatible provider
// (OpenRouter by default) so "Chat with Aof" can hold a normal conversation and
// answer knowledge questions for real. Keeps secrets server-side: the browser
// never sees the API key. When no key is configured the route returns 503 and the
// client transparently falls back to the offline mock engine.

import type { ResponseStyle, RouteDecision } from "@/lib/types";

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
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Free-by-default: a no-cost OpenRouter model (rate-limited). Override with the
// OPENROUTER_MODEL env var to use a paid/higher-quality model.
const DEFAULT_MODEL = "google/gemini-2.0-flash-exp:free";

/** Build the system prompt: persona + behavior rules + same-language + verbosity + intent. */
function buildSystem(style: ResponseStyle | undefined, route: RouteDecision | undefined): string {
  // Core Aof Chat persona + behavior contract (see product spec "AOF CHAT SYSTEM
  // PROMPT"). The goal: feel like ChatGPT/Claude — natural, intent-aware, direct.
  const persona =
    "You are Aof — a thoughtful, knowledgeable AI assistant. Talk like a sharp, " +
    "friendly human expert, not like a corporate FAQ.";

  const behavior = [
    "How you communicate:",
    "1. Understand what the user actually wants BEFORE you answer. Read the intent, not just the keywords.",
    "2. When they ask a question, ANSWER IT DIRECTLY first. Do not open with a summary, a restatement of the question, or a preamble.",
    "3. NEVER summarize the conversation or your own answer unless the user explicitly asks for a summary.",
    "4. If something essential is missing or ambiguous, ask one or two concise follow-up questions instead of guessing.",
    "5. Write in natural, conversational language. Never use rigid robotic templates (no forced \"TL;DR / Why / Conclusion\" scaffolding) unless the content genuinely calls for structure.",
    "6. Keep the full conversation in mind — refer back to what was already said and stay consistent.",
    "7. When teaching, go step by step, explain clearly, and adapt to the user's apparent level.",
    "8. When you're genuinely unsure, say so and ask — don't invent facts.",
    "Use Markdown only when it improves readability (lists, code, emphasis). Prose is fine for prose.",
  ].join("\n");

  const language =
    "RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in. " +
    "Thai input → Thai reply. English input → English reply.";

  const verbosity =
    style === "short"
      ? "LENGTH: Be brief — 1 to 3 tight sentences (or a short paragraph). Lead with the answer. No filler."
      : style === "detailed"
        ? "LENGTH: Give a thorough, well-structured walkthrough with reasoning and concrete examples where they help. Still answer the core question up front."
        : "LENGTH: Answer at a natural, balanced length — enough to be genuinely useful, no padding.";

  // Routing awareness: Aof has specialist modes. Chat still answers helpfully and
  // directly; it just signals when a specialist mode would take the task further.
  const intent =
    route?.target === "search"
      ? "The user wants information. Answer from your knowledge. If it depends on very recent or live data you may not have (today's news, live prices/events), say so briefly and still give your best answer."
      : route?.target === "code"
        ? "This leans toward coding. Answer the question directly and practically (give the actual code/fix if it's small). You may add a brief note that Aof Code can take a full build further — but never refuse to help here."
        : route?.target === "titan"
          ? "TITAN MODE — the deepest reasoning mode. Think deeply before answering. Break the problem into its parts, lay out the options with honest trade-offs, surface the real risks, and finish with a clear recommendation. Use structure (short headings, lists) where it aids clarity. Be concise when the problem is simple and detailed when it's genuinely complex — never pad. You may note that Titan is built for exactly this kind of analysis."
          : "";

  return [persona, behavior, language, verbosity, intent].filter(Boolean).join("\n\n");
}

function maxTokensFor(style: ResponseStyle | undefined): number {
  if (style === "short") return 450;
  if (style === "detailed") return 2000;
  return 1100;
}

export async function POST(req: Request): Promise<Response> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  // No key configured → tell the client to use its offline mock fallback.
  if (!key) {
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
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;

  const messages = [
    { role: "system", content: buildSystem(body.style, body.route) },
    ...history
      .filter((h) => h && (h.role === "user" || h.role === "assistant") && h.content)
      .map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        // OpenRouter attribution headers (optional but recommended).
        "HTTP-Referer": "https://aof-web.vercel.app",
        "X-Title": "Aof",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: maxTokensFor(body.style),
        stream: true,
      }),
      signal: req.signal,
    });
  } catch (e) {
    return Response.json(
      { error: "network", detail: (e as Error).message },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: "upstream", status: upstream.status, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  // Re-stream just the delta text (OpenAI SSE → plain UTF-8 chunks) so the client
  // can append tokens directly without parsing provider-specific frames.
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
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const delta: string = json?.choices?.[0]?.delta?.content ?? "";
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              /* ignore keep-alive / malformed frame */
            }
          }
        }
      } catch {
        /* upstream aborted or closed — end the stream gracefully */
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
