// ── Co.AI API client ──────────────────────────────────────────────────────────
// Thin, typed layer over the AI providers. Transparency is the rule: when a
// provider fails, the failure is surfaced to the UI as a structured
// `AofProviderError` (via `handlers.onError`) — it is NEVER hidden behind a fake
// "mock" reply. The offline mock engine still exists, but only runs when the app
// is *explicitly* put in demo mode (`NEXT_PUBLIC_AOF_DEMO=1`); it is off by
// default so the UI never appears to work when AI is actually down.

import type { ChatModel, EffortLevel, ProjectBrief, RouteDecision } from "./types";
import {
  mockChat,
  mockCodeChat,
  mockCodeRun,
  mockRequirements,
  mockPlan,
  mockAnalyze,
  mockDebug,
  type StreamHandlers,
} from "./mock";
import {
  classifyProviderError,
  decodeFrames,
  emptyResponseError,
  isAofProviderError,
  type AofProviderError,
} from "./errors";
import { parseBrief, summaryToBrief } from "./raa";
import { getSupabase } from "./supabase/client";

/** Resolve the API base. Empty string means "same origin" (Next rewrite proxy). */
export function getApiBase(): string | null {
  const pub =
    process.env.NEXT_PUBLIC_COAGENTIX_API_BASE ??
    process.env.NEXT_PUBLIC_AOF_API_BASE;
  if (typeof pub === "string" && pub.length > 0) return pub.replace(/\/$/, "");
  // When COAGENTIX_API_PROXY / AOF_API_PROXY is set we rewrite /v1 at the edge → same-origin.
  if (
    process.env.NEXT_PUBLIC_COAGENTIX_SAME_ORIGIN === "1" ||
    process.env.NEXT_PUBLIC_AOF_SAME_ORIGIN === "1"
  ) return "";
  return null;
}

export function isLive(): boolean {
  return getApiBase() !== null;
}

/** Explicit, opt-in offline demo — simulated responses, clearly not real AI. */
export function isDemoMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_COAGENTIX_DEMO === "1" ||
    process.env.NEXT_PUBLIC_AOF_DEMO === "1"
  );
}

/**
 * Opt-in: route through the score-based v2 engine (`POST /v2/run`) instead of
 * the v1 paths — builds (else `/v1/run`) and universal chat (else
 * `/v1/orchestrate`).
 *
 * Default OFF. Both sides must be enabled to take effect: this frontend flag
 * (NEXT_PUBLIC_COAGENTIX_V2=1) AND the backend must mount the route
 * (COAGENTIX_V2=1, see tmap-v2 server/index.ts). When either is unset, the
 * unchanged v1 paths are used — so this is a safe, reversible canary.
 */
export function isV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_COAGENTIX_V2 === "1";
}

const TOKEN_KEY = "coagentix.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Authorization header carrying the caller's identity. Real users sign in with
 * Supabase/Google, so we send their Supabase access token — used by both the
 * same-origin chat route (/api/chat → getUserFromRequest) and the tmap-v2 backend
 * (/v1/*, which bridges it — see tmap-v2 server/auth.ts). Falls back to the legacy
 * localStorage token (username/PIN / CLI accounts) when there is no Supabase session.
 * Without this header the server cannot see the signed-in user and treats them as an
 * anonymous guest (subject to the guest_daily cap).
 */
async function sessionAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session) {
        const msUntilExpiry = (session.expires_at ?? 0) * 1000 - Date.now();
        if (msUntilExpiry <= 60_000) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed.session) return { Authorization: `Bearer ${refreshed.session.access_token}` };
        }
        return { Authorization: `Bearer ${session.access_token}` };
      }
    }
  } catch {
    /* fall through to legacy token */
  }
  return authHeaders();
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}

/** Same-origin/network failure (the Co.AI server itself is unreachable). */
function networkError(e: unknown): AofProviderError {
  return classifyProviderError({
    provider: "Co.AI",
    hint: "network",
    message: (e as Error)?.message ?? "request failed",
  });
}

/** The optional tmap-v2 backend is configured but unreachable / erroring. */
function backendUnavailableError(detail: string, e?: unknown): AofProviderError {
  const suffix = e ? ` (${(e as Error)?.message ?? String(e)})` : "";
  return classifyProviderError({ provider: "Co.AI Backend", status: 502, message: `${detail}${suffix}` });
}

export interface SSEEvent {
  role?: string;
  kind?: string;
  text?: string;
  [k: string]: unknown;
}

/**
 * POST a JSON body and read a `text/event-stream` response, invoking `onEvent`
 * for each parsed `data:` frame. Resolves when the stream ends.
 */
export async function postSSE(
  path: string,
  body: unknown,
  onEvent: (e: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = getApiBase();
  if (base === null) throw new Error("no-backend");

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as SSEEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/**
 * Read Co.AI's own `/api/chat` response: a JSON error envelope when the request
 * failed before streaming, otherwise a plain-text token stream that may carry
 * in-band error / failover control frames. Routes everything to the handlers and
 * returns the accumulated text (used by RAA to parse a brief).
 */
async function readAofStream(
  res: Response,
  handlers: StreamHandlers,
): Promise<{ errored: boolean; text: string }> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = isAofProviderError(body)
      ? body
      : classifyProviderError({ provider: "Co.AI", status: res.status, message: `Request failed (${res.status})` });
    handlers.onError?.(err);
    return { errored: true, text: "" };
  }
  if (!res.body) {
    handlers.onError?.(emptyResponseError("Co.AI"));
    return { errored: true, text: "" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let errored = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const decoded = decodeFrames(buffer);
      buffer = decoded.remainder;
      if (decoded.text) {
        full += decoded.text;
        handlers.onToken(decoded.text);
      }
      for (const fo of decoded.failovers) handlers.onFailover?.(fo);
      for (const mn of decoded.models) handlers.onModel?.(mn);
      for (const src of decoded.sources) handlers.onSources?.(src);
      for (const u of decoded.usage) handlers.onUsage?.(u);
      if (decoded.errors.length) {
        for (const e of decoded.errors) handlers.onError?.(e);
        errored = true;
        break;
      }
    }
  } catch (e) {
    if (isAbortError(e)) return { errored, text: full };
    handlers.onError?.(networkError(e));
    return { errored: true, text: full };
  }

  // Flush any complete trailing frame/text.
  if (!errored && buffer) {
    const decoded = decodeFrames(buffer);
    if (decoded.text) {
      full += decoded.text;
      handlers.onToken(decoded.text);
    }
    for (const fo of decoded.failovers) handlers.onFailover?.(fo);
    for (const mn of decoded.models) handlers.onModel?.(mn);
    for (const src of decoded.sources) handlers.onSources?.(src);
    for (const u of decoded.usage) handlers.onUsage?.(u);
    if (decoded.errors.length) {
      for (const e of decoded.errors) handlers.onError?.(e);
      errored = true;
    }
  }

  return { errored, text: full };
}

// ── High-level helpers used by the stores ─────────────────────────────────────

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Manual model choice from the CoChat header: "lite" (Mikros) | "normal" (Kanon). */
  model: ChatModel;
  route: RouteDecision;
  history: ChatHistoryItem[];
  /** Reasoning-effort dial for the chosen model (low → high for CoChat). */
  effort: EffortLevel;
}

/**
 * Stream a CoChat reply. CoChat is a fast single-pass assistant: it ALWAYS uses
 * the same-origin `/api/chat` provider route and never the multi-agent tmap-v2
 * backend (no orchestration, no TMAP, no memory-blocking) — that pipeline belongs
 * to CoCode only. The user-selected model (Mikros/Kanon) is sent through and
 * decides the provider chain + answer depth. Mock only in explicit demo mode.
 */
export async function streamChat(
  message: string,
  req: ChatRequest,
  handlers: StreamHandlers,
): Promise<void> {
  if (isDemoMode() && !isLive()) {
    return mockChat(message, { route: req.route }, handlers);
  }

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
      body: JSON.stringify({
        message,
        model: req.model,
        route: req.route,
        effort: req.effort,
        history: req.history.map((h) => ({ role: h.role, content: h.content })),
      }),
      signal: handlers.signal,
    });
    await readAofStream(res, handlers);
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(networkError(e));
  }
}

/** Serverless build fallback: run a build action as a single-pass LLM call through
 *  /api/chat (same provider chain + model fallback + structured errors) when the
 *  tmap-v2 backend is not configured. Never fakes output — failures hit onError. */
async function streamViaChat(
  agent: "code-gen" | "plan" | "analyze" | "debug",
  message: string,
  handlers: StreamHandlers,
  effort: EffortLevel = "normal",
): Promise<void> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
      body: JSON.stringify({ message, agent, effort }),
      signal: handlers.signal,
    });
    await readAofStream(res, handlers);
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(networkError(e));
  }
}

/** Stream a CoCode build. Live `/v1/run` (tmap-v2) when configured, otherwise a
 *  serverless single-pass generation via `/api/chat`. */
export async function streamCodeRun(
  task: string,
  mode: "lite" | "1.0" | "pro",
  handlers: StreamHandlers,
  context?: string,
  effort: EffortLevel = "normal",
): Promise<void> {
  if (isDemoMode()) {
    await mockCodeRun(task, mode, handlers);
    return;
  }
  if (!isLive()) {
    await streamViaChat("code-gen", context ? `${task}\n\nProject context:\n${context}` : task, handlers, effort);
    return;
  }

  // Opt-in v2 engine (score-based RAA + DAG). Default off; see isV2Enabled().
  if (isV2Enabled()) {
    await streamCodeRunV2(task, handlers, context, effort);
    return;
  }

  const backendMode = mode === "1.0" ? "normal" : mode;
  try {
    await postSSE(
      "/v1/run",
      { task, mode: backendMode, context: context ?? "", effort },
      (e) => {
        if (typeof e.text === "string" && e.kind !== "done") handlers.onToken(`${e.text}\n`);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    await streamViaChat("code-gen", context ? `${task}\n\nProject context:\n${context}` : task, handlers, effort);
  }
}

/**
 * Build via the v2 engine (`POST /v2/run`). The SSE shape differs from v1:
 * interim `{kind:'status'|'plan'|'event'}` progress frames, then a terminal
 * `{kind:'done', output, mode, confidence, trace}` — the final build output is
 * carried only on the `done` frame, not streamed token-by-token. We surface
 * progress and the final output through `onToken` (the only sink StreamHandlers
 * exposes); richer trace rendering is a later pass. The v2 route accepts only
 * `task`, so project context is folded into the task text.
 */
async function streamCodeRunV2(
  task: string,
  handlers: StreamHandlers,
  context?: string,
  effort: EffortLevel = "normal",
): Promise<void> {
  const fullTask = context ? `${task}\n\nProject context:\n${context}` : task;
  try {
    await postSSE(
      "/v2/run",
      { task: fullTask, effort },
      (e) => {
        if (e.kind === "done") {
          if (typeof e.output === "string" && e.output) handlers.onToken(e.output);
        } else if (e.kind === "status" && typeof e.text === "string") {
          handlers.onToken(`${e.text}\n`);
        } else if (e.kind === "plan" && Array.isArray((e as { nodes?: unknown }).nodes)) {
          const nodes = (e as { nodes: Array<{ id: string; agent: string }> }).nodes;
          handlers.onToken(`plan: ${nodes.map((n) => `${n.id}→${n.agent}`).join(", ")}\n`);
        }
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    await streamViaChat("code-gen", fullTask, handlers, effort);
  }
}

// ── CoCode NORMAL_CHAT (no project active) ────────────────────────────────────

/** Stream a NORMAL_CHAT reply within CoCode (same-origin `/api/chat`). */
export async function streamCodeChat(
  message: string,
  history: ChatHistoryItem[],
  handlers: StreamHandlers,
  effort: EffortLevel = "normal",
): Promise<void> {
  if (isDemoMode()) {
    await mockCodeChat(message, handlers, history);
    return;
  }
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
      body: JSON.stringify({ message, agent: "code-chat", effort, history: history.slice(-20) }),
      signal: handlers.signal,
    });
    await readAofStream(res, handlers);
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(networkError(e));
  }
}

// ── CoCode requirements conversation (RAA) ────────────────────────────────────

export interface RequirementsResult {
  /** structured brief, when the assistant produced one this turn */
  brief: ProjectBrief | null;
  hasBrief: boolean;
}

/** Stream a Requirements-Architect reply. Live tmap-v2 RAA → same-origin RAA;
 *  failures surface as structured errors. Mock only in explicit demo mode. */
export async function streamRequirements(
  message: string,
  history: ChatHistoryItem[],
  handlers: StreamHandlers,
  effort: EffortLevel = "normal",
): Promise<RequirementsResult> {
  const hist = history.map((h) => ({ role: h.role, content: h.content }));
  const none: RequirementsResult = { brief: null, hasBrief: false };

  if (isDemoMode() && !isLive()) {
    const text = await mockRequirements(message, hist, handlers);
    const brief = parseBrief(text);
    return { brief, hasBrief: brief !== null };
  }

  // 1) Live tmap-v2 RAA — the backend parses and returns the summary for us.
  if (isLive()) {
    try {
      let brief: ProjectBrief | null = null;
      let hasBriefFlag = false;
      await postSSE(
        "/v1/chat",
        { message, history: hist, effort },
        (e) => {
          if (e.kind === "output" && typeof e.text === "string") handlers.onToken(e.text);
          else if (e.kind === "done") {
            hasBriefFlag = Boolean((e as { hasSummary?: unknown }).hasSummary);
            const s = (e as { summary?: unknown }).summary;
            if (s && typeof s === "object") brief = summaryToBrief(s as Record<string, unknown>);
          }
        },
        handlers.signal,
      );
      return { brief, hasBrief: hasBriefFlag }; // backend handled it
    } catch (e) {
      if (isAbortError(e)) return none;
      // backend unreachable — fall through to same-origin /api/chat below
    }
  }

  // 2) Same-origin RAA persona (real LLM via /api/chat) — parse the brief client-side.
  // Also runs as fallback when the backend is configured but unreachable.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
      body: JSON.stringify({ message, agent: "requirements", effort, history: hist }),
      signal: handlers.signal,
    });
    const { errored, text } = await readAofStream(res, handlers);
    if (errored) return none;
    const brief = parseBrief(text);
    return { brief, hasBrief: brief !== null };
  } catch (e) {
    if (isAbortError(e)) return none;
    handlers.onError?.(networkError(e));
    return none;
  }
}

/** Stream a plan-only build ("Create Plan"). tmap-v2 `/v1/run` planOnly when
 *  configured, otherwise a serverless plan via `/api/chat`. */
export async function streamPlan(
  task: string,
  mode: "lite" | "1.0" | "pro",
  handlers: StreamHandlers,
  context?: string,
  effort: EffortLevel = "normal",
): Promise<void> {
  if (isDemoMode()) {
    await mockPlan(task, handlers);
    return;
  }
  if (!isLive()) {
    await streamViaChat("plan", context ? `${task}\n\nProject context:\n${context}` : task, handlers, effort);
    return;
  }
  const backendMode = mode === "1.0" ? "normal" : mode;
  try {
    await postSSE(
      "/v1/run",
      { task, mode: backendMode, context: context ?? "", planOnly: true, effort },
      (e) => {
        if (typeof e.text === "string" && e.kind !== "done") handlers.onToken(`${e.text}\n`);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    await streamViaChat("plan", context ? `${task}\n\nProject context:\n${context}` : task, handlers, effort);
  }
}

/** Stream a project analysis ("Analyze"). tmap-v2 `/v1/analyze` when configured,
 *  otherwise a serverless analysis via `/api/chat`. */
export async function streamAnalyze(
  brief: string,
  handlers: StreamHandlers,
  effort: EffortLevel = "normal",
): Promise<void> {
  if (isDemoMode()) {
    await mockAnalyze(brief, handlers);
    return;
  }
  if (!isLive()) {
    await streamViaChat("analyze", brief, handlers, effort);
    return;
  }
  try {
    await postSSE(
      "/v1/analyze",
      { brief, effort },
      (e) => {
        if (e.kind === "output" && typeof e.text === "string") handlers.onToken(e.text);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    await streamViaChat("analyze", brief, handlers, effort);
  }
}

export interface DebugInput {
  error: string;
  code?: string;
  context?: string;
}

/** Stream a senior-engineer debug pass. tmap-v2 `/v1/debug` when configured,
 *  otherwise a serverless debug via `/api/chat`. */
export async function streamDebug(
  input: DebugInput,
  handlers: StreamHandlers,
  effort: EffortLevel = "normal",
): Promise<void> {
  if (isDemoMode()) {
    await mockDebug(input.error, handlers);
    return;
  }
  if (!isLive()) {
    const parts = [`Error:\n${input.error}`];
    if (input.code) parts.push(`Code:\n${input.code}`);
    if (input.context) parts.push(`Context:\n${input.context}`);
    await streamViaChat("debug", parts.join("\n\n"), handlers, effort);
    return;
  }
  try {
    await postSSE(
      "/v1/debug",
      { ...input, effort },
      (e) => {
        if (e.kind === "output" && typeof e.text === "string") handlers.onToken(e.text);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    const parts = [`Error:\n${input.error}`];
    if (input.code) parts.push(`Code:\n${input.code}`);
    if (input.context) parts.push(`Context:\n${input.context}`);
    await streamViaChat("debug", parts.join("\n\n"), handlers, effort);
  }
}

// ── Co.AI Universal Orchestration ────────────────────────────────────────────

export interface OrchestrationEvent {
  role: string;
  kind: string;
  text?: string;
  categories?: string[];
  agentsUsed?: string[];
  qualityScore?: number;
  iterations?: number;
}

export interface OrchestrationHandlers {
  onStatus?: (agent: string, text: string) => void;
  onToken: (text: string) => void;
  onDone?: (result: { categories: string[]; agentsUsed: string[]; qualityScore: number; iterations: number }) => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}

/**
 * Stream a universal orchestration request through the Co.AI Chief Agent.
 * The Chief Agent classifies intent, expands the prompt, delegates to specialized
 * agents, runs a quality review loop, and returns the best possible response.
 */
export async function streamOrchestrate(
  message: string,
  history: ChatHistoryItem[],
  handlers: OrchestrationHandlers,
  qualityGate = true,
): Promise<void> {
  if (isLive()) {
    try {
      await postSSE(
        "/v1/orchestrate",
        {
          message,
          history: history.map((h) => ({ role: h.role, content: h.content })),
          qualityGate,
        },
        (e: SSEEvent) => {
          const oe = e as OrchestrationEvent;
          if (oe.kind === "status" && typeof oe.text === "string") {
            handlers.onStatus?.(String(oe.role ?? "chief"), oe.text);
          } else if (oe.kind === "output" && typeof oe.text === "string") {
            handlers.onToken(oe.text);
          } else if (oe.kind === "done") {
            handlers.onDone?.({
              categories: Array.isArray(oe.categories) ? oe.categories : [],
              agentsUsed: Array.isArray(oe.agentsUsed) ? oe.agentsUsed : [],
              qualityScore: typeof oe.qualityScore === "number" ? oe.qualityScore : 0,
              iterations: typeof oe.iterations === "number" ? oe.iterations : 1,
            });
          } else if (oe.kind === "error" && typeof oe.text === "string") {
            handlers.onError?.(new Error(oe.text));
          }
        },
        handlers.signal,
      );
      return; // backend handled it
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      // backend unreachable — fall through to /api/chat below
    }
  }

  // Fallback: regular chat via /api/chat (when backend not configured or unreachable).
  // Decode in-band control frames so they're never rendered as literal text.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
      body: JSON.stringify({ message, agent: "chat", history: history.slice(-20) }),
      signal: handlers.signal,
    });
    await readAofStream(res, {
      onToken: handlers.onToken,
      signal: handlers.signal,
      onError: (err) => handlers.onError?.(err),
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return;
    handlers.onError?.(e);
  }
}

/**
 * Universal orchestration via the v2 engine (`POST /v2/run`). Opt-in: callers
 * gate on isV2Enabled(). The v2 route is single-task (no conversation history),
 * so recent turns are folded into the task text for minimal context. v2 streams
 * `status`/`plan`/`event` progress then a terminal `done` carrying the full
 * `output` + `confidence`; we map the plan's node agents to `agentsUsed` and
 * confidence (0..1) to a 0..100 qualityScore so the UI contract is unchanged.
 */
export async function streamOrchestrateV2(
  message: string,
  history: ChatHistoryItem[],
  handlers: OrchestrationHandlers,
): Promise<void> {
  const recent = history.slice(-6).map((h) => `${h.role}: ${h.content}`).join("\n");
  const task = recent ? `${recent}\nuser: ${message}` : message;
  let agentsUsed: string[] = [];
  try {
    await postSSE(
      "/v2/run",
      { task },
      (e: SSEEvent) => {
        if (e.kind === "status" && typeof e.text === "string") {
          handlers.onStatus?.(String(e.role ?? "v2"), e.text);
        } else if (e.kind === "plan" && Array.isArray((e as { nodes?: unknown }).nodes)) {
          agentsUsed = (e as { nodes: Array<{ agent?: string }> }).nodes
            .map((n) => n.agent)
            .filter((a): a is string => typeof a === "string");
        } else if (e.kind === "done") {
          if (typeof e.output === "string") handlers.onToken(e.output);
          handlers.onDone?.({
            categories: [],
            agentsUsed,
            qualityScore: typeof e.confidence === "number" ? Math.round(e.confidence * 100) : 0,
            iterations: 1,
          });
        } else if (e.kind === "error" && typeof e.text === "string") {
          handlers.onError?.(new Error(e.text));
        }
      },
      handlers.signal,
    );
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return;
    // v2 backend unreachable — fall back to /api/chat
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sessionAuthHeaders()) },
        body: JSON.stringify({ message: task, agent: "chat" }),
        signal: handlers.signal,
      });
      await readAofStream(res, {
        onToken: handlers.onToken,
        signal: handlers.signal,
        onError: (err) => handlers.onError?.(err),
      });
    } catch (e2) {
      if ((e2 as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(e2);
    }
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

import type { SystemHealth } from "./health";

/** Fetch the live provider health snapshot from `/api/health`. */
export async function fetchHealth(signal?: AbortSignal): Promise<SystemHealth> {
  const res = await fetch("/api/health", { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`health failed (${res.status})`);
  return (await res.json()) as SystemHealth;
}

// ── Product memory (tmap-v2) ──────────────────────────────────────────────────

/**
 * Clear a product's tmap-v2 project + image memory (CoCode build memory today;
 * CoChat's bucket is cleared too for symmetry even though nothing writes to it
 * yet). Used by "Delete Entire Workspace" / "Delete All History". Best-effort —
 * the tmap-v2 backend may not be configured, and memory is not mission-critical.
 */
export async function clearProductMemory(product: "cochat" | "cocode"): Promise<void> {
  const base = getApiBase();
  if (base === null) return; // no tmap-v2 backend configured — nothing to clear
  const headers = { "Content-Type": "application/json", ...(await sessionAuthHeaders()) };
  await Promise.allSettled([
    fetch(`${base}/v1/memory?product=${product}`, { method: "DELETE", headers }),
    fetch(`${base}/v1/image/memories?product=${product}`, { method: "DELETE", headers }),
  ]);
}
