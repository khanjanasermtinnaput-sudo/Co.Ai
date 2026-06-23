// ── Co.AI Chat — real LLM endpoint (server-side) ─────────────────────────────
// Provider priority: Anthropic (Claude) → OpenRouter. Every failure is detected,
// classified into an AOF_ERROR_xxx, logged server-side, and surfaced to the user
// — pre-stream failures as a JSON error envelope, mid-stream failures and
// failover notices as in-band control frames. The route NEVER fabricates an
// answer and NEVER silently swallows a provider failure.

import {
  classifyProviderError,
  encodeSourcesFrame,
  makeFailoverNotice,
  makeModelNotice,
  missingKeyError,
  newRequestId,
  ERROR_CATALOG,
  type AofErrorCode,
  type AofProviderError,
} from "@/lib/errors";
import { z } from "zod";
import { decideSearch, runSearch } from "@/lib/server/search/manager";
import { buildSearchContext } from "@/lib/server/search/context-builder";
import { normalizeSearchMode } from "@/lib/server/search/types";
import {
  adapterFor,
  allProviders,
  configuredProvidersForOrder,
  failoverFrame,
  isConfigured,
  modelFor,
  modelFrame,
  primeAndStream,
  type KeyOverrides,
  type ProviderMeta,
} from "@/lib/server/ai-providers";
import { bestModelFor, matchScore, ROLE_LABEL, routeOrder, type TaskCategory } from "@/lib/server/model-registry";
import { logAofError, logAofInfo, runStartupCheckOnce } from "@/lib/server/ai-log";
import { checkRateLimit, applyRateLimitHeaders } from "@/lib/server/rate-limit";
import { getUserFromRequest } from "@/lib/server/supabase-admin";
import { loadUserKeyOverrides } from "@/lib/server/keys-store";
import type { ResponseStyle, RouteDecision } from "@/lib/types";
import {
  RAA_SYSTEM,
  AOF_CODE_CHAT_SYSTEM,
  AOF_CODE_GEN_SYSTEM,
  AOF_PLAN_SYSTEM,
  AOF_ANALYZE_SYSTEM,
  AOF_DEBUG_SYSTEM,
} from "@/lib/raa";

/** Agents that do not need the tmap-v2 backend: a single-pass LLM call via the
 *  same provider chain. Each carries its own persona, temperature and budget. */
type Agent = "chat" | "requirements" | "code-chat" | "code-gen" | "plan" | "analyze" | "debug";

function agentConfig(
  agent: Agent | undefined,
  style: ResponseStyle | undefined,
  route: RouteDecision | undefined,
): { system: string; temperature: number; maxTokens: number } {
  switch (agent) {
    case "requirements":
      return { system: RAA_SYSTEM, temperature: 0.5, maxTokens: 1200 };
    case "code-chat":
      return { system: AOF_CODE_CHAT_SYSTEM, temperature: 0.7, maxTokens: 800 };
    case "code-gen":
      return { system: AOF_CODE_GEN_SYSTEM, temperature: 0.4, maxTokens: 4000 };
    case "plan":
      return { system: AOF_PLAN_SYSTEM, temperature: 0.5, maxTokens: 2000 };
    case "analyze":
      return { system: AOF_ANALYZE_SYSTEM, temperature: 0.5, maxTokens: 2000 };
    case "debug":
      return { system: AOF_DEBUG_SYSTEM, temperature: 0.4, maxTokens: 2500 };
    default:
      return { system: buildSystem(style, route), temperature: 0.7, maxTokens: maxTokensFor(style) };
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Streaming + per-model fallback can need more than the default budget; request
// the max the plan allows so a slow model fails over instead of being killed.
export const maxDuration = 60;

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  message?: string;
  style?: ResponseStyle;
  route?: RouteDecision;
  history?: ChatHistoryItem[];
  /** "chat" = general assistant; "requirements" = RAA (DISCOVERY); "code-chat" =
   *  CoCode NORMAL_CHAT; "code-gen"/"plan"/"analyze"/"debug" = serverless build
   *  pipeline (used when the tmap-v2 backend is not configured). */
  agent?: Agent;
  /** Universal Search mode: "auto" (default) | "off" | "force". */
  searchMode?: string;
}

// Runtime validation for the untrusted request body. Permissive by design
// (every field optional, unknown keys passed through) so it rejects malformed
// *types* — e.g. message as an object, history as a string — without changing
// which well-formed requests are accepted. Caps bound abusive payloads.
const ChatBodySchema = z
  .object({
    message: z.string().max(100_000).optional(),
    style: z.string().optional(),
    route: z.object({}).passthrough().optional(),
    history: z
      .array(z.object({ role: z.string(), content: z.string() }).passthrough())
      .max(200)
      .optional(),
    agent: z.string().optional(),
    searchMode: z.string().optional(),
  })
  .passthrough();

function buildSystem(style: ResponseStyle | undefined, route: RouteDecision | undefined): string {
  const persona =
    "You are CoAI, a friendly, knowledgeable AI assistant. Have natural conversations, " +
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

/** Which provider-priority chain (model-registry.ts) a request should use,
 *  derived from the agent already chosen by the caller (or the chat router's
 *  3-way target when no agent is set). */
function taskCategoryFor(agent: Agent | undefined, route: RouteDecision | undefined): TaskCategory {
  switch (agent) {
    case "code-gen":
    case "code-chat":
    case "debug":
      return "coding";
    case "plan":
      return "research";
    case "analyze":
      return "reasoning";
    case "requirements":
      return "chat";
    default:
      return route?.target === "search" ? "research" : "chat";
  }
}

function maxTokensFor(style: ResponseStyle | undefined): number {
  if (style === "short") return 500;
  if (style === "detailed") return 1800;
  return 1000;
}

/** Map an AOF error code onto a representative HTTP status for the JSON envelope. */
function httpStatusFor(code: AofErrorCode): number {
  switch (code) {
    case "AOF_ERROR_001": // missing key
    case "AOF_ERROR_013": // misconfiguration
      return 503;
    case "AOF_ERROR_002":
    case "AOF_ERROR_003":
    case "AOF_ERROR_010":
      return 401;
    case "AOF_ERROR_004":
      return 402;
    case "AOF_ERROR_005":
      return 429;
    case "AOF_ERROR_008":
      return 504;
    case "AOF_ERROR_009":
      return 400;
    default: // 006/007/011/012 — upstream/provider problems
      return 502;
  }
}

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
} as const;

/** Return a structured error as a JSON response the client decodes into a panel. */
function errorResponse(error: AofProviderError): Response {
  return new Response(JSON.stringify(error), {
    status: httpStatusFor(error.code),
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Coagentix-Error": error.code },
  });
}

/** Log + emit the startup checklist (once per process). Status is derived from
 *  key presence so it is cheap and runs without any network round-trip. */
function logStartup(): void {
  const providers = allProviders();
  const items = providers.map((p) => ({
    label: `${p.label} API Key ${isConfigured(p) ? "Loaded" : "Missing"}`,
    ok: isConfigured(p),
  }));
  const configured = providers.filter((p) => isConfigured(p)).length;
  const status = configured === 0 ? "DOWN" : configured === providers.length ? "OPERATIONAL" : "DEGRADED";
  runStartupCheckOnce(items, status);
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handleChat(req);
  } catch (err) {
    // Last-resort guard: an unexpected throw must still become a structured error
    // envelope — never an opaque 500 the client can only render as a generic
    // "Co.AI is unavailable" panel. This also logs the real stack for diagnosis.
    const e = err as { message?: string; status?: number; stack?: string };
    const error = classifyProviderError({
      provider: "Co.AI",
      message: e?.message ?? "Unexpected server error",
      status: typeof e?.status === "number" ? e.status : undefined,
      stack: e?.stack,
    });
    logAofError(error);
    return errorResponse(error);
  }
}

async function handleChat(req: Request): Promise<Response> {
  logStartup();

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Identify caller: prefer authenticated user ID, fall back to forwarded IP.
  const user = await getUserFromRequest(req).catch(() => null);
  const rateLimitKey =
    user?.id ??
    (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "anon").split(",")[0].trim();
  const rl = await checkRateLimit(rateLimitKey, "chat");
  if (!rl.allowed) {
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    applyRateLimitHeaders(headers, rl);
    const error = classifyProviderError({
      provider: "Co.AI",
      message: `Rate limit exceeded. Try again in ${rl.retryAfterSec}s.`,
      status: 429,
    });
    return new Response(JSON.stringify(error), { status: 429, headers });
  }

  // Anonymous callers: enforce a daily message cap (server-side) to prevent LLM cost abuse.
  // Authenticated users are trusted via Supabase JWT and fall through to their tier limits.
  if (!user) {
    const ipKey =
      (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "anon")
        .split(",")[0].trim();
    const dailyRl = await checkRateLimit(ipKey, "guest_daily");
    if (!dailyRl.allowed) {
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      applyRateLimitHeaders(headers, dailyRl);
      const error = classifyProviderError({
        provider: "Co.AI",
        message: "Guest daily limit reached. Sign in to continue.",
        status: 429,
      });
      return new Response(JSON.stringify(error), { status: 429, headers });
    }
  }

  // Per-user keys (Settings → API Keys) take priority over the server's env vars.
  const overrides: KeyOverrides = await loadUserKeyOverrides(user?.id);

  let body: ChatBody;
  try {
    const raw = await req.json();
    body = ChatBodySchema.parse(raw) as ChatBody;
  } catch {
    const error = classifyProviderError({
      provider: "Co.AI",
      message: "Request body was not valid JSON or failed validation.",
      hint: "config",
    });
    return errorResponse(error);
  }

  const message = String(body.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "message required" }, { status: 400 });
  }

  const history = (Array.isArray(body.history) ? body.history.slice(-20) : []).filter(
    (h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string",
  );

  const { system: baseSystem, temperature, maxTokens } = agentConfig(body.agent, body.style, body.route);
  let system = baseSystem;

  // ── Universal Search ─────────────────────────────────────────────────────────
  // Ground the answer in live web results when the query needs fresh information.
  // OFF never searches, FORCE always does, AUTO decides from route + heuristics.
  // Results become a system-prompt addendum and an in-band "sources" frame the UI
  // renders as a citation block. Search failures degrade silently to model knowledge.
  let sourcesFrame = "";
  const decision = decideSearch(message, normalizeSearchMode(body.searchMode), body.route?.target);
  if (decision.search) {
    try {
      const outcome = await runSearch(message, { signal: req.signal, limit: 5 });
      if (outcome) {
        const built = buildSearchContext(outcome);
        system = `${system}\n\n${built.systemAddon}`;
        sourcesFrame = encodeSourcesFrame(built.notice);
        logAofInfo(`Search: ${outcome.provider} → ${outcome.hits.length} results (${decision.reason})`);
      }
    } catch {
      // Search is best-effort — never block the answer on it.
    }
  }

  // ── Task-aware provider order (model-registry.ts), filtered to what's configured. ──
  const task = taskCategoryFor(body.agent, body.route);
  const providers = configuredProvidersForOrder(routeOrder(task), overrides);

  if (providers.length === 0) {
    // Nothing configured anywhere (env or per-user) → tell the user immediately.
    const primary = allProviders()[0];
    const error = missingKeyError(primary.label, primary.envVar, modelFor(primary));
    error.details =
      `No AI provider is configured. Set ${allProviders()
        .map((p) => p.envVar)
        .join(" or ")} (or save a key in Settings → API Keys) so Co.AI can reach a provider.`;
    logAofError(error);
    return errorResponse(error);
  }

  // ── Try each configured provider in priority order, announcing any failover. ──
  let pendingFailover: ReturnType<typeof makeFailoverNotice> | undefined;
  let lastError: AofProviderError | undefined;

  // Anthropic and OpenRouter keep their existing env-override + fallback-chain
  // model selection untouched; only the four newer providers pick a model from
  // the registry based on the task (no ANTHROPIC_MODEL/OPENROUTER_MODEL surprise).
  const REGISTRY_ROUTES_MODEL = new Set<ProviderMeta["id"]>(["gemini", "deepseek", "qwen", "llama"]);

  for (let i = 0; i < providers.length; i++) {
    const p: ProviderMeta = providers[i];
    const explicitModel = process.env[p.modelEnv]?.trim();
    const taskModel = REGISTRY_ROUTES_MODEL.has(p.id) ? explicitModel || bestModelFor(p.id, task) : undefined;
    const model = taskModel || modelFor(p);
    const requestId = newRequestId();
    const ctx = { provider: p, model, requestId };

    const gen = adapterFor(p.id)({
      system,
      history,
      message,
      maxTokens,
      temperature,
      signal: req.signal,
      overrides,
      taskModel,
    });
    const notice = makeModelNotice(p.label, model, ROLE_LABEL[task]);
    const prefixFrame =
      sourcesFrame + (pendingFailover ? failoverFrame(pendingFailover) : "") + modelFrame(notice);

    const result = await primeAndStream({ ctx, gen, prefixFrame });

    if (result.aborted) {
      // User pressed Stop during priming — return an empty 200 stream.
      return new Response(new ReadableStream({ start: (c) => c.close() }), { headers: TEXT_HEADERS });
    }

    if (result.ok && result.stream) {
      if (pendingFailover) {
        logAofInfo(
          `Failover: ${pendingFailover.from} → ${pendingFailover.to} (${pendingFailover.reason})`,
        );
      }
      return new Response(result.stream, { headers: TEXT_HEADERS });
    }

    // This provider failed before producing a token.
    lastError = result.error!;
    logAofError(lastError);

    const next = providers[i + 1];
    if (next && ERROR_CATALOG[lastError.code].failoverWorthy) {
      pendingFailover = makeFailoverNotice(
        p.label,
        next.label,
        `${lastError.code} · ${lastError.problem}`,
        matchScore(p.id, next.id, task),
      );
      continue;
    }
    break;
  }

  // Every configured provider failed.
  return errorResponse(lastError!);
}
