// Structured JSON logger for tmap-v2.
// Writes to stdout (info/debug) or stderr (warn/error), one JSON object per line,
// compatible with Cloud Logging / Datadog / Loki log aggregators.
// Automatically pulls correlationId/requestId from AsyncLocalStorage when available.
// Error-level logs are also forwarded to Sentry if SENTRY_DSN is set.
//
// Secret redaction (Master Prompt Part 6.10 — Security & Permission Manager):
// this logger had no automatic redaction until now — every `fields` value was
// written to stdout/stderr verbatim, so a caller passing a raw API key or
// Authorization header would leak it into logs. Mirrors aof-web's
// src/lib/errors.ts `redact()`/SECRET_PATTERNS (separate packages, no shared
// workspace — same precedent as crypto.ts and the Tool Execution Engine's two
// independent copies), plus this package's own cgntx_sk_ developer-key prefix
// (server/developer-keys.ts). Applied to the WHOLE stringified line rather
// than walking `fields`' arbitrary shape field-by-field — a secret-looking
// substring is caught regardless of which key it was logged under.

import { getContext } from './correlation.js';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|sk-or|sk-ant|gsk|key)[-_][A-Za-z0-9._-]{6,}\b/g, // common key prefixes
  /\bcgntx_sk_[A-Za-z0-9._-]{6,}\b/g, // this package's own developer-key prefix
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, // Authorization: Bearer …
  /"?api[_-]?key"?\s*[:=]\s*"?[A-Za-z0-9._-]{8,}"?/gi, // api_key=… / "apiKey": "…"
];

/** Replace anything that looks like a secret with a placeholder. */
export function redactLogLine(line: string): string {
  let out = line;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '«redacted»');
  return out;
}

export interface LogEntry {
  ts:              string;
  level:           LogLevel;
  service:         string;
  msg:             string;
  correlationId?:  string;
  requestId?:      string;
  [key: string]:   unknown;
}

const SERVICE = 'coagentix-tmap-v2';
const DEBUG   = process.env.CGNTX_DEBUG === '1';

function write(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const ctx = getContext();
  const entry: LogEntry = {
    ts:      new Date().toISOString(),
    level,
    service: SERVICE,
    msg,
    ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    ...(ctx?.requestId     ? { requestId:     ctx.requestId     } : {}),
    ...fields,
  };

  const line = redactLogLine(JSON.stringify(entry)) + '\n';
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }

  // Forward errors to Sentry asynchronously (non-blocking).
  if (level === 'error' && process.env.SENTRY_DSN) {
    import('./telemetry.js').then(({ SentryNode }) => {
      SentryNode.addBreadcrumb({ message: msg, data: fields, level: 'error' });
    }).catch(() => {});
  }
}

// ── Logger interface ──────────────────────────────────────────────────────────

export interface Logger {
  info:  (msg: string, fields?: Record<string, unknown>) => void;
  warn:  (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

function makeLogger(bound: Record<string, unknown> = {}): Logger {
  return {
    info:  (msg, fields) => write('info',  msg, { ...bound, ...fields }),
    warn:  (msg, fields) => write('warn',  msg, { ...bound, ...fields }),
    error: (msg, fields) => write('error', msg, { ...bound, ...fields }),
    debug: (msg, fields) => { if (DEBUG) write('debug', msg, { ...bound, ...fields }); },
    child: (bindings)    => makeLogger({ ...bound, ...bindings }),
  };
}

export const logger = makeLogger();

// ── In-memory metrics (resets on restart; single-instance) ───────────────────

interface Metrics {
  requests:      number;
  errors:        number;
  tmapRuns:      number;
  tmapErrors:    number;
  totalTokens:   number;
  totalCostUsd:  number;
  agentCalls:    Record<string, number>;
  providerCalls: Record<string, number>;
  startedAt:     string;
  // ── Phase 4 counters ─────────────────────────────────────────────────────────
  hallucinationsDetected: number;
  selfCritiqueRuns: number;
  selfCritiqueFails: number;
  reflectionRuns: number;
  verifierRuns: number;
  verifierFails: number;
  evaluationsRun: number;
  // ── Phase 5 counters ─────────────────────────────────────────────────────────
  sandboxRuns: number;
  sandboxFails: number;
  quotaViolations: number;
  keyRotations: number;
  keyValidations: number;
  keyValidationFails: number;
  // ── Phase 6 counters ─────────────────────────────────────────────────────────
  teamOperations: number;
  orgOperations: number;
  backupsCreated: number;
  restoresRun: number;
  circuitBreakerTrips: number;
  analyticsEvents: number;
}

const _metrics: Metrics = {
  requests:      0,
  errors:        0,
  tmapRuns:      0,
  tmapErrors:    0,
  totalTokens:   0,
  totalCostUsd:  0,
  agentCalls:    {},
  providerCalls: {},
  startedAt:     new Date().toISOString(),
  hallucinationsDetected: 0,
  selfCritiqueRuns: 0,
  selfCritiqueFails: 0,
  reflectionRuns: 0,
  verifierRuns: 0,
  verifierFails: 0,
  evaluationsRun: 0,
  sandboxRuns: 0,
  sandboxFails: 0,
  quotaViolations: 0,
  keyRotations: 0,
  keyValidations: 0,
  keyValidationFails: 0,
  teamOperations: 0,
  orgOperations: 0,
  backupsCreated: 0,
  restoresRun: 0,
  circuitBreakerTrips: 0,
  analyticsEvents: 0,
};

export function incRequest():                          void { _metrics.requests++; }
export function incError():                            void { _metrics.errors++; }
export function incTmapRun():                          void { _metrics.tmapRuns++; }
export function incTmapError():                        void { _metrics.tmapErrors++; }
export function addTokens(tokens: number, costUsd: number): void {
  _metrics.totalTokens  += tokens;
  _metrics.totalCostUsd  = Math.round((_metrics.totalCostUsd + costUsd) * 1e8) / 1e8;
}
export function incAgentCall(role: string, provider: string): void {
  _metrics.agentCalls[role]        = (_metrics.agentCalls[role]        ?? 0) + 1;
  _metrics.providerCalls[provider] = (_metrics.providerCalls[provider] ?? 0) + 1;
}
// Phase 4 counters
export function incHallucinationDetected() { _metrics.hallucinationsDetected++; }
export function incSelfCritiqueRun(failed: boolean) {
  _metrics.selfCritiqueRuns++;
  if (failed) _metrics.selfCritiqueFails++;
}
export function incReflectionRun() { _metrics.reflectionRuns++; }
export function incVerifierRun(failed: boolean) {
  _metrics.verifierRuns++;
  if (failed) _metrics.verifierFails++;
}
export function incEvaluation() { _metrics.evaluationsRun++; }
// Phase 5 counters
export function incSandboxRun(failed: boolean) {
  _metrics.sandboxRuns++;
  if (failed) _metrics.sandboxFails++;
}
export function incQuotaViolation() { _metrics.quotaViolations++; }
export function incKeyRotation()    { _metrics.keyRotations++; }
export function incKeyValidation(success: boolean) {
  _metrics.keyValidations++;
  if (!success) _metrics.keyValidationFails++;
}
// Phase 6 counters
export function incTeamOperation()       { _metrics.teamOperations++; }
export function incOrgOperation()        { _metrics.orgOperations++; }
export function incBackupCreated()       { _metrics.backupsCreated++; }
export function incRestoreRun()          { _metrics.restoresRun++; }
export function incCircuitBreakerTrip()  { _metrics.circuitBreakerTrips++; }
export function incAnalyticsEvent()      { _metrics.analyticsEvents++; }

export function getMetrics(): Metrics & { uptimeSec: number } {
  return {
    ..._metrics,
    uptimeSec: Math.floor((Date.now() - new Date(_metrics.startedAt).getTime()) / 1000),
  };
}
