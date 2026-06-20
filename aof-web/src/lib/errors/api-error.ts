// ── API Error Wrapper (server-side) ───────────────────────────────────────────
// All API routes must use these helpers to return structured error responses.
// This ensures every failure reaches the client with a code, title, message,
// and timestamp — never a bare "error" string or empty 500.

import { NextResponse } from "next/server";
import { ERROR_CODES, findByCode, type ErrorKey, type ErrorEntry } from "./error-codes";

// ── Structured error envelope ─────────────────────────────────────────────────

export interface AppError {
  success: false;
  errorCode: string;
  title: string;
  message: string;
  solution: string;
  timestamp: number;
  /** Extra developer context — only safe, non-secret details. */
  detail?: string;
  requestId?: string;
}

// ── Builders ─────────────────────────────────────────────────────────────────

/** Create a structured error envelope from a registry key. */
export function createError(
  key: ErrorKey,
  overrides?: { message?: string; detail?: string; requestId?: string },
): AppError {
  const entry: ErrorEntry = ERROR_CODES[key];
  return {
    success: false,
    errorCode: entry.code,
    title: entry.title,
    message: overrides?.message ?? entry.message,
    solution: entry.solution,
    timestamp: Date.now(),
    detail: overrides?.detail,
    requestId: overrides?.requestId,
  };
}

/** Render an `AppError` as a `NextResponse` with the right HTTP status. */
export function formatError(
  key: ErrorKey,
  overrides?: { message?: string; detail?: string; requestId?: string },
  statusOverride?: number,
): NextResponse {
  const entry: ErrorEntry = ERROR_CODES[key];
  const body = createError(key, overrides);
  const status = statusOverride ?? entry.httpStatus ?? 500;
  return NextResponse.json(body, { status });
}

/** Log + return a 401 AUTH-401 response. */
export function unauthorizedError(detail?: string): NextResponse {
  return formatError("AUTH_401", { detail });
}

/** Log + return a 403 AUTH-403 response. */
export function forbiddenError(detail?: string): NextResponse {
  return formatError("AUTH_403", { detail });
}

/** Log + return a DB-500 response. */
export function dbError(detail?: string): NextResponse {
  return formatError("DB_500", { detail });
}

/** Log + return an API-429 response. */
export function rateLimitError(detail?: string): NextResponse {
  return formatError("API_429", { detail });
}

/** Log + return a SYSTEM-500 response. */
export function serverError(detail?: string): NextResponse {
  return formatError("SYSTEM_500", { detail });
}

// ── Console logger (server-side) ──────────────────────────────────────────────
// Structured output — each field on its own line, easy to grep in production.

export function logError(
  key: ErrorKey,
  context: {
    route?: string;
    userId?: string;
    detail?: string;
    stack?: string;
    requestId?: string;
  } = {},
): void {
  const entry: ErrorEntry = ERROR_CODES[key];
  const ts = new Date().toISOString();
  const lines = [
    `[ERROR] ${entry.code} — ${entry.title}`,
    `  time:   ${ts}`,
    `  route:  ${context.route ?? "unknown"}`,
    `  user:   ${context.userId ?? "anonymous"}`,
  ];
  if (context.requestId) lines.push(`  reqId:  ${context.requestId}`);
  if (context.detail) lines.push(`  detail: ${context.detail}`);
  if (context.stack) lines.push(`  stack:  ${context.stack.split("\n")[0]}`);
  console.error(lines.join("\n"));
}

// ── Type guard ────────────────────────────────────────────────────────────────

/** Returns true if the response body looks like an `AppError`. */
export function isAppError(v: unknown): v is AppError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).success === false &&
    typeof (v as Record<string, unknown>).errorCode === "string"
  );
}

/** Attempt to extract an `AppError` from a fetch Response. */
export async function parseErrorResponse(res: Response): Promise<AppError | null> {
  try {
    const json = await res.clone().json();
    if (isAppError(json)) return json;
    // Legacy shape: { error: "..." }
    const legacy = json as Record<string, unknown>;
    if (typeof legacy.error === "string") {
      const entry = findByCode(String(legacy.errorCode ?? "")) ?? null;
      return {
        success: false,
        errorCode: entry?.code ?? "API-500",
        title: entry?.title ?? "Server Error",
        message: legacy.error,
        solution: entry?.solution ?? "Try again.",
        timestamp: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}
