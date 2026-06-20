// ── Client-side Error Logger ───────────────────────────────────────────────────
// Captures every application error in a ring buffer (last 100) for the
// diagnostics panel. Optionally persists to Supabase `error_logs` when a user
// is authenticated and the DB is configured. Runs in the browser only.

import { ERROR_CODES, findByCode, type AppErrorCode } from "./error-codes";

export interface ErrorLogEntry {
  id: string;
  errorCode: AppErrorCode | string;
  title: string;
  message: string;
  route: string;
  userId?: string;
  stack?: string;
  userAgent?: string;
  timestamp: number;
}

const MAX_ENTRIES = 100;
const STORE_KEY = "aof.error-log";

// ── In-memory ring buffer ─────────────────────────────────────────────────────

let _buffer: ErrorLogEntry[] = [];
let _listeners: Array<(entries: ErrorLogEntry[]) => void> = [];

function notify() {
  for (const fn of _listeners) fn([..._buffer]);
}

/** Subscribe to log updates (returns unsubscribe). */
export function subscribeErrorLog(fn: (entries: ErrorLogEntry[]) => void): () => void {
  _listeners.push(fn);
  fn([..._buffer]);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

/** Current snapshot of the log (newest first). */
export function getErrorLog(): ErrorLogEntry[] {
  return [..._buffer];
}

/** Clear the in-memory log. */
export function clearErrorLog(): void {
  _buffer = [];
  notify();
}

// ── Core logger ───────────────────────────────────────────────────────────────

export interface LogOptions {
  code?: string;
  userId?: string;
  stack?: string;
}

/**
 * Record an error. Works in browser only; silently no-ops on the server.
 * Stores in the memory ring buffer and attempts async Supabase persistence.
 */
export function logClientError(
  errorOrMessage: Error | string,
  opts: LogOptions = {},
): ErrorLogEntry {
  const isError = errorOrMessage instanceof Error;
  const message = isError ? errorOrMessage.message : errorOrMessage;
  const stack = opts.stack ?? (isError ? errorOrMessage.stack : undefined);

  const code = opts.code ?? "SYSTEM-500";
  const entry_def = findByCode(code);

  const entry: ErrorLogEntry = {
    id: newId(),
    errorCode: code as AppErrorCode,
    title: entry_def?.title ?? "Application Error",
    message,
    route: typeof window !== "undefined" ? window.location.pathname : "server",
    userId: opts.userId,
    stack,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    timestamp: Date.now(),
  };

  // Ring buffer — drop oldest when at capacity.
  _buffer = [entry, ..._buffer].slice(0, MAX_ENTRIES);
  notify();

  // Non-blocking Supabase write — import dynamically to keep this module
  // environment-agnostic (no Node imports via supabase-admin).
  if (typeof window !== "undefined") {
    void persistToSupabase(entry).catch(() => {/* already logged to console */});
  }

  return entry;
}

// ── Supabase persistence ───────────────────────────────────────────────────────

async function persistToSupabase(entry: ErrorLogEntry): Promise<void> {
  try {
    const { getSupabase } = await import("@/lib/supabase/client");
    const db = getSupabase();
    if (!db) return;

    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData.session) return;

    await db.from("error_logs").insert({
      user_id: entry.userId ?? sessionData.session.user.id,
      error_code: entry.errorCode,
      message: entry.message,
      stack: entry.stack?.slice(0, 4000) ?? null,
    });
  } catch {
    // Silently swallow — the DB might not have the table yet, or the user
    // may be in demo mode. Never let logging failures cascade into app errors.
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Format a log entry for clipboard copy (diagnostics report). */
export function formatDiagnosticsReport(entry: ErrorLogEntry): string {
  const lines = [
    `Error Code:  ${entry.errorCode}`,
    `Title:       ${entry.title}`,
    `Message:     ${entry.message}`,
    `Route:       ${entry.route}`,
    `Timestamp:   ${new Date(entry.timestamp).toISOString()}`,
  ];
  if (entry.userId) lines.push(`User ID:     ${entry.userId}`);
  if (entry.userAgent) lines.push(`User Agent:  ${entry.userAgent}`);
  if (entry.stack) lines.push(``, `Stack Trace:`, entry.stack);
  return lines.join("\n");
}
