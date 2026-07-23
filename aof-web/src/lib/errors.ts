// ── Co.AI — Provider Error Model (shared: server + client) ────────────────────
// The single source of truth for how AI-provider failures are represented,
// classified, logged, streamed and rendered across Co.AI.
//
// Design principle (non-negotiable): Co.AI must NEVER pretend AI is working
// when it is not. Every provider failure becomes a structured `AofProviderError`
// that tells the user *what* failed, *why*, *which provider*, and *how to fix
// it* — then the assistant stops. No fake responses, no silent fallbacks.
//
// This module is environment-agnostic (no Node- or browser-only imports) so the
// exact same classification + serialization runs on the API route and in the UI.
//
// This is deliberately a SEPARATE system from `lib/errors/error-codes.ts`'s
// general "Unified Error Code Registry" (AUTH-401, DB-500, etc.) — that one
// covers ordinary REST API failures across the app; this one is specifically
// the AI-provider streaming-failure envelope used by chat/route.ts and
// refactor/route.ts, and nowhere else. Don't consolidate the two: they answer
// different questions ("what REST error occurred" vs. "which provider failed
// and why, mid-stream") and chat/refactor's routes are the ONLY places that
// should ever import this file instead of the general registry.

// ── Error codes ───────────────────────────────────────────────────────────────
// Numbering follows the COAGENTIX spec's ERROR CODES list (001–013).

export const AOF_ERROR_CODES = [
  "AOF_ERROR_001", // API Key Missing
  "AOF_ERROR_002", // Invalid API Key
  "AOF_ERROR_003", // Expired API Key
  "AOF_ERROR_004", // Quota Exceeded
  "AOF_ERROR_005", // Rate Limit Exceeded
  "AOF_ERROR_006", // Provider Unavailable
  "AOF_ERROR_007", // Network Failure
  "AOF_ERROR_008", // Request Timeout
  "AOF_ERROR_009", // Invalid Model
  "AOF_ERROR_010", // Authentication Failure
  "AOF_ERROR_011", // Empty Response
  "AOF_ERROR_012", // Unknown Provider Error
  "AOF_ERROR_013", // Configuration Error
] as const;

export type AofErrorCode = (typeof AOF_ERROR_CODES)[number];

interface CatalogEntry {
  /** Short human label, e.g. "Quota Exceeded". */
  problem: string;
  /** Generic remediation, used when no provider-specific solution is supplied. */
  solution: string;
  /** Whether trying a *different* provider could plausibly succeed. Drives
   *  whether the route attempts (and announces) a failover. */
  failoverWorthy: boolean;
}

/** The canonical meaning of every AOF error code. */
export const ERROR_CATALOG: Record<AofErrorCode, CatalogEntry> = {
  AOF_ERROR_001: {
    problem: "API Key Missing",
    solution: "Add the provider's API key to your environment (.env.local) and restart.",
    failoverWorthy: true,
  },
  AOF_ERROR_002: {
    problem: "Invalid API Key",
    solution: "The key was rejected. Replace it with a valid key from the provider dashboard.",
    failoverWorthy: true,
  },
  AOF_ERROR_003: {
    problem: "Expired API Key",
    solution: "Generate a fresh API key in the provider dashboard and update your environment.",
    failoverWorthy: true,
  },
  AOF_ERROR_004: {
    problem: "Quota Exceeded",
    solution: "Your account is out of credit/quota. Add billing or wait for the quota to reset.",
    failoverWorthy: true,
  },
  AOF_ERROR_005: {
    problem: "Rate Limit Exceeded",
    solution: "Too many requests. Slow down and retry in a few seconds.",
    failoverWorthy: true,
  },
  AOF_ERROR_006: {
    problem: "Provider Unavailable",
    solution: "The provider is down or overloaded. Retry shortly or switch providers.",
    failoverWorthy: true,
  },
  AOF_ERROR_007: {
    problem: "Network Failure",
    solution: "Co.AI could not reach the provider. Check the server's network/DNS and retry.",
    failoverWorthy: true,
  },
  AOF_ERROR_008: {
    problem: "Request Timeout",
    solution: "The provider took too long to respond. Retry, or reduce the request size.",
    failoverWorthy: true,
  },
  AOF_ERROR_009: {
    problem: "Invalid Model",
    solution: "The requested model name is wrong or not available to this key. Fix the model id.",
    failoverWorthy: true,
  },
  AOF_ERROR_010: {
    problem: "Authentication Failure",
    solution: "The provider refused the credentials. Verify the key and its permissions.",
    failoverWorthy: true,
  },
  AOF_ERROR_011: {
    problem: "Empty Response",
    solution: "The provider returned no content. Retry; if it persists, check the model/prompt.",
    failoverWorthy: true,
  },
  AOF_ERROR_012: {
    problem: "Unknown Provider Error",
    solution: "An unrecognized provider error occurred. Inspect the details and provider status.",
    failoverWorthy: true,
  },
  AOF_ERROR_013: {
    problem: "Configuration Error",
    solution: "Co.AI is misconfigured for this provider. Review your environment configuration.",
    failoverWorthy: false,
  },
};

// ── The error object ──────────────────────────────────────────────────────────

export interface AofProviderError {
  /** Discriminant for the structured-error envelope. */
  readonly kind: "coagentix-provider-error";
  code: AofErrorCode;
  /** Short label, e.g. "Quota Exceeded". */
  problem: string;
  /** Display name of the provider that failed, e.g. "Google Gemini". */
  provider: string;
  /** Model in play when it failed, when known. */
  model?: string;
  /** Human-readable specifics of this particular failure. */
  details: string;
  /** Actionable remediation for the user. */
  solution: string;
  /** ISO-8601 timestamp of when the failure was classified. */
  timestamp: string;

  // ── Diagnostic fields (surfaced only in Developer Mode) ─────────────────────
  /** Upstream HTTP status code, when the failure was an HTTP response. */
  statusCode?: number;
  /** Correlates the UI error with the matching server log line. */
  requestId?: string;
  /** Raw provider message (redacted of anything secret-looking). */
  rawMessage?: string;
  /** Raw upstream response body (truncated + redacted). */
  responseBody?: string;
  /** Error stack, for server-side debugging. */
  stack?: string;
}

/** Type guard — used by stream readers and the UI to detect an error envelope. */
export function isAofProviderError(v: unknown): v is AofProviderError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { kind?: unknown }).kind === "coagentix-provider-error" &&
    typeof (v as { code?: unknown }).code === "string"
  );
}

// ── Redaction ─────────────────────────────────────────────────────────────────
// Diagnostic fields can echo request metadata; make sure a key never leaks into
// a log line or the Developer Mode panel.

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|sk-or|sk-ant|gsk|key)[-_][A-Za-z0-9._-]{6,}\b/g, // common key prefixes
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, // Authorization: Bearer …
  /"?api[_-]?key"?\s*[:=]\s*"?[A-Za-z0-9._-]{8,}"?/gi, // api_key=… / "apiKey": "…"
];

/** Replace anything that looks like a secret with a placeholder. */
export function redact(text: string | undefined): string | undefined {
  if (!text) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "«redacted»");
  return out;
}

// ── Classification ──────────────────────────────────────────────────────────
// Maps any provider failure (HTTP status, SDK error type, or thrown Error) onto
// the correct AOF error code. Kept deliberately defensive: status codes are the
// strongest signal, message/type text refines ambiguous cases (401 invalid vs.
// expired, 429 quota vs. rate-limit, 404 model vs. provider-down).

export interface ClassifyInput {
  /** Display name of the provider, e.g. "Google Gemini". */
  provider: string;
  model?: string;
  /** HTTP status from the upstream response, if any. */
  status?: number;
  /** Error message (Error.message, or upstream body summary). */
  message?: string;
  /** Provider error "type"/"code" string, when the upstream response includes one. */
  errorType?: string;
  /** Strong explicit hint that short-circuits status/message heuristics. */
  hint?: "missing-key" | "network" | "timeout" | "empty" | "config";
  /** Env var name for the missing-key remediation text. */
  envVar?: string;
  requestId?: string;
  stack?: string;
  responseBody?: string;
}

// Coerce defensively: providers sometimes send a numeric `code` where a string
// error-type is expected, and `(429).toLowerCase()` would throw mid-classification.
const hay = (s?: unknown) => String(s ?? "").toLowerCase();

/** Build a finished `AofProviderError` from a code + the input context. */
function build(code: AofErrorCode, input: ClassifyInput, details: string, solution?: string): AofProviderError {
  const entry = ERROR_CATALOG[code];
  return {
    kind: "coagentix-provider-error",
    code,
    problem: entry.problem,
    provider: input.provider,
    model: input.model,
    details,
    solution: solution ?? entry.solution,
    timestamp: new Date().toISOString(),
    statusCode: input.status,
    requestId: input.requestId,
    rawMessage: redact(input.message),
    responseBody: redact(input.responseBody?.slice(0, 1200)),
    stack: input.stack,
  };
}

export function classifyProviderError(input: ClassifyInput): AofProviderError {
  const msg = hay(input.message);
  const type = hay(input.errorType);
  const both = `${type} ${msg}`;
  const status = input.status;

  // 1) Explicit hints win.
  if (input.hint === "missing-key") {
    const env = input.envVar ?? `${input.provider.toUpperCase()}_API_KEY`;
    return build(
      "AOF_ERROR_001",
      input,
      `${env} is not set, so Co.AI cannot authenticate with ${input.provider}.`,
      `Add ${env} to .env.local (server-side) and restart the app.`,
    );
  }
  if (input.hint === "config") {
    return build("AOF_ERROR_013", input, input.message || `Co.AI is misconfigured for ${input.provider}.`);
  }
  if (input.hint === "empty") {
    return build(
      "AOF_ERROR_011",
      input,
      `${input.provider} accepted the request but returned no content.`,
    );
  }
  if (input.hint === "timeout") {
    return build("AOF_ERROR_008", input, `${input.provider} did not respond before the timeout elapsed.`);
  }
  if (input.hint === "network") {
    return build(
      "AOF_ERROR_007",
      input,
      `Co.AI could not establish a connection to ${input.provider}. ${input.message ?? ""}`.trim(),
    );
  }

  // 2) Message/type-driven detection that should win over the status code.
  if (/abort|timed? ?out|etimedout|esockettimedout|deadline/.test(both)) {
    return build("AOF_ERROR_008", input, `${input.provider} timed out: ${input.message ?? "no response in time"}.`);
  }
  if (/enotfound|econnrefused|econnreset|eai_again|fetch failed|network|dns|getaddrinfo|socket hang up/.test(both)) {
    return build("AOF_ERROR_007", input, `Network error reaching ${input.provider}: ${input.message ?? "connection failed"}.`);
  }

  // 3) Status-code driven detection.
  if (typeof status === "number") {
    if (status === 401) {
      if (/expire/.test(both)) return build("AOF_ERROR_003", input, `${input.provider} reports the API key has expired.`);
      if (/invalid|incorrect|not.?valid|no.?such.?key/.test(both))
        return build("AOF_ERROR_002", input, `${input.provider} rejected the API key as invalid.`);
      return build("AOF_ERROR_010", input, `${input.provider} authentication failed (401).`);
    }
    if (status === 403) {
      if (/quota|billing|credit|insufficient|exceeded/.test(both))
        return build("AOF_ERROR_004", input, `${input.provider} denied the request for quota/billing reasons (403).`);
      return build("AOF_ERROR_010", input, `${input.provider} denied access for these credentials (403).`);
    }
    if (status === 404) {
      return build(
        "AOF_ERROR_009",
        input,
        `${input.provider} could not find the requested model${input.model ? ` "${input.model}"` : ""} (404).`,
      );
    }
    if (status === 408) return build("AOF_ERROR_008", input, `${input.provider} request timed out (408).`);
    if (status === 429) {
      if (/quota|billing|credit|insufficient|monthly|spending|out of/.test(both))
        return build("AOF_ERROR_004", input, `${input.provider} quota exhausted (429).`);
      return build("AOF_ERROR_005", input, `${input.provider} rate limit exceeded (429). Retry shortly.`);
    }
    if (status === 400 || status === 422) {
      // Gemini returns 400 (not 401) for invalid API keys
      if (/api.?key|invalid.?key|not.?valid.?key/.test(both))
        return build("AOF_ERROR_002", input, `${input.provider} rejected the API key as invalid (${status}).`);
      if (/model/.test(both))
        return build("AOF_ERROR_009", input, `${input.provider} rejected the model${input.model ? ` "${input.model}"` : ""} (${status}).`);
      return build("AOF_ERROR_012", input, `${input.provider} rejected the request (${status}): ${input.message ?? "bad request"}.`);
    }
    if (status === 402) return build("AOF_ERROR_004", input, `${input.provider} requires payment / out of credit (402).`);
    if (status >= 500) {
      return build("AOF_ERROR_006", input, `${input.provider} is unavailable (${status})${/overload/.test(both) ? " — overloaded" : ""}.`);
    }
  }

  // 4) Type-only signals (no/odd status).
  if (/insufficient_quota|quota|resource_exhausted/.test(type)) return build("AOF_ERROR_004", input, `${input.provider} quota exhausted.`);
  if (/rate_?limit|overloaded|too_many|throttling/.test(type)) return build("AOF_ERROR_005", input, `${input.provider} rate limit exceeded.`);
  if (/invalid_api_key|authentication/.test(type)) return build("AOF_ERROR_002", input, `${input.provider} rejected the API key.`);
  if (/permission/.test(type)) return build("AOF_ERROR_010", input, `${input.provider} authentication/permission failure.`);
  if (/not_found|model/.test(type)) return build("AOF_ERROR_009", input, `${input.provider} model not found.`);

  // 5) Nothing matched.
  return build(
    "AOF_ERROR_012",
    input,
    `${input.provider} returned an unrecognized error${status ? ` (status ${status})` : ""}: ${input.message ?? "no detail"}.`,
  );
}

// ── Convenience builders ──────────────────────────────────────────────────────

export function missingKeyError(provider: string, envVar: string, model?: string): AofProviderError {
  return classifyProviderError({ provider, envVar, model, hint: "missing-key" });
}

export function configError(provider: string, message: string): AofProviderError {
  return classifyProviderError({ provider, message, hint: "config" });
}

export function emptyResponseError(provider: string, model?: string, requestId?: string): AofProviderError {
  return classifyProviderError({ provider, model, requestId, hint: "empty" });
}

// ── Failover notice ───────────────────────────────────────────────────────────

export interface FailoverNotice {
  readonly kind: "coagentix-failover";
  from: string;
  to: string;
  /** Why the primary was abandoned — usually the primary error's problem+code. */
  reason: string;
  /** 50-98% capability-match score explaining why `to` was chosen (see Section 5,
   *  model-registry.ts matchScore()). Omitted when a score couldn't be computed. */
  matchScore?: number;
  timestamp: string;
}

export function isFailoverNotice(v: unknown): v is FailoverNotice {
  return typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "coagentix-failover";
}

export function makeFailoverNotice(from: string, to: string, reason: string, matchScore?: number): FailoverNotice {
  return { kind: "coagentix-failover", from, to, reason, matchScore, timestamp: new Date().toISOString() };
}

// ── Active model notice (Section 1 / Section 6 transparency panel) ────────────
// Announces which model is actually answering — prefixed to every successful
// stream, the same way a failover notice is prefixed to a switched one. This is
// what lets the UI always show "Active Model" / "Current AI" without guessing.

export interface ModelNotice {
  readonly kind: "coagentix-model";
  provider: string;
  model: string;
  /** Human task label, e.g. "Code Generation" (model-registry.ts ROLE_LABEL). */
  role: string;
  timestamp: string;
}

export function isModelNotice(v: unknown): v is ModelNotice {
  return typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "coagentix-model";
}

export function makeModelNotice(provider: string, model: string, role: string): ModelNotice {
  return { kind: "coagentix-model", provider, model, role, timestamp: new Date().toISOString() };
}

// ── Search sources notice (Universal Search citation system) ──────────────────
// When a reply was grounded on live web search, the route prefixes the stream
// with the list of sources it consulted so the UI can render a transparent
// "Sources Used · Retrieved At · Provider" citation block under the answer.

export interface Citation {
  title: string;
  url: string;
  /** Short excerpt that was fed into the model's context. */
  snippet?: string;
  /** Which provider returned this hit (e.g. "Tavily", "Wikipedia"). */
  source: string;
}

export interface SourcesNotice {
  readonly kind: "coagentix-sources";
  /** The provider that ultimately served the results. */
  provider: string;
  /** The effective query that was searched. */
  query: string;
  retrievedAt: string;
  sources: Citation[];
}

export function isSourcesNotice(v: unknown): v is SourcesNotice {
  return typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "coagentix-sources";
}

export function makeSourcesNotice(provider: string, query: string, sources: Citation[]): SourcesNotice {
  return { kind: "coagentix-sources", provider, query, sources, retrievedAt: new Date().toISOString() };
}

// ── Token usage notice ──────────────────────────────────────────────────────
// Real input/output token counts reported by the provider, appended once a
// stream finishes cleanly. Rendered by the UI as a per-message usage badge.

export interface UsageNotice {
  readonly kind: "coagentix-usage";
  inputTokens: number;
  outputTokens: number;
}

export function isUsageNotice(v: unknown): v is UsageNotice {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { kind?: unknown }).kind === "coagentix-usage" &&
    Number.isFinite((v as { inputTokens?: unknown }).inputTokens) &&
    Number.isFinite((v as { outputTokens?: unknown }).outputTokens)
  );
}

export function makeUsageNotice(inputTokens: number, outputTokens: number): UsageNotice {
  return { kind: "coagentix-usage", inputTokens, outputTokens };
}

// ── Workflow stage notice (Model Workflow — per-tier pipeline stages) ─────────
// Announces progress through a multi-stage request (e.g. Kanon's Context
// Builder → Processing → Deep Think → Review) so the UI can show live status
// before the final stage's tokens start streaming. `stage` is kept as a plain
// string here (not the WorkflowStage union) so this module has no dependency
// on model-workflow.ts — layering stays one-directional.

export interface StageNotice {
  readonly kind: "coagentix-stage";
  stage: string;
  label: string;
  /** 1-based position of this stage in the request's full sequence. */
  index: number;
  total: number;
  status: "running" | "done";
  timestamp: string;
}

export function isStageNotice(v: unknown): v is StageNotice {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { kind?: unknown }).kind === "coagentix-stage" &&
    Number.isFinite((v as { index?: unknown }).index) &&
    Number.isFinite((v as { total?: unknown }).total) &&
    ((v as { status?: unknown }).status === "running" || (v as { status?: unknown }).status === "done")
  );
}

export function makeStageNotice(
  stage: string,
  label: string,
  index: number,
  total: number,
  status: "running" | "done",
): StageNotice {
  return { kind: "coagentix-stage", stage, label, index, total, status, timestamp: new Date().toISOString() };
}

// ── Wire protocol ─────────────────────────────────────────────────────────────
// The chat route streams plain text. To carry an error or failover notice inside
// that same text channel (mid-stream), we wrap a JSON payload between sentinels
// delimited by the NUL control character, which language models never emit and
// `JSON.stringify` always escapes — so a frame can never collide with real output
// or its own payload. Pre-stream errors are returned as a normal JSON HTTP
// response instead (see `errorResponse` in the route).

const NUL = String.fromCharCode(0);
const ERR_OPEN = NUL + "CGNTX_ERR" + NUL;
const ERR_CLOSE = NUL + "/CGNTX_ERR" + NUL;
const FO_OPEN = NUL + "CGNTX_FO" + NUL;
const FO_CLOSE = NUL + "/CGNTX_FO" + NUL;
const MN_OPEN = NUL + "CGNTX_MN" + NUL;
const MN_CLOSE = NUL + "/CGNTX_MN" + NUL;
const SRC_OPEN = NUL + "CGNTX_SRC" + NUL;
const SRC_CLOSE = NUL + "/CGNTX_SRC" + NUL;
const US_OPEN = NUL + "CGNTX_US" + NUL;
const US_CLOSE = NUL + "/CGNTX_US" + NUL;
const ST_OPEN = NUL + "CGNTX_ST" + NUL;
const ST_CLOSE = NUL + "/CGNTX_ST" + NUL;

export function encodeErrorFrame(error: AofProviderError): string {
  return ERR_OPEN + JSON.stringify(error) + ERR_CLOSE;
}
export function encodeFailoverFrame(notice: FailoverNotice): string {
  return FO_OPEN + JSON.stringify(notice) + FO_CLOSE;
}
export function encodeModelFrame(notice: ModelNotice): string {
  return MN_OPEN + JSON.stringify(notice) + MN_CLOSE;
}
export function encodeSourcesFrame(notice: SourcesNotice): string {
  return SRC_OPEN + JSON.stringify(notice) + SRC_CLOSE;
}
export function encodeUsageFrame(notice: UsageNotice): string {
  return US_OPEN + JSON.stringify(notice) + US_CLOSE;
}
export function encodeStageFrame(notice: StageNotice): string {
  return ST_OPEN + JSON.stringify(notice) + ST_CLOSE;
}

export interface DecodedFrames {
  /** Plain text with all control frames removed. */
  text: string;
  errors: AofProviderError[];
  failovers: FailoverNotice[];
  models: ModelNotice[];
  sources: SourcesNotice[];
  usage: UsageNotice[];
  stages: StageNotice[];
  /** An incomplete trailing frame the caller should prepend to the next chunk. */
  remainder: string;
}

/**
 * Pull any complete error/failover frames out of a streamed buffer. Returns the
 * clean text plus decoded control payloads, and the `remainder` (an incomplete
 * trailing frame, or a partial sentinel split across a chunk boundary) that the
 * caller should prepend to the next chunk.
 */
type FrameKind = "err" | "fo" | "mn" | "src" | "us" | "st";
const FRAME_SENTINELS: Record<FrameKind, { open: string; close: string }> = {
  err: { open: ERR_OPEN, close: ERR_CLOSE },
  fo: { open: FO_OPEN, close: FO_CLOSE },
  mn: { open: MN_OPEN, close: MN_CLOSE },
  src: { open: SRC_OPEN, close: SRC_CLOSE },
  us: { open: US_OPEN, close: US_CLOSE },
  st: { open: ST_OPEN, close: ST_CLOSE },
};

export function decodeFrames(buffer: string): DecodedFrames {
  const errors: AofProviderError[] = [];
  const failovers: FailoverNotice[] = [];
  const models: ModelNotice[] = [];
  const sources: SourcesNotice[] = [];
  const usage: UsageNotice[] = [];
  const stages: StageNotice[] = [];
  let text = "";
  let i = 0;

  while (i < buffer.length) {
    const starts = (Object.entries(FRAME_SENTINELS) as [FrameKind, { open: string; close: string }][]).map(
      ([kind, s]) => ({ kind, idx: buffer.indexOf(s.open, i) }),
    );
    const candidates = starts.filter((s) => s.idx >= 0).sort((a, b) => a.idx - b.idx);
    const hit = candidates[0];

    if (!hit) {
      // No more frames — but a sentinel could be split across the chunk boundary.
      const tail = partialSentinelTail(buffer);
      const cut = Math.max(i, buffer.length - tail.length);
      text += buffer.slice(i, cut);
      return { text, errors, failovers, models, sources, usage, stages, remainder: buffer.slice(cut) };
    }

    text += buffer.slice(i, hit.idx);

    const { open, close } = FRAME_SENTINELS[hit.kind];
    const closeIdx = buffer.indexOf(close, hit.idx + open.length);
    if (closeIdx < 0) {
      // Frame not yet complete — keep everything from `hit.idx` for the next pass.
      return { text, errors, failovers, models, sources, usage, stages, remainder: buffer.slice(hit.idx) };
    }
    const json = buffer.slice(hit.idx + open.length, closeIdx);
    try {
      const parsed = JSON.parse(json);
      if (hit.kind === "err" && isAofProviderError(parsed)) errors.push(parsed);
      else if (hit.kind === "fo" && isFailoverNotice(parsed)) failovers.push(parsed);
      else if (hit.kind === "mn" && isModelNotice(parsed)) models.push(parsed);
      else if (hit.kind === "src" && isSourcesNotice(parsed)) sources.push(parsed);
      else if (hit.kind === "us" && isUsageNotice(parsed)) usage.push(parsed);
      else if (hit.kind === "st" && isStageNotice(parsed)) stages.push(parsed);
    } catch {
      /* drop a corrupt frame rather than render its bytes */
    }
    i = closeIdx + close.length;
  }

  return { text, errors, failovers, models, sources, usage, stages, remainder: "" };
}

/** The longest proper prefix of a sentinel-open marker at the end of the buffer. */
function partialSentinelTail(buffer: string): string {
  let best = "";
  for (const marker of [ERR_OPEN, FO_OPEN, MN_OPEN, SRC_OPEN, US_OPEN, ST_OPEN]) {
    const max = Math.min(marker.length - 1, buffer.length);
    for (let len = max; len > best.length; len--) {
      if (buffer.endsWith(marker.slice(0, len))) {
        best = marker.slice(0, len);
        break;
      }
    }
  }
  return best;
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format an ISO timestamp as `YYYY-MM-DD HH:MM:SS UTC` (matches AOF log style). */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}

/** Render the canonical COAGENTIX error block (used in copy-to-clipboard + plain text). */
export function formatErrorBlock(e: AofProviderError): string {
  return [
    e.code,
    "",
    `Provider: ${e.provider}${e.model ? ` · ${e.model}` : ""}`,
    `Problem: ${e.problem}`,
    `Details: ${e.details}`,
    `Solution: ${e.solution}`,
    `Timestamp: ${formatUtc(e.timestamp)}`,
  ].join("\n");
}

/** A new request id used to correlate the UI error with the server log. */
export function newRequestId(): string {
  try {
    return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? fallbackId();
  } catch {
    return fallbackId();
  }
}
function fallbackId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
