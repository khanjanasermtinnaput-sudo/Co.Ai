// ── /api/image/analyze — Image Understanding Pipeline ─────────────────────────
// POST { image: "<base64 or data URL>", question?: string }
//
// Two execution paths:
//   1. Live tmap-v2 backend → proxy to /v1/image/analyze (full 5-agent pipeline)
//   2. Serverless (no tmap-v2) → direct vision API call (Anthropic → OpenRouter
//      → Gemini) and return a compatible memory record
//
// The returned `memory` object is stored in the client's localStorage by
// useImageMemoryStore so future messages can reference image context without
// re-sending the image.

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/supabase-admin";
import { checkRateLimit, applyRateLimitHeaders } from "@/lib/server/rate-limit";
import { randomUUID, createHash } from "node:crypto";

export const maxDuration = 60;

const TMAP_URL = process.env.NEXT_PUBLIC_TMAP_URL ?? process.env.TMAP_URL ?? "";

// ── Serverless vision path ────────────────────────────────────────────────────

const VISION_SYS = `You are the Vision Agent in Coagentix. Analyze the image completely and return ONLY valid JSON with this shape:
{
  "shortSummary": "one concise line describing the image",
  "detailedSummary": "a rich paragraph capturing everything important",
  "ocrText": "every piece of text visible in the image, verbatim, all languages",
  "entities": ["named people, products, companies, places, model names"],
  "keyPoints": ["the most important facts a user might ask about later"],
  "scene": "one of: indoor, outdoor, office, classroom, website, application, document, other",
  "reusableContext": "a compact knowledge block that can answer future questions about this image without re-reading it — include key text, numbers, entities and structure"
}
Do not include markdown fences. Never invent text not visible in the image.`;

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
}

async function tryAnthropic(dataUrl: string, prompt: string): Promise<Record<string, unknown> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const mime = dataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg";
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: VISION_SYS,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
        ],
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find((b) => b.type === "text")?.text ?? "";
  return extractJson(text);
}

async function tryOpenRouter(dataUrl: string, prompt: string): Promise<Record<string, unknown> | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  // Use a vision-capable model; fall back to a known multimodal free model
  const model = process.env.OPENROUTER_VISION_MODEL ?? "google/gemini-2.0-flash-exp:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.1,
      messages: [
        { role: "system", content: VISION_SYS },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  return extractJson(text);
}

async function tryGemini(dataUrl: string, prompt: string): Promise<Record<string, unknown> | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const mime = dataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg";
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: VISION_SYS }] },
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.1 },
      }),
    },
  );
  if (!res.ok) return null;
  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return extractJson(text);
}

async function analyzeServerless(
  imageDataUrl: string,
  question: string,
): Promise<Record<string, unknown>> {
  const prompt = "Analyze this image." + (question ? ` User context: ${question}` : "");

  const result =
    (await tryAnthropic(imageDataUrl, prompt).catch(() => null)) ??
    (await tryOpenRouter(imageDataUrl, prompt).catch(() => null)) ??
    (await tryGemini(imageDataUrl, prompt).catch(() => null));

  if (result) return result;
  throw new Error(
    "No vision-capable provider available. Add ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in Settings.",
  );
}

// ── Hash helper ────────────────────────────────────────────────────────────────

function hashBase64(b64: string): string {
  const bytes = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ""), "base64");
  return createHash("sha256").update(bytes).digest("hex");
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const rl = await checkRateLimit(user.id, "api");
  if (!rl.allowed) {
    const res = NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    applyRateLimitHeaders(res.headers, rl);
    return res;
  }

  let body: { image?: string; question?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const imageData = String(body.image ?? "").trim();
  const question = String(body.question ?? "").trim().slice(0, 2000);

  if (!imageData) {
    return NextResponse.json({ error: "image (base64 or data URL) required" }, { status: 400 });
  }
  if (imageData.length > 14 * 1024 * 1024) {
    return NextResponse.json({ error: "image too large (max ~10 MB)" }, { status: 413 });
  }

  // Path 1: proxy to live tmap-v2 backend
  if (TMAP_URL) {
    const tmapToken =
      req.cookies.get("tmap_token")?.value ?? req.headers.get("x-tmap-token") ?? "";
    try {
      const upstream = await fetch(`${TMAP_URL}/v1/image/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tmapToken ? { Authorization: `Bearer ${tmapToken}` } : {}),
        },
        body: JSON.stringify({ image: imageData, question }),
      });
      const data = (await upstream.json()) as Record<string, unknown>;
      return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
    } catch (e) {
      console.warn("[image/analyze] tmap-v2 unreachable, falling back to serverless:", (e as Error).message);
    }
  }

  // Path 2: serverless direct vision call
  try {
    const imageHash = hashBase64(imageData);
    const dataUrl = imageData.startsWith("data:")
      ? imageData
      : `data:image/jpeg;base64,${imageData}`;

    const result = await analyzeServerless(dataUrl, question);

    const now = Date.now();
    const memory = {
      id: randomUUID(),
      userId: user.id,
      imageHash,
      mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg",
      shortSummary: String(result.shortSummary ?? ""),
      detailedSummary: String(result.detailedSummary ?? ""),
      reusableContext: String(result.reusableContext ?? ""),
      ocrText: String(result.ocrText ?? ""),
      entities: Array.isArray(result.entities) ? (result.entities as string[]) : [],
      keyPoints: Array.isArray(result.keyPoints) ? (result.keyPoints as string[]) : [],
      scene: String(result.scene ?? ""),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    };

    return NextResponse.json({ cached: false, memory });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
