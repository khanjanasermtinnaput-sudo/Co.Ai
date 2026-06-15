// ── Aof AI — Provider Health Check ───────────────────────────────────────────
// GET /api/providers/health        → shallow check (which keys are configured)
// GET /api/providers/health?deep=1 → deep check (ping each configured provider)
//
// Powers the diagnostic Provider Status Panel. Never exposes the key itself —
// only configured/connected state, latency, and (on failure) the AOF_ERROR code.

import Anthropic from "@anthropic-ai/sdk";
import {
  type AofErrorCode,
  type ProviderId,
  PROVIDERS,
  PROVIDER_ORDER,
  classifyException,
  classifyHttpStatus,
} from "@/lib/provider-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ProviderStatus = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNKNOWN";
export type SystemStatus = "OPERATIONAL" | "DEGRADED" | "DOWN";

interface ProviderHealth {
  id: ProviderId;
  label: string;
  status: ProviderStatus;
  configured: boolean;
  model?: string;
  latencyMs?: number;
  error?: { code: AofErrorCode; status?: number };
}

const DEGRADED_LATENCY_MS = 4000;
const PING_TIMEOUT_MS = 8000;

const MODELS: Record<ProviderId, string> = {
  anthropic:  process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
  groq:       process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  gemini:     process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
  deepseek:   process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
  dashscope:  process.env.QWEN_MODEL?.trim() || "qwen-plus",
  openrouter: process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.0-flash-exp:free",
};

const OPENAI_COMPAT_URL: Partial<Record<ProviderId, string>> = {
  groq:       "https://api.groq.com/openai/v1/chat/completions",
  gemini:     "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  deepseek:   "https://api.deepseek.com/chat/completions",
  dashscope:  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

function keyFor(id: ProviderId): string | undefined {
  return process.env[PROVIDERS[id].envVar]?.trim();
}

async function pingProvider(id: ProviderId, key: string): Promise<ProviderHealth> {
  const base: ProviderHealth = {
    id,
    label: PROVIDERS[id].label,
    status: "UNKNOWN",
    configured: true,
    model: MODELS[id],
  };
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    if (id === "anthropic") {
      const anthropic = new Anthropic({ apiKey: key });
      await anthropic.messages.create(
        { model: MODELS[id], max_tokens: 1, messages: [{ role: "user", content: "ping" }] },
        { signal: controller.signal },
      );
    } else {
      const url = OPENAI_COMPAT_URL[id]!;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODELS[id],
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ...base,
          status: "DISCONNECTED",
          error: { code: classifyHttpStatus(res.status, body), status: res.status },
        };
      }
    }
    const latencyMs = Date.now() - started;
    return { ...base, status: latencyMs > DEGRADED_LATENCY_MS ? "DEGRADED" : "CONNECTED", latencyMs };
  } catch (e) {
    return { ...base, status: "DISCONNECTED", error: { code: classifyException(e) } };
  } finally {
    clearTimeout(timer);
  }
}

function shallow(id: ProviderId): ProviderHealth {
  const key = keyFor(id);
  return key
    ? { id, label: PROVIDERS[id].label, status: "CONNECTED", configured: true, model: MODELS[id] }
    : {
        id,
        label: PROVIDERS[id].label,
        status: "DISCONNECTED",
        configured: false,
        error: { code: "AOF_ERROR_001" },
      };
}

function systemStatusOf(providers: ProviderHealth[]): SystemStatus {
  const configured = providers.filter((p) => p.configured);
  if (configured.length === 0) return "DOWN";
  const healthy = configured.filter((p) => p.status === "CONNECTED");
  if (healthy.length === configured.length) return "OPERATIONAL";
  if (healthy.length === 0 && !configured.some((p) => p.status === "DEGRADED")) return "DOWN";
  return "DEGRADED";
}

export async function GET(req: Request): Promise<Response> {
  const deep = new URL(req.url).searchParams.get("deep") === "1";

  const providers: ProviderHealth[] = deep
    ? await Promise.all(
        PROVIDER_ORDER.map((id) => {
          const key = keyFor(id);
          return key ? pingProvider(id, key) : Promise.resolve(shallow(id));
        }),
      )
    : PROVIDER_ORDER.map(shallow);

  return Response.json(
    { systemStatus: systemStatusOf(providers), providers, deep, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
