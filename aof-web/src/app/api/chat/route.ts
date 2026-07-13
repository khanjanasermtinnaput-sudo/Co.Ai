// ── Co.AI Chat — real LLM endpoint (server-side) ─────────────────────────────
// Provider priority: Anthropic (Claude) → OpenRouter. Every failure is detected,
// classified into an AOF_ERROR_xxx, logged server-side, and surfaced to the user
// — pre-stream failures as a JSON error envelope, mid-stream failures and
// failover notices as in-band control frames. The route NEVER fabricates an
// answer and NEVER silently swallows a provider failure.

import {
  classifyProviderError,
  encodeSourcesFrame,
  encodeStageFrame,
  makeFailoverNotice,
  makeModelNotice,
  makeStageNotice,
  missingKeyError,
  newRequestId,
  ERROR_CATALOG,
  type AofErrorCode,
  type AofProviderError,
} from "@/lib/errors";
import { z } from "zod";
import { decideSearch, runSearch } from "@/lib/server/search/manager";
import { buildSearchContext } from "@/lib/server/search/context-builder";
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
import { logAofError, logAofInfo, logAofStage, runStartupCheckOnce } from "@/lib/server/ai-log";
import { checkRateLimit, applyRateLimitHeaders } from "@/lib/server/rate-limit";
import { getUserFromRequest, tierForUser } from "@/lib/server/supabase-admin";
import { loadUserKeyOverrides } from "@/lib/server/keys-store";
import { planFor } from "@/lib/plans";
import type { EffortLevel, RepoMetadata, RouteDecision, WorkflowModelId } from "@/lib/types";
import {
  effortMaxTokens,
  effortPolicy,
  effortSystemAddon,
  effortTemperature,
  normalizeEffort,
  tierAllowsSearch,
} from "@/lib/effort";
import { getModelBaseName, modelTierFromId, type ModelTier } from "@/lib/model-branding";
import {
  buildWorkflowSystem,
  stagesFor,
  workflowMaxTokens,
  KANON_TEMPERATURE,
  YPERTATOS_TEMPERATURE,
} from "@/lib/server/model-workflow";
import { buildWorkflowContext } from "@/lib/server/workflow-context";
import { phaseStream } from "@/lib/server/phase-stream";
import { detectSimpleTask, simpleTaskSystemAddon } from "@/lib/server/simple-task-detector";
import { classifyTask, type TaskDecision } from "@/lib/server/task-classifier";
import {
  REQUIREMENT_ANALYSIS_SYSTEM,
  RAA_TEMPERATURE,
  buildRaaMessage,
  parseRequirementSpec,
  requirementSpecSystemAddon,
  raaUnavailableAddon,
} from "@/lib/server/requirement-analysis";
import { runBufferedCall } from "@/lib/server/buffered-call";
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
      return { system: buildSystem(route), temperature: 0.7, maxTokens: 1000 };
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
  route?: RouteDecision;
  history?: ChatHistoryItem[];
  /** "chat" = general assistant; "requirements" = RAA (DISCOVERY); "code-chat" =
   *  CoCode NORMAL_CHAT; "code-gen"/"plan"/"analyze"/"debug" = serverless build
   *  pipeline (used when the tmap-v2 backend is not configured). */
  agent?: Agent;
  /** Manual model selection: "lite" (Mikros) | "normal" (Kanon) | "pro"
   *  (Ypertatos). "pro" only actually stages — see the tier narrow below —
   *  when `agent === "code-chat"`; CoChat's header selector never sends it. */
  model?: WorkflowModelId;
  /** Reasoning-effort dial (low → extreme). Sizes token budget, temperature and
   *  the depth of the reasoning system prompt; extreme also makes conversational
   *  agents clarify before acting. Defaults to "normal" when absent/invalid. */
  effort?: string;
  /** CoCode's open workspace, when non-empty — the Ypertatos Task Classifier's
   *  complexity signal (task-classifier.ts). Ignored for any tier but "pro". */
  repo?: RepoMetadata;
}

/** Agents that hold a conversation with the user (vs. one-shot generators) —
 *  only these are asked to clarify first at extreme effort. */
function isConversationalAgent(agent: Agent | undefined): boolean {
  return !agent || agent === "chat" || agent === "requirements" || agent === "code-chat";
}

/** Coarse language tag for the Input-stage log (Master Prompt Part 3 "Detect
 *  language"). A heuristic, not a claim of NLP-grade detection. */
function detectRequestLanguage(message: string): "th" | "en" {
  return /[ก-๙]/.test(message) ? "th" : "en";
}

// Runtime validation for the untrusted request body. Permissive by design
// (every field optional, unknown keys passed through) so it rejects malformed
// *types* — e.g. message as an object, history as a string — without changing
// which well-formed requests are accepted. Caps bound abusive payloads.
const ChatBodySchema = z
  .object({
    message: z.string().max(100_000).optional(),
    route: z.object({}).passthrough().optional(),
    history: z
      .array(z.object({ role: z.string(), content: z.string() }).passthrough())
      .max(200)
      .optional(),
    agent: z.string().optional(),
    model: z.enum(["lite", "normal", "pro"]).optional(),
    effort: z.string().optional(),
    repo: z.object({ fileCount: z.number(), languages: z.array(z.string()).max(50) }).optional(),
  })
  .passthrough();

/** Single-pass config for the user-selected CoChat model. Mikros stays fast and
 *  lightweight; Kanon reasons internally first then answers in a structured way —
 *  all in one LLM call so latency and token use stay low (no second round-trip). */
function chatModelConfig(
  model: WorkflowModelId | undefined,
  route: RouteDecision | undefined,
): { system: string; temperature: number; maxTokens: number } {
  const base = buildSystem(route);
  if (model === "normal") {
    // Kanon — better reasoning, higher quality, structured answers.
    const kanon =
      `${base}\n\nREASONING DEPTH: Think the problem through internally first, then give ` +
      `a clear, well-organized answer — use brief sections or bullet points when they aid ` +
      `clarity. Keep the internal reasoning out of the reply unless the user asks to see it.`;
    return { system: kanon, temperature: 0.6, maxTokens: 1200 };
  }
  // Mikros (default) — fast, lightweight, low token, general chat.
  return { system: base, temperature: 0.7, maxTokens: 1000 };
}

/** Provider-priority chain for a CoChat turn. Kanon prefers reasoning-capable
 *  models; Mikros the fast general-chat chain. Search intent still wins. */
function chatTaskCategory(model: WorkflowModelId | undefined, route: RouteDecision | undefined): TaskCategory {
  if (route?.target === "search") return "research";
  return model === "normal" ? "reasoning" : "chat";
}

function buildSystem(route: RouteDecision | undefined): string {
  const persona =
    "You are CoAI, a friendly, knowledgeable AI assistant. Have natural conversations, " +
    "answer general questions, explain ideas clearly, and help the user think things through. " +
    "You can use Markdown when it helps readability.";
  const language =
    "RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in. " +
    "Thai input → Thai reply. English input → English reply.";
  const verbosity = "Answer clearly and helpfully at a natural length.";
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
  // Paid tiers get a higher per-minute cap (spec §13 "Priority Queue" for
  // ADVANCED) — signed-out callers fall back to the FREE-tier default.
  const chatRpm = planFor(user ? tierForUser(user) : "FREE").limits.chatRpm;
  const rl = await checkRateLimit(rateLimitKey, "chat", chatRpm);
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

  // Plain CoChat (no agent) honours the user's manual Mikros/Kanon choice; the
  // agent-driven paths (RAA, code-*, build pipeline) keep their own personas.
  const { system: baseSystem, temperature: baseTemperature, maxTokens: baseMaxTokens } = body.agent
    ? agentConfig(body.agent, body.route)
    : chatModelConfig(body.model, body.route);

  const effort: EffortLevel = normalizeEffort(body.effort);

  // requestId/turnStart cover the WHOLE turn, including any interior stages run
  // below — not just the final streamed call — so durationMs reflects real
  // end-to-end latency. Hoisted above the tier/classifier resolution (both are
  // dependency-free) so the classifier's own log line shares this same id, and
  // so the Input log's `stages:` field reflects the classifier-resolved count
  // rather than a pre-classification guess.
  const turnRequestId = newRequestId();
  const turnStart = Date.now();

  // ── Model Workflow → which stages this tier/effort combo runs ────────────────
  // Model (Mikros/Kanon/Ypertatos) owns stage SEQUENCE; effort.ts (below) owns
  // DEPTH — token budget and temperature — for whichever stage is executing.
  // Only plain CoChat (no agent) and CoCode's code-chat agent are eligible for
  // real staging this round — every other agent is a one-shot generator and
  // keeps `tier` undefined, which resolves to the same single-stage stub as
  // Mikros (see stagesFor), so its request is byte-identical to today's.
  const tierEligible = !body.agent || body.agent === "code-chat";
  const requestedTier: ModelTier | undefined = tierEligible ? modelTierFromId(body.model ?? "lite") : undefined;
  // Ypertatos ("pro") is reachable ONLY through CoCode's code-chat agent this
  // round — never CoChat's header selector. tierEligible already guarantees
  // that when it's true and body.agent isn't "code-chat", body.agent is
  // undefined (plain CoChat), so this only ever collapses that one path.
  const tier: ModelTier | undefined =
    requestedTier === "pro" && body.agent !== "code-chat" ? "lite" : requestedTier;

  // ── Ypertatos Task Classifier (Master Prompt Part 5.2) ───────────────────────
  // Mandatory, exactly once, before stagesFor() — deterministic, zero LLM calls,
  // <15ms (measured in classifyTask() itself). Decides "lightweight" vs
  // "engineering" for stagesFor()'s pro branch. A classifier failure (or tier
  // !== "pro") leaves `decision` undefined, which stagesFor() treats as
  // "lightweight" — the same Kanon-shaped table Ypertatos falls back to, per
  // 5.2's "fall back to Kanon-style workflow" failure policy.
  let decision: TaskDecision | undefined;
  if (tier === "pro") {
    try {
      decision = classifyTask({ message, history, tier, effort, repo: body.repo });
    } catch {
      decision = undefined;
    }
    logAofStage("Processing", {
      requestId: turnRequestId,
      stage: "task-classifier",
      mode: "local",
      taskCategory: decision?.category,
      complexity: decision?.complexity,
      engineeringRequired: decision?.engineeringRequired,
      workflow: decision?.workflow,
      confidence: decision?.confidence,
      reason: decision?.reasoning,
      signals: decision?.signals.join("|"),
      durationMs: decision?.durationMs,
    });
  }

  let workflowStages = stagesFor(tier, effort, { workflow: decision?.workflow });
  // Co.AI Master Prompt Part 4/5.3: Kanon makes exactly ONE provider call, and
  // Ypertatos makes at most TWO (buffered RAA + streamed answer), whatever
  // their stage count — `isStaged` just means "more than one stage".
  // `providerPhases` excludes non-"phase" stages (Context Builder, Requirement
  // Analysis), which never reach the model as a phase of the streamed call.
  let isStaged = workflowStages.length > 1;
  let providerPhases = workflowStages.filter((s) => s.execution === "phase");
  // Shared by Universal Search gating and the Simple Task Detector below — both
  // are Mikros-only behaviors scoped to the plain-chat path (no `agent`).
  const isMikrosPlainChat = !body.agent && tier === "lite";

  // ── Runtime transparency (Master Prompt Part 3 "Logging") ────────────────────
  logAofStage("Input", {
    requestId: turnRequestId,
    modelTier: tier ? getModelBaseName(tier) : (body.agent ?? "agent"),
    effort,
    language: detectRequestLanguage(message),
    requestType: body.agent ?? "chat",
    messageLength: message.length,
    historyTurns: history.length,
    repoFiles: body.repo?.fileCount,
    stages: workflowStages.length,
  });

  // ── Effort dial → system prompt addon ────────────────────────────────────────
  // The user's chosen effort (low → extreme) appends a reasoning-depth
  // instruction to the system prompt; at extreme, conversational agents are
  // told to clarify before acting. Token budget/temperature are computed later
  // (after any Ypertatos Requirement Analysis has had a chance to downgrade
  // the stage table) so they always reflect the FINAL workflowStages.
  const effortAddon = effortSystemAddon(effort, { conversational: isConversationalAgent(body.agent) });
  let system = effortAddon ? `${baseSystem}\n\n${effortAddon}` : baseSystem;

  // ── Simple Task Detector — Mikros response-style classifier ──────────────────
  // Deterministic, <10ms, zero provider calls — NOT a workflow stage (Master
  // Prompt "Simple Task Detector" spec). effort.ts (above) owns response DEPTH;
  // this only owns response SHAPE (terse / explanatory / code-focused). Scoped
  // to the plain-chat Mikros path only — Kanon and every agent-driven path are
  // unaffected, exactly like tierAllowsSearch() below.
  if (isMikrosPlainChat) {
    const detectStart = performance.now();
    const taskDetection = detectSimpleTask(message);
    const detectMs = performance.now() - detectStart;
    system = `${system}\n\n${simpleTaskSystemAddon(taskDetection.category)}`;
    logAofStage("Processing", {
      requestId: turnRequestId,
      taskCategory: taskDetection.category,
      taskReason: taskDetection.reason,
      mode: "mikros-processing",
      detectMs: Math.round(detectMs * 1000) / 1000,
    });
  }

  // ── Universal Search ─────────────────────────────────────────────────────────
  // Ground the answer in live web results when the query needs fresh information,
  // decided from route + freshness/lookup heuristics. Results become a system-prompt
  // addendum and an in-band "sources" frame the UI renders as a citation block.
  // Search failures degrade silently to model knowledge.
  //
  // Mikros exception (Master Prompt Part 3): Mikros must never execute a retrieval
  // workflow, so a plain-chat turn (no agent) on the `lite` tier skips search
  // entirely. Kanon and every agent-driven path (incl. CoCode code-chat) are
  // unaffected — this only narrows the one path that used to run unconditionally.
  let sourcesFrame = "";
  const searchDecision = isMikrosPlainChat
    ? { search: false as const, reason: "Mikros: search disabled" }
    : decideSearch(message, body.route?.target);
  if (searchDecision.search) {
    try {
      const outcome = await runSearch(message, { signal: req.signal, limit: 5 });
      if (outcome) {
        const built = buildSearchContext(outcome);
        system = `${system}\n\n${built.systemAddon}`;
        sourcesFrame = encodeSourcesFrame(built.notice);
        logAofInfo(`Search: ${outcome.provider} → ${outcome.hits.length} results (${searchDecision.reason})`);
      }
    } catch {
      // Search is best-effort — never block the answer on it.
    }
  }

  // ── Task-aware provider order (model-registry.ts), filtered to what's configured. ──
  const task = body.agent
    ? taskCategoryFor(body.agent, body.route)
    : chatTaskCategory(body.model, body.route);
  // `let`: a successful Ypertatos Requirement Analysis call below reorders
  // this so the provider that actually answered RAA is tried first for the
  // streamed call too — same brain for both, no re-discovering a dead provider.
  let providers = configuredProvidersForOrder(routeOrder(task), overrides);

  if (providers.length === 0) {
    // Nothing configured anywhere (env or per-user) → tell the user immediately.
    const primary = allProviders()[0];
    const error = missingKeyError(primary.label, primary.envVar, modelFor(primary));
    error.details =
      `No AI provider is configured. Set ${allProviders()
        .map((p) => p.envVar)
        .join(" or ")} (or save a key in Settings → API Keys) so Co.AI can reach a provider.`;
    logAofError(error);
    logAofStage("Output", { requestId: turnRequestId, success: false, durationMs: Date.now() - turnStart });
    return errorResponse(error);
  }

  // Anthropic and OpenRouter keep their existing env-override + fallback-chain
  // model selection untouched; only the four newer providers pick a model from
  // the registry based on the task (no ANTHROPIC_MODEL/OPENROUTER_MODEL surprise).
  const REGISTRY_ROUTES_MODEL = new Set<ProviderMeta["id"]>(["gemini", "deepseek", "qwen", "llama"]);

  // ── Model Workflow → local Context Builder, then (Ypertatos engineering only)
  // the buffered Requirement Analysis call, then the streamed phase protocol ──
  // Context Builder (Master Prompt Part 4.2) runs entirely server-side — no
  // provider call, no network — and REPLACES `history` with its own selection
  // (see workflow-context.ts). `stagePrefix` carries running/done StageNotice
  // frames; every remaining "phase" stage (Processing/Deep Think/Reflection/
  // Review) is a phase inside the ONE streamed provider call phaseStream()
  // parses below — nothing left to execute for those before the request goes
  // out. Requirement Analysis (Part 5.3) is the one exception: it is its own
  // complete, non-streamed call, made here, BEFORE the streamed call.
  let stagePrefix = "";
  let effectiveHistory = history;
  // Real, observed outcomes of the buffered Requirement Analysis call (if any
  // ran) — surfaced on the final Output log. Every field stays `undefined`
  // (and is omitted by logAofStage) unless RAA actually executed.
  let raaProviderCalled = false;
  let raaDegraded = false;
  let raaAttempts: number | undefined;
  let raaPromptTokens: number | undefined;
  let raaCompletionTokens: number | undefined;
  let raaReadyForPlanning: boolean | undefined;
  if (isStaged) {
    const localIdx = workflowStages.findIndex((s) => s.execution === "local");
    if (localIdx >= 0) {
      const local = workflowStages[localIdx];
      const cbStart = performance.now();
      stagePrefix += encodeStageFrame(makeStageNotice(local.stage, local.label, localIdx + 1, workflowStages.length, "running"));
      const built = buildWorkflowContext({ message, history });
      effectiveHistory = built.history;
      if (built.digest) system = `${system}\n\n${built.digest}`;
      stagePrefix += encodeStageFrame(makeStageNotice(local.stage, local.label, localIdx + 1, workflowStages.length, "done"));
      logAofStage("Processing", {
        requestId: turnRequestId,
        stage: local.stage,
        mode: "local",
        durationMs: Math.round((performance.now() - cbStart) * 1000) / 1000,
        inputMessages: built.stats.inputMessages,
        selectedMessages: built.stats.selectedMessages,
        charsSaved: built.stats.charsSaved,
        degraded: built.stats.degraded,
      });
    }

    const raaIdx = workflowStages.findIndex((s) => s.execution === "buffered");
    if (raaIdx >= 0 && decision) {
      const raaSpec = workflowStages[raaIdx];
      const totalBefore = workflowStages.length;
      stagePrefix += encodeStageFrame(makeStageNotice(raaSpec.stage, raaSpec.label, raaIdx + 1, totalBefore, "running"));

      const raa = await runBufferedCall({
        providers,
        system: REQUIREMENT_ANALYSIS_SYSTEM,
        message: buildRaaMessage({ message, history: effectiveHistory, repo: body.repo, decision }),
        history: effectiveHistory,
        maxTokens: effortMaxTokens(raaSpec.baseMaxTokens, effort),
        temperature: effortTemperature(RAA_TEMPERATURE, effort),
        signal: req.signal,
        overrides,
        taskModelFor: (p) =>
          REGISTRY_ROUTES_MODEL.has(p.id) ? process.env[p.modelEnv]?.trim() || bestModelFor(p.id, task) : undefined,
      });

      if (!raa.ok && raa.aborted) {
        // User pressed Stop during RAA — return an empty 200 stream, exactly
        // like the streamed loop's own abort handling below.
        return new Response(new ReadableStream({ start: (c) => c.close() }), { headers: TEXT_HEADERS });
      }

      raaProviderCalled = true;
      raaAttempts = raa.attempts;

      if (raa.ok) {
        const reqSpec = parseRequirementSpec(raa.text);
        system = `${system}\n\n${requirementSpecSystemAddon(reqSpec, { clarifyFirst: effortPolicy(effort).clarifyFirst })}`;
        raaPromptTokens = raa.usage?.inputTokens;
        raaCompletionTokens = raa.usage?.outputTokens;
        raaReadyForPlanning = reqSpec.readyForPlanning;
        // Same brain for both calls, and no wasted re-failover of a provider
        // RAA already ruled out.
        providers = [raa.provider, ...providers.filter((p) => p.id !== raa.provider.id)];
        stagePrefix += encodeStageFrame(makeStageNotice(raaSpec.stage, raaSpec.label, raaIdx + 1, totalBefore, "done"));
        logAofStage("Processing", {
          requestId: turnRequestId,
          stage: "requirement-analysis",
          mode: "buffered",
          executed: true,
          provider: raa.provider.label,
          model: raa.model,
          attempts: raa.attempts,
          durationMs: raa.durationMs,
          functionalRequirements: reqSpec.functional.length,
          nonFunctionalRequirements: reqSpec.nonFunctional.length,
          constraints: reqSpec.constraints.length,
          assumptions: reqSpec.assumptions.length,
          missingInformation: reqSpec.missingInformation.length,
          ambiguities: reqSpec.ambiguities.length,
          risks: reqSpec.risks.length,
          acceptanceCriteria: reqSpec.acceptanceCriteria.length,
          completenessScore: reqSpec.completenessScore ?? undefined,
          confidenceScore: reqSpec.confidenceScore ?? undefined,
          readyForPlanning: reqSpec.readyForPlanning,
          readyForPlanningSource: reqSpec.readyForPlanningSource,
          partial: reqSpec.partial,
          promptTokens: raa.usage?.inputTokens,
          completionTokens: raa.usage?.outputTokens,
        });
      } else {
        // Master Prompt 5.3: "never terminate the workflow unexpectedly" — a
        // failed RAA call degrades to the lightweight (Kanon-shaped) table
        // rather than failing the turn. `reflection` would have nothing to
        // check without a RequirementSpec, which is exactly the placeholder
        // stage 5.1 forbids, so it — and the buffered stage itself — must go.
        raaDegraded = true;
        logAofError(raa.error);
        logAofStage("Processing", {
          requestId: turnRequestId,
          stage: "requirement-analysis",
          mode: "buffered",
          executed: false,
          degraded: true,
          errorCode: raa.error.code,
          attempts: raa.attempts,
          durationMs: raa.durationMs,
          downgradedTo: "lightweight",
        });
        system = `${system}\n\n${raaUnavailableAddon()}`;
        workflowStages = stagesFor(tier, effort, { workflow: "lightweight" });
        isStaged = workflowStages.length > 1;
        providerPhases = workflowStages.filter((s) => s.execution === "phase");
        // No "done" frame for a stage the recomputed pipeline no longer has —
        // the "running" frame above already told the client it was attempted.
      }
    }

    system = buildWorkflowSystem(workflowStages, { baseSystem: system });
  }

  // ── Effort dial → token budget & temperature, from the FINAL workflowStages ──
  // Computed here (not earlier) so a Requirement Analysis downgrade above is
  // already reflected. Kanon's/Ypertatos's ONE streamed call pays for its own
  // draft/critique overhead on top of the effort-scaled answer budget
  // (workflowMaxTokens — see model-workflow.ts for why this is deliberately
  // NOT routed through effortMaxTokens() as a combined total).
  const maxTokens = isStaged ? workflowMaxTokens(workflowStages, effort) : effortMaxTokens(baseMaxTokens, effort);
  const temperature = isStaged
    ? effortTemperature(tier === "pro" ? YPERTATOS_TEMPERATURE : KANON_TEMPERATURE, effort)
    : effortTemperature(baseTemperature, effort);

  // True only when RAA actually ran AND succeeded — a failed RAA already
  // replaced workflowStages with the lightweight table above, so this stays
  // an honest signal of what the streamed call is actually grounded in.
  const usedRequirementAnalysis = workflowStages.some((s) => s.stage === "requirement-analysis");
  const workflowMode: string | undefined =
    tier === "pro"
      ? usedRequirementAnalysis
        ? "ypertatos-engineering"
        : "ypertatos-lightweight"
      : isStaged
        ? "kanon-single-call"
        : undefined;

  // ── Try each configured provider in priority order, announcing any failover. ──
  let pendingFailover: ReturnType<typeof makeFailoverNotice> | undefined;
  let lastError: AofProviderError | undefined;

  for (let i = 0; i < providers.length; i++) {
    const p: ProviderMeta = providers[i];
    const explicitModel = process.env[p.modelEnv]?.trim();
    const taskModel = REGISTRY_ROUTES_MODEL.has(p.id) ? explicitModel || bestModelFor(p.id, task) : undefined;
    const model = taskModel || modelFor(p);
    const requestId = newRequestId();
    const ctx = { provider: p, model, requestId };

    const rawGen = adapterFor(p.id)({
      system,
      history: effectiveHistory,
      message,
      maxTokens,
      temperature,
      signal: req.signal,
      overrides,
      taskModel,
    });
    // Kanon: wrap the ONE provider call so its internal DRAFT/DEEPTHINK/FINAL
    // phases (see model-workflow.ts, phase-stream.ts) are parsed back out into
    // real, observable stages — draft/critique text is suppressed here and
    // never reaches primeAndStream; only the FINAL phase streams to the user.
    // Trying `p` fresh on each failover loop iteration means a phaseStream
    // failure before its first chunk fails over exactly like the plain path.
    const gen = isStaged
      ? phaseStream(rawGen, {
          phases: providerPhases,
          stageOffset: workflowStages.length - providerPhases.length + 1,
          totalStages: workflowStages.length,
          errorCtx: { providerLabel: p.label, model, requestId },
          onComplete: (s) => {
            for (const rec of s.phases) {
              logAofStage("Processing", {
                requestId: turnRequestId,
                stage: rec.stage,
                executed: rec.executed,
                chars: rec.chars,
                durationMs: rec.durationMs,
              });
            }
            logAofStage("Output", {
              requestId: turnRequestId,
              provider: p.label,
              model,
              success: true,
              durationMs: Date.now() - turnStart,
              promptTokens: s.usage?.inputTokens,
              completionTokens: s.usage?.outputTokens,
              mode: workflowMode,
              providerCalls: raaProviderCalled ? 2 : 1,
              raaPromptTokens,
              raaCompletionTokens,
              raaDegraded: raaDegraded || undefined,
              readyForPlanning: raaReadyForPlanning,
              retries: raaAttempts !== undefined ? raaAttempts - 1 : undefined,
              fallback: s.fallback,
            });
          },
        })
      : rawGen;
    const notice = makeModelNotice(p.label, model, ROLE_LABEL[task]);
    const prefixFrame =
      stagePrefix + sourcesFrame + (pendingFailover ? failoverFrame(pendingFailover) : "") + modelFrame(notice);

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
      if (!isStaged) {
        // Token usage isn't threaded through to this layer for the non-staged
        // path — reporting a made-up figure would violate "never fabricate a
        // measurement", so it's omitted. Kanon logs real usage from
        // phaseStream's onComplete once the generation actually finishes,
        // which can be after this Response is already returned to the client.
        logAofStage("Output", {
          requestId: turnRequestId,
          provider: p.label,
          model,
          success: true,
          durationMs: Date.now() - turnStart,
        });
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
  logAofStage("Output", {
    requestId: turnRequestId,
    success: false,
    durationMs: Date.now() - turnStart,
    mode: workflowMode,
    providerCalls: raaProviderCalled ? 2 : 1,
  });
  return errorResponse(lastError!);
}
