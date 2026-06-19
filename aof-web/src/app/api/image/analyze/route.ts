// ── /api/image/analyze — Image Understanding Pipeline ─────────────────────────
// POST { image: "<base64 or data URL>", question?: string }
//
// Two execution paths:
//   1. Live tmap-v2 backend → proxy to /v1/image/analyze (full 5-agent pipeline)
//   2. Serverless (no tmap-v2) → call the vision model directly via the same
//      provider chain used by /api/chat and return a compatible memory record
//
// The returned `memory` object is stored in the client's localStorage by
// useImageMemoryStore so future messages can reference image context without
// re-sending the image.

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/supabase-admin";
import { adapterFor, isConfigured, primeAndStream } from "@/lib/server/ai-providers";
import { checkRateLimit, applyRateLimitHeaders } from "@/lib/server/rate-limit";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

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

async function analyzeServerless(
  imageDataUrl: string,
  question: string,
): Promise<Record<string, unknown>> {
  // Find a vision-capable provider
  const visionProviders = ["anthropic", "openrouter", "gemini"];
  for (const name of visionProviders) {
    if (!isConfigured(name)) continue;
    try {
      const adapter = adapterFor(name);
      if (!adapter) continue;

      let text = "";
      await primeAndStream(
        name,
        [
          { role: "system", content: VISION_SYS },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this image." + (question ? ` User context: ${question}` : ""),
              },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
        { temperature: 0.1, maxTokens: 2000 },
        (chunk) => { text += chunk; },
      );

      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as Record<string, unknown>;
    } catch { /* try next provider */ }
  }
  throw new Error("No vision-capable provider available. Add an API key in Settings.");
}

// ── Hash helper (works in both Node and Edge) ─────────────────────────────────

function hashBase64(b64: string): string {
  const bytes = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ""), "base64");
  return createHash("sha256").update(bytes).digest("hex");
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Rate limit
  const rl = await checkRateLimit(user.id, "image-analyze", { requests: 20, windowMs: 60_000 });
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
    const tmapToken = req.cookies.get("tmap_token")?.value
      ?? req.headers.get("x-tmap-token")
      ?? "";
    try {
      const upstream = await fetch(`${TMAP_URL}/v1/image/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tmapToken ? { Authorization: `Bearer ${tmapToken}` } : {}),
        },
        body: JSON.stringify({ image: imageData, question }),
      });
      const data = await upstream.json() as Record<string, unknown>;
      return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
    } catch (e) {
      // tmap-v2 unreachable — fall through to serverless path
      console.warn("[image/analyze] tmap-v2 unreachable, falling back to serverless:", (e as Error).message);
    }
  }

  // Path 2: serverless direct vision call
  try {
    const imageHash = hashBase64(imageData);
    const dataUrl = imageData.startsWith("data:") ? imageData : `data:image/jpeg;base64,${imageData}`;

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
      entities: Array.isArray(result.entities) ? result.entities as string[] : [],
      keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints as string[] : [],
      scene: String(result.scene ?? ""),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    };

    return NextResponse.json({ cached: false, memory });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
