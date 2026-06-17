// ── Aof API client ────────────────────────────────────────────────────────────
// Thin, typed layer over the AI providers. Transparency is the rule: when a
// provider fails, the failure is surfaced to the UI as a structured
// `AofProviderError` (via `handlers.onError`) — it is NEVER hidden behind a fake
// "mock" reply. The offline mock engine still exists, but only runs when the app
// is *explicitly* put in demo mode (`NEXT_PUBLIC_AOF_DEMO=1`); it is off by
// default so the UI never appears to work when AI is actually down.

import type { ProjectBrief, ResponseStyle, RouteDecision } from "./types";
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

/** Resolve the API base. Empty string means "same origin" (Next rewrite proxy). */
export function getApiBase(): string | null {
  const pub = process.env.NEXT_PUBLIC_AOF_API_BASE;
  if (typeof pub === "string" && pub.length > 0) return pub.replace(/\/$/, "");
  // When AOF_API_PROXY is set we rewrite /v1 at the edge → call same-origin.
  if (process.env.NEXT_PUBLIC_AOF_SAME_ORIGIN === "1") return "";
  return null;
}

export function isLive(): boolean {
  return getApiBase() !== null;
}

/** Explicit, opt-in offline demo — simulated responses, clearly not real AI. */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_AOF_DEMO === "1";
}

const TOKEN_KEY = "aof.token";

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

// ── Error helpers ─────────────────────────────────────────────────────────────

function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}

/** Same-origin/network failure (the Aof server itself is unreachable). */
function networkError(e: unknown): AofProviderError {
  return classifyProviderError({
    provider: "Aof",
    hint: "network",
    message: (e as Error)?.message ?? "request failed",
  });
}

/** The optional tmap-v2 backend is configured but unreachable / erroring. */
function backendUnavailableError(detail: string, e?: unknown): AofProviderError {
  const suffix = e ? ` (${(e as Error)?.message ?? String(e)})` : "";
  return classifyProviderError({ provider: "Aof Backend", status: 502, message: `${detail}${suffix}` });
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
 * Read Aof's own `/api/chat` response: a JSON error envelope when the request
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
      : classifyProviderError({ provider: "Aof", status: res.status, message: `Request failed (${res.status})` });
    handlers.onError?.(err);
    return { errored: true, text: "" };
  }
  if (!res.body) {
    handlers.onError?.(emptyResponseError("Aof"));
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
  style: ResponseStyle;
  route: RouteDecision;
  history: ChatHistoryItem[];
  /** Universal Search mode for this turn: "auto" | "off" | "force". */
  searchMode?: "auto" | "off" | "force";
}

/** Stream a Chat-with-Aof reply. Live `/v1/chat` → real `/api/chat`; failures
 *  surface as structured errors. Mock only in explicit demo mode. */
export async function streamChat(
  message: string,
  req: ChatRequest,
  handlers: StreamHandlers,
): Promise<void> {
  if (isDemoMode() && !isLive()) {
    return mockChat(message, { style: req.style, route: req.route }, handlers);
  }

  if (isLive()) {
    try {
      await postSSE(
        "/v1/chat",
        {
          message,
          style: req.style,
          route: req.route.target,
          history: req.history.map((h) => ({ role: h.role, content: h.content })),
        },
        (e) => {
          if (e.kind === "output" && typeof e.text === "string") handlers.onToken(e.text);
        },
        handlers.signal,
      );
    } catch (e) {
      if (isAbortError(e)) return;
      handlers.onError?.(backendUnavailableError("Chat backend (/v1/chat) is unreachable.", e));
    }
    return;
  }

  // Default: Aof's own provider route.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        style: req.style,
        route: req.route,
        searchMode: req.searchMode ?? "auto",
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
): Promise<void> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agent }),
      signal: handlers.signal,
    });
    await readAofStream(res, handlers);
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(networkError(e));
  }
}

/** Stream an Aof Code build. Live `/v1/run` (tmap-v2) when configured, otherwise a
 *  serverless single-pass generation via `/api/chat`. */
export async function streamCodeRun(
  task: string,
  mode: "lite" | "1.0" | "pro",
  handlers: StreamHandlers,
  context?: string,
): Promise<void> {
  if (isDemoMode()) {
    await mockCodeRun(task, mode, handlers);
    return;
  }
  if (!isLive()) {
    await streamViaChat("code-gen", context ? `${task}\n\nProject context:\n${context}` : task, handlers);
    return;
  }
  const backendMode = mode === "1.0" ? "normal" : mode;
  try {
    await postSSE(
      "/v1/run",
      { task, mode: backendMode, context: context ?? "" },
      (e) => {
        if (typeof e.text === "string" && e.kind !== "done") handlers.onToken(`${e.text}\n`);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(backendUnavailableError("Build backend (/v1/run) is unreachable.", e));
  }
}

// ── Aof Code NORMAL_CHAT (no project active) ─────────────────────────────────

/** Stream a NORMAL_CHAT reply within Aof Code (same-origin `/api/chat`). */
export async function streamCodeChat(
  message: string,
  history: ChatHistoryItem[],
  handlers: StreamHandlers,
): Promise<void> {
  if (isDemoMode()) {
    await mockCodeChat(message, handlers, history);
    return;
  }
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agent: "code-chat", history: history.slice(-20) }),
      signal: handlers.signal,
    });
    await readAofStream(res, handlers);
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(networkError(e));
  }
}

// ── Aof Code requirements conversation (RAA) ──────────────────────────────────

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
        { message, history: hist },
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
      return { brief, hasBrief: hasBriefFlag };
    } catch (e) {
      if (isAbortError(e)) return none;
      handlers.onError?.(backendUnavailableError("Requirements backend (/v1/chat) is unreachable.", e));
      return none;
    }
  }

  // 2) Same-origin RAA persona (real LLM via /api/chat) — parse the brief client-side.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agent: "requirements", history: hist }),
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
): Promise<void> {
  if (isDemoMode()) {
    await mockPlan(task, handlers);
    return;
  }
  if (!isLive()) {
    await streamViaChat("plan", context ? `${task}\n\nProject context:\n${context}` : task, handlers);
    return;
  }
  const backendMode = mode === "1.0" ? "normal" : mode;
  try {
    await postSSE(
      "/v1/run",
      { task, mode: backendMode, context: context ?? "", planOnly: true },
      (e) => {
        if (typeof e.text === "string" && e.kind !== "done") handlers.onToken(`${e.text}\n`);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(backendUnavailableError("Plan backend (/v1/run) is unreachable.", e));
  }
}

/** Stream a project analysis ("Analyze"). tmap-v2 `/v1/analyze` when configured,
 *  otherwise a serverless analysis via `/api/chat`. */
export async function streamAnalyze(brief: string, handlers: StreamHandlers): Promise<void> {
  if (isDemoMode()) {
    await mockAnalyze(brief, handlers);
    return;
  }
  if (!isLive()) {
    await streamViaChat("analyze", brief, handlers);
    return;
  }
  try {
    await postSSE(
      "/v1/analyze",
      { brief },
      (e) => {
        if (e.kind === "output" && typeof e.text === "string") handlers.onToken(e.text);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(backendUnavailableError("Analyze backend (/v1/analyze) is unreachable.", e));
  }
}

export interface DebugInput {
  error: string;
  code?: string;
  context?: string;
}

/** Stream a senior-engineer debug pass. tmap-v2 `/v1/debug` when configured,
 *  otherwise a serverless debug via `/api/chat`. */
export async function streamDebug(input: DebugInput, handlers: StreamHandlers): Promise<void> {
  if (isDemoMode()) {
    await mockDebug(input.error, handlers);
    return;
  }
  if (!isLive()) {
    const parts = [`Error:\n${input.error}`];
    if (input.code) parts.push(`Code:\n${input.code}`);
    if (input.context) parts.push(`Context:\n${input.context}`);
    await streamViaChat("debug", parts.join("\n\n"), handlers);
    return;
  }
  try {
    await postSSE(
      "/v1/debug",
      input,
      (e) => {
        if (e.kind === "output" && typeof e.text === "string") handlers.onToken(e.text);
      },
      handlers.signal,
    );
  } catch (e) {
    if (isAbortError(e)) return;
    handlers.onError?.(backendUnavailableError("Debug backend (/v1/debug) is unreachable.", e));
  }
}

// ── AOF AI Universal Orchestration ───────────────────────────────────────────

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
 * Stream a universal orchestration request through the AOF AI Chief Agent.
 * The Chief Agent classifies intent, expands the prompt, delegates to specialized
 * agents, runs a quality review loop, and returns the best possible response.
 */
export async function streamOrchestrate(
  message: string,
  history: ChatHistoryItem[],
  handlers: OrchestrationHandlers,
  qualityGate = true,
): Promise<void> {
  if (!isLive()) {
    // Fallback to regular chat when backend not configured
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, agent: "chat", history: history.slice(-20) }),
        signal: handlers.signal,
      });
      const decoder = new TextDecoder();
      const reader = res.body?.getReader();
      if (!reader) return;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        handlers.onToken(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(e);
    }
    return;
  }

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
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return;
    handlers.onError?.(backendUnavailableError("Orchestration backend (/v1/orchestrate) is unreachable.", e));
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
