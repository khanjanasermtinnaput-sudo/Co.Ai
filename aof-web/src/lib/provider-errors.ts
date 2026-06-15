// ── Aof AI — Provider Error Handling System ──────────────────────────────────
// A single source of truth for AI-provider failures. The golden rule: Aof must
// NEVER pretend AI is working when it is not. Every failure is classified into a
// stable AOF_ERROR_xxx code with a human problem/details/solution so the UI can
// surface exactly what went wrong, why, which provider, and how to fix it.
//
// This module is browser- AND server-safe (no Node-only or DOM-only APIs) so the
// same catalog/classifier is shared by the /api/chat route and the React client.

export type AofErrorCode =
  | "AOF_ERROR_001" // API key missing
  | "AOF_ERROR_002" // invalid API key
  | "AOF_ERROR_003" // expired API key
  | "AOF_ERROR_004" // quota exceeded
  | "AOF_ERROR_005" // rate limit exceeded
  | "AOF_ERROR_006" // provider unavailable
  | "AOF_ERROR_007" // network failure
  | "AOF_ERROR_008" // request timeout
  | "AOF_ERROR_009" // invalid model
  | "AOF_ERROR_010" // authentication failure
  | "AOF_ERROR_011" // empty response
  | "AOF_ERROR_012"; // unknown provider error

export type ProviderId =
  | "anthropic"
  | "groq"
  | "gemini"
  | "deepseek"
  | "dashscope"
  | "openrouter";

/** Provider display label + the env var that holds its key. */
export const PROVIDERS: Record<ProviderId, { label: string; envVar: string }> = {
  anthropic:  { label: "Claude",     envVar: "ANTHROPIC_API_KEY" },
  groq:       { label: "Groq",       envVar: "GROQ_API_KEY" },
  gemini:     { label: "Gemini",     envVar: "GEMINI_API_KEY" },
  deepseek:   { label: "DeepSeek",   envVar: "DEEPSEEK_API_KEY" },
  dashscope:  { label: "Qwen",       envVar: "DASHSCOPE_API_KEY" },
  openrouter: { label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
};

/** The order /api/chat tries providers in (first configured key wins). */
export const PROVIDER_ORDER: ProviderId[] = [
  "anthropic",
  "groq",
  "gemini",
  "deepseek",
  "dashscope",
  "openrouter",
];

/** Surfaced when the primary provider failed and Aof switched to a fallback. */
export interface FailoverInfo {
  /** the provider now serving the request */
  to: ProviderId;
  toLabel: string;
  /** the providers that failed first, in order tried */
  from: { provider: string; code: AofErrorCode; status?: number }[];
}

/** A fully-resolved, user-facing provider error. */
export interface AofProviderError {
  code: AofErrorCode;
  /** human label, e.g. "Gemini" */
  provider: string;
  providerId?: ProviderId;
  /** one-line summary of the failure class */
  problem: string;
  /** what specifically happened on this request */
  details: string;
  /** concrete next step the user can take */
  solution: string;
  /** ISO-8601 UTC */
  timestamp: string;

  // ── developer-mode / diagnostics (safe to surface — never contains the key) ──
  httpStatus?: number;
  requestId?: string;
  model?: string;
  /** truncated raw upstream response body */
  providerResponse?: string;
  /** raw error message */
  rawError?: string;
  /** stack trace (only attached server-side / when dev mode requests it) */
  stack?: string;
}

/** Static catalog: code → short problem + a solution builder. */
const CATALOG: Record<
  AofErrorCode,
  { problem: string; solution: (envVar: string, provider: string) => string }
> = {
  AOF_ERROR_001: {
    problem: "API Key Missing",
    solution: (envVar) => `Add ${envVar} to .env.local and restart the server.`,
  },
  AOF_ERROR_002: {
    problem: "Invalid API Key",
    solution: (envVar, p) =>
      `The ${p} key was rejected. Check ${envVar} for typos/extra spaces and paste a fresh key.`,
  },
  AOF_ERROR_003: {
    problem: "Expired API Key",
    solution: (envVar, p) => `The ${p} key has expired. Generate a new key and update ${envVar}.`,
  },
  AOF_ERROR_004: {
    problem: "Quota Exceeded",
    solution: (_e, p) =>
      `Your ${p} account is out of quota/credit. Top up billing or switch to another provider.`,
  },
  AOF_ERROR_005: {
    problem: "Rate Limit Exceeded",
    solution: (_e, p) => `Too many requests to ${p}. Wait a moment and retry, or use another provider.`,
  },
  AOF_ERROR_006: {
    problem: "Provider Unavailable",
    solution: (_e, p) => `${p} is temporarily down (5xx). Retry shortly or switch providers.`,
  },
  AOF_ERROR_007: {
    problem: "Network Failure",
    solution: (_e, p) => `Could not reach ${p}. Check your internet/firewall and try again.`,
  },
  AOF_ERROR_008: {
    problem: "Request Timeout",
    solution: (_e, p) => `${p} took too long to respond. Retry, or pick a faster model/provider.`,
  },
  AOF_ERROR_009: {
    problem: "Invalid Model",
    solution: (_e, p) =>
      `The configured model is not available on ${p}. Set a valid *_MODEL env var.`,
  },
  AOF_ERROR_010: {
    problem: "Authentication Failure",
    solution: (envVar, p) =>
      `${p} refused authentication (403). Verify the key in ${envVar} has access to the model.`,
  },
  AOF_ERROR_011: {
    problem: "Empty Response",
    solution: (_e, p) => `${p} returned no content. Retry, or switch providers if it persists.`,
  },
  AOF_ERROR_012: {
    problem: "Unknown Provider Error",
    solution: (_e, p) => `An unexpected error occurred with ${p}. Enable Developer Mode for details.`,
  },
};

/** True for the codes that should hard-stop generation and show the error panel. */
export function isCriticalError(code: AofErrorCode): boolean {
  // Every provider error is critical: we never silently continue or fake output.
  return code in CATALOG;
}

/** Map an HTTP status (+ optional body) from any provider to an AOF_ERROR code. */
export function classifyHttpStatus(status: number, body = ""): AofErrorCode {
  const b = body.toLowerCase();

  if (status === 401) {
    if (/expire/.test(b)) return "AOF_ERROR_003";
    return "AOF_ERROR_002"; // invalid key
  }
  if (status === 403) {
    if (/expire/.test(b)) return "AOF_ERROR_003";
    return "AOF_ERROR_010"; // auth / permission failure
  }
  if (status === 429) {
    if (/quota|billing|insufficient|credit|exceeded your current quota|out of/.test(b)) {
      return "AOF_ERROR_004"; // quota
    }
    return "AOF_ERROR_005"; // rate limit
  }
  if (status === 404) {
    if (/model/.test(b)) return "AOF_ERROR_009";
    return "AOF_ERROR_006"; // not found → treat as unavailable
  }
  if (status === 400) {
    if (/model|not found|does not exist|unsupported/.test(b)) return "AOF_ERROR_009";
    if (/api key|api_key|credential|authentication/.test(b)) return "AOF_ERROR_002";
    return "AOF_ERROR_012";
  }
  if (status === 408 || status === 504) return "AOF_ERROR_008"; // timeout
  if (status === 500 || status === 502 || status === 503 || status === 529) {
    return "AOF_ERROR_006"; // provider unavailable
  }
  return "AOF_ERROR_012"; // unknown
}

/** Map a thrown exception (network/SDK/abort) to an AOF_ERROR code. */
export function classifyException(err: unknown): AofErrorCode {
  const e = err as { name?: string; message?: string; status?: number; code?: string };
  const msg = (e?.message ?? "").toLowerCase();
  const name = (e?.name ?? "").toLowerCase();
  const code = (e?.code ?? "").toString().toLowerCase();

  // SDK errors often carry an HTTP status — prefer the precise mapping.
  if (typeof e?.status === "number") return classifyHttpStatus(e.status, msg);

  if (name.includes("timeout") || msg.includes("timed out") || code === "etimedout") {
    return "AOF_ERROR_008";
  }
  if (
    name === "typeerror" ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    code === "enotfound" ||
    code === "econnrefused" ||
    code === "econnreset" ||
    code === "eai_again"
  ) {
    return "AOF_ERROR_007";
  }
  return "AOF_ERROR_012";
}

export interface BuildErrorInput {
  code: AofErrorCode;
  providerId?: ProviderId;
  provider?: string;
  /** override the default details line */
  details?: string;
  httpStatus?: number;
  requestId?: string;
  model?: string;
  providerResponse?: string;
  rawError?: string;
  stack?: string;
}

/** Resolve a code + context into a complete, user-facing AofProviderError. */
export function buildProviderError(input: BuildErrorInput): AofProviderError {
  const entry = CATALOG[input.code] ?? CATALOG.AOF_ERROR_012;
  const providerLabel =
    input.provider ?? (input.providerId ? PROVIDERS[input.providerId].label : "AI Provider");
  const envVar = input.providerId ? PROVIDERS[input.providerId].envVar : "the provider API key";

  const details =
    input.details ??
    defaultDetails(input.code, providerLabel, envVar, input.httpStatus, input.providerResponse);

  return {
    code: input.code,
    provider: providerLabel,
    providerId: input.providerId,
    problem: entry.problem,
    details,
    solution: entry.solution(envVar, providerLabel),
    timestamp: new Date().toISOString(),
    httpStatus: input.httpStatus,
    requestId: input.requestId,
    model: input.model,
    providerResponse: input.providerResponse?.slice(0, 500),
    rawError: input.rawError,
    stack: input.stack,
  };
}

function defaultDetails(
  code: AofErrorCode,
  provider: string,
  envVar: string,
  status?: number,
  body?: string,
): string {
  const statusPart = status ? ` (HTTP ${status})` : "";
  switch (code) {
    case "AOF_ERROR_001":
      return `${envVar} environment variable is missing — no ${provider} key is configured.`;
    case "AOF_ERROR_002":
      return `${provider} rejected the API key as invalid${statusPart}.`;
    case "AOF_ERROR_003":
      return `${provider} reports the API key has expired${statusPart}.`;
    case "AOF_ERROR_004":
      return `${provider} quota/credit has been exhausted${statusPart}.`;
    case "AOF_ERROR_005":
      return `${provider} rate limit hit — too many requests${statusPart}.`;
    case "AOF_ERROR_006":
      return `${provider} is unavailable right now${statusPart}.`;
    case "AOF_ERROR_007":
      return `Network request to ${provider} failed before a response was received.`;
    case "AOF_ERROR_008":
      return `${provider} did not respond in time${statusPart}.`;
    case "AOF_ERROR_009":
      return `${provider} does not recognise the configured model${statusPart}.`;
    case "AOF_ERROR_010":
      return `${provider} refused authentication${statusPart}.`;
    case "AOF_ERROR_011":
      return `${provider} returned an empty response with no content.`;
    default:
      return `${provider} returned an unexpected error${statusPart}${body ? `: ${body.slice(0, 160)}` : "."}`;
  }
}

/** Format a structured server log line for any provider failure. */
export function formatErrorLog(
  err: AofProviderError,
  extra?: { stack?: string; responseBody?: string },
): string {
  const lines = [
    "[AOF ERROR]",
    `Code: ${err.code} (${err.problem})`,
    `Provider: ${err.provider}`,
    `Model: ${err.model ?? "n/a"}`,
    `Request ID: ${err.requestId ?? "n/a"}`,
    `Time: ${err.timestamp}`,
    `Status: ${err.httpStatus ?? "n/a"}`,
    `Details: ${err.details}`,
  ];
  const body = extra?.responseBody ?? err.providerResponse;
  if (body) lines.push(`Response Body: ${body.slice(0, 500)}`);
  const stack = extra?.stack ?? err.stack;
  if (stack) lines.push(`Stack: ${stack.split("\n").slice(0, 4).join("\n")}`);
  return lines.join("\n");
}

/** Strip developer-only fields so prod clients never receive stack traces. */
export function publicError(err: AofProviderError, includeDev: boolean): AofProviderError {
  if (includeDev) return err;
  const { stack: _stack, rawError: _rawError, ...rest } = err;
  return rest;
}

// ── Stream error protocol ─────────────────────────────────────────────────────
// When a provider fails AFTER token streaming has begun, the route can no longer
// change the HTTP status, so it appends an in-band sentinel carrying the JSON
// error. The client extracts it, removes it from the visible text, and shows the
// error panel. Failures detected BEFORE streaming use a normal JSON error body.

export const ERROR_SENTINEL_OPEN = "\n[[AOF_ERROR]]";
export const ERROR_SENTINEL_CLOSE = "[[/AOF_ERROR]]";

/** Encode an error as an in-band stream sentinel. */
export function encodeErrorSentinel(err: AofProviderError): string {
  return `${ERROR_SENTINEL_OPEN}${JSON.stringify(err)}${ERROR_SENTINEL_CLOSE}`;
}

/** Pull any error sentinel out of streamed text, returning the cleaned text. */
export function extractErrorSentinel(text: string): {
  clean: string;
  error: AofProviderError | null;
} {
  const open = text.indexOf(ERROR_SENTINEL_OPEN);
  if (open === -1) return { clean: text, error: null };
  const close = text.indexOf(ERROR_SENTINEL_CLOSE, open);
  if (close === -1) return { clean: text.slice(0, open), error: null };
  const json = text.slice(open + ERROR_SENTINEL_OPEN.length, close);
  let error: AofProviderError | null = null;
  try {
    error = JSON.parse(json) as AofProviderError;
  } catch {
    error = null;
  }
  const clean = text.slice(0, open) + text.slice(close + ERROR_SENTINEL_CLOSE.length);
  return { clean, error };
}
