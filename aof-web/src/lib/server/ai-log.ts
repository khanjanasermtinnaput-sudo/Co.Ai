// ── Co.AI — server-side structured logging ────────────────────────────────────
// Every provider failure is logged here in a consistent, greppable format so an
// operator can correlate a user-facing AOF_ERROR_xxx with the exact upstream
// status, request id and stack. Logs go to stderr/stdout (picked up by the host
// platform). Secrets are already redacted on the error object.

import type { AofProviderError } from "@/lib/errors";
import { formatUtc, redact } from "@/lib/errors";

/** Log a classified provider error in the canonical `[AOF ERROR]` block. */
export function logAofError(error: AofProviderError): void {
  const lines = [
    "[AOF ERROR]",
    `Code: ${error.code}`,
    `Provider: ${error.provider}${error.model ? `   Model: ${error.model}` : ""}`,
    `Time: ${formatUtc(error.timestamp)}`,
    `Request ID: ${error.requestId ?? "—"}`,
    `Status: ${error.statusCode ?? "—"}`,
    `Error: ${error.problem}`,
    `Details: ${error.details}`,
  ];
  if (error.responseBody) lines.push(`Response Body: ${error.responseBody}`);
  if (error.stack) lines.push(`Stack: ${redact(error.stack)}`);
  console.error(lines.join("\n"));
}

/** Log a non-error provider event (e.g. an announced failover). */
export function logAofInfo(message: string): void {
  console.info(`[AOF] ${formatUtc(new Date().toISOString())} ${message}`);
}

/** Structured Input → Processing → Output lifecycle log (Co.AI Master Prompt
 *  Part 3 "Logging" / "Runtime Transparency"): every important runtime decision
 *  for a chat turn — model tier, stage count, provider, duration, success —
 *  greppable by requestId. Only real, observed values are ever logged; a field
 *  is simply omitted rather than fabricated. Every Model Workflow stage (Master
 *  Prompt Part 4) logs under "Processing" with a `stage=` field, following the
 *  Simple Task Detector's precedent — greppable as
 *  `[AOF STAGE] … Processing stage=deep-think executed=true durationMs=…`.
 *  Kanon's single provider call (phase-stream.ts) genuinely observes real
 *  prompt/completion token counts once the generation finishes — via
 *  `onComplete`, which can fire after the HTTP response has already been
 *  returned — and logs them on "Output" as `promptTokens`/`completionTokens`;
 *  every other path still has no usage available at this layer and omits them. */
export function logAofStage(
  stage: "Input" | "Processing" | "Output",
  fields: Record<string, string | number | boolean | undefined>,
): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.info(`[AOF STAGE] ${formatUtc(new Date().toISOString())} ${stage} ${parts}`);
}

// ── Startup check ─────────────────────────────────────────────────────────────
// Logged once per server process the first time an AI route is hit, mirroring the
// AOF startup banner: which keys loaded, database status, overall system status.

let startupLogged = false;

export interface StartupItem {
  label: string;
  ok: boolean;
}

export function runStartupCheckOnce(items: StartupItem[], systemStatus: string): void {
  if (startupLogged) return;
  startupLogged = true;
  const lines = ["[AOF STARTUP CHECK]", ""];
  for (const it of items) lines.push(`${it.ok ? "✅" : "❌"} ${it.label}`);
  lines.push("", `System Status: ${systemStatus}`);
  console.info(lines.join("\n"));
}

/** Test seam: allow re-running the startup check. */
export function _resetStartupForTest(): void {
  startupLogged = false;
}
