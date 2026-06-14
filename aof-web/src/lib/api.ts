// ── Aof API client ────────────────────────────────────────────────────────────
// Thin, typed layer over the tmap-v2 backend (/v1/*). Designed to degrade
// gracefully: when no backend is configured (or a call fails), the UI transparently
// falls back to the offline mock engine so the homepage experience always works.

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

// ── High-level helpers used by the stores ─────────────────────────────────────

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  style: ResponseStyle;
  route: RouteDecision;
  history: ChatHistoryItem[];
}

/** Stream a Chat-with-Aof reply (live `/v1/chat`, else real `/api/chat`, else mock). */
export async function streamChat(
  message: string,
  req: ChatRequest,
  handlers: StreamHandlers,
): Promise<void> {
  const mockOpts = { style: req.style, route: req.route };

  // No tmap-v2 backend configured → try the same-origin real LLM route first
  // (Aof's own /api/chat, powered by a server-side key). It falls back to the
  // offline mock when no key is set or the call fails.
  if (!isLive()) {
    try {
      const handled = await streamLocalChat(message, req, handlers);
      if (handled) return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // user stopped — no fallback
      // Any other failure → keep the UX flowing with the mock below.
    }
    return mockChat(message, mockOpts, handlers);
  }

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
  } catch {
    // Backend unreachable / unauthorised → keep the UX flowing with the mock.
    await mockChat(message, mockOpts, handlers);
  }
}

/**
 * Call Aof's own server-side chat route (`/api/chat`) and stream the plain-text
 * reply token by token. Returns `true` when the route handled the request, or
 * `false` when no provider key is configured (503) so the caller uses the mock.
 */
async function streamLocalChat(
  message: string,
  req: ChatRequest,
  handlers: StreamHandlers,
): Promise<boolean> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      style: req.style,
      route: req.route,
      history: req.history.map((h) => ({ role: h.role, content: h.content })),
    }),
    signal: handlers.signal,
  });

  if (res.status === 503) return false; // no key → fall back to mock
  if (!res.ok || !res.body) throw new Error(`chat failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    handlers.onToken(decoder.decode(value, { stream: true }));
  }
  return true;
}

/** Stream an Aof Code build (live `/v1/run`, else mock). The optional `context`
 *  carries the approved project brief so TMAP generates against real requirements. */
export async function streamCodeRun(
  task: string,
  mode: "lite" | "1.0" | "pro",
  handlers: StreamHandlers,
  context?: string,
): Promise<void> {
  if (!isLive()) return mockCodeRun(task, mode, handlers);
  // Backend modes are lite | normal | pro — map 1.0 → normal.
  const backendMode = mode === "1.0" ? "normal" : mode;
  try {
    await postSSE(
      "/v1/run",
      { task, mode: backendMode, context: context ?? "" },
      (e) => {
        if (typeof e.text === "string" && e.kind !== "done") {
          handlers.onToken(`${e.text}\n`);
        }
      },
      handlers.signal,
    );
  } catch {
    await mockCodeRun(task, mode, handlers);
  }
}

// ── Aof Code NORMAL_CHAT (no project active) ─────────────────────────────────

/**
 * Stream a NORMAL_CHAT reply within Aof Code. Used when no project is active —
 * greetings, tech Q&A, casual discussion. Falls back: same-origin /api/chat
 * (agent=code-chat) → offline mock.
 */
export async function streamCodeChat(
  message: string,
  history: ChatHistoryItem[],
  handlers: StreamHandlers,
): Promise<void> {
  // No backend needed for this path — it always goes through the same-origin
  // LLM route or the mock. The live tmap-v2 backend doesn't have a "chat" endpoint
  // for NORMAL_CHAT within Aof Code; we use the Next.js /api/chat route directly.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agent: "code-chat", history: history.slice(-20) }),
      signal: handlers.signal,
    });
    if (res.status === 503 || !res.ok || !res.body) throw new Error("no-key");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      handlers.onToken(decoder.decode(value, { stream: true }));
    }
    return;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    // No key or network error → mock
  }
  await mockCodeChat(message, handlers, history);
}

// ── Aof Code requirements conversation (RAA) ──────────────────────────────────

export interface RequirementsResult {
  /** structured brief, when the assistant produced one this turn */
  brief: ProjectBrief | null;
  hasBrief: boolean;
}

/**
 * Stream a Requirements-Architect reply for the Aof Code conversation. Mirrors the
 * `streamChat` fallback chain: live tmap-v2 RAA (`/v1/chat`) → same-origin RAA
 * persona (`/api/chat?agent=requirements`) → offline mock. Returns any brief the
 * assistant emitted so the caller can update its project context.
 */
export async function streamRequirements(
  message: string,
  history: ChatHistoryItem[],
  handlers: StreamHandlers,
): Promise<RequirementsResult> {
  const hist = history.map((h) => ({ role: h.role, content: h.content }));

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
      if ((e as Error)?.name === "AbortError") return { brief: null, hasBrief: false };
      // Backend unreachable → fall through to the same-origin route / mock.
    }
  }

  // 2) Same-origin RAA persona (real LLM via /api/chat) — parse the brief client-side.
  try {
    const text = await streamLocalRequirements(message, hist, handlers);
    if (text !== null) {
      const brief = parseBrief(text);
      return { brief, hasBrief: brief !== null };
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { brief: null, hasBrief: false };
    // any other failure → keep the UX flowing with the mock below
  }

  // 3) Offline mock.
  const text = await mockRequirements(message, hist, handlers);
  const brief = parseBrief(text);
  return { brief, hasBrief: brief !== null };
}

/** Stream a plan-only build (Aof Code "Create Plan"): Architect + Planner, no code.
 *  Live `/v1/run` with planOnly, else mock. */
export async function streamPlan(
  task: string,
  mode: "lite" | "1.0" | "pro",
  handlers: StreamHandlers,
  context?: string,
): Promise<void> {
  if (!isLive()) {
    await mockPlan(task, handlers);
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
  } catch {
    await mockPlan(task, handlers);
  }
}

/** Stream a project analysis (Aof Code "Analyze Project"). Live `/v1/analyze`, else mock. */
export async function streamAnalyze(brief: string, handlers: StreamHandlers): Promise<void> {
  if (!isLive()) {
    await mockAnalyze(brief, handlers);
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
  } catch {
    await mockAnalyze(brief, handlers);
  }
}

export interface DebugInput {
  error: string;
  code?: string;
  context?: string;
}

/** Stream a senior-engineer debug pass (analyze → root cause → fix → patch).
 *  Live `/v1/debug`, else mock. */
export async function streamDebug(input: DebugInput, handlers: StreamHandlers): Promise<void> {
  if (!isLive()) {
    await mockDebug(input.error, handlers);
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
  } catch {
    await mockDebug(input.error, handlers);
  }
}

/** Call the same-origin RAA persona route. Returns the full reply, or null on 503
 *  (no provider key configured) so the caller falls back to the mock. */
async function streamLocalRequirements(
  message: string,
  history: ChatHistoryItem[],
  handlers: StreamHandlers,
): Promise<string | null> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, agent: "requirements", history }),
    signal: handlers.signal,
  });

  if (res.status === 503) return null; // no key → mock
  if (!res.ok || !res.body) throw new Error(`requirements failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    handlers.onToken(chunk);
  }
  return full;
}
