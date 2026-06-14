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

/** Build the system prompt: persona + same-language rule + verbosity + intent. */
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

export async function POST(req: Request): Promise<Response> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  // No key configured → tell the client to use its offline mock fallback.
  if (!key) {
    // Diagnostic (names only, never values): helps spot a misnamed var or one
    // set for the wrong environment. Safe to log — no secrets are exposed.
    const related = Object.keys(process.env).filter((k) =>
      /openrouter|openai|api[_-]?key|aof|gemini|groq|model/i.test(k),
    );
    console.error(
      `[api/chat] OPENROUTER_API_KEY missing. Related env var NAMES present: ${
        related.length ? related.join(", ") : "(none)"
      }`,
    );
    return Response.json({ error: "no-key", envNames: related }, { status: 503 });
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
