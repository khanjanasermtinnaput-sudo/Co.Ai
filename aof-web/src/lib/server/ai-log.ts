// ── Coagentix — server-side structured logging ────────────────────────────────
// Every provider failure is logged here in a consistent, greppable format so an
// operator can correlate a user-facing CGNTX_ERROR_xxx with the exact upstream
// status, request id and stack. Logs go to stderr/stdout (picked up by the host
// platform). Secrets are already redacted on the error object.

import type { CgntxProviderError } from "@/lib/errors";
import { formatUtc, redact } from "@/lib/errors";

/** Log a classified provider error in the canonical `[CGNTX ERROR]` block. */
export function logCgntxError(error: CgntxProviderError): void {
  const lines = [
    "[CGNTX ERROR]",
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
export function logCgntxInfo(message: string): void {
  console.info(`[CGNTX] ${formatUtc(new Date().toISOString())} ${message}`);
}

// ── Startup check ─────────────────────────────────────────────────────────────
// Logged once per server process the first time an AI route is hit, mirroring the
// Coagentix startup banner: which keys loaded, database status, overall system status.

let startupLogged = false;

export interface StartupItem {
  label: string;
  ok: boolean;
}

export function runStartupCheckOnce(items: StartupItem[], systemStatus: string): void {
  if (startupLogged) return;
  startupLogged = true;
  const lines = ["[CGNTX STARTUP CHECK]", ""];
  for (const it of items) lines.push(`${it.ok ? "✅" : "❌"} ${it.label}`);
  lines.push("", `System Status: ${systemStatus}`);
  console.info(lines.join("\n"));
}

/** Test seam: allow re-running the startup check. */
export function _resetStartupForTest(): void {
  startupLogged = false;
}
