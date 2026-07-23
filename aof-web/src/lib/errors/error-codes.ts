// ── Unified Error Code Registry ───────────────────────────────────────────────
// Central source of truth for all user-visible error codes. Every failure in
// the application must map to one of these entries so users always see a code,
// title, cause description, and actionable fix — never "Something went wrong."
//
// Format: <DOMAIN>-<STATUS>
//   AUTH  — authentication / authorization
//   API   — generic API layer errors
//   DB    — database / persistence errors
//   AI    — AI provider failures (maps to provider-specific context)
//   FILE  — upload / file processing errors
//   SYSTEM — runtime / React errors
//
// Every API route should use this registry via `api-error.ts`'s `formatError()`
// EXCEPT chat/route.ts and refactor/route.ts, which use the separate
// `lib/errors.ts` (`AofProviderError`) system instead — that one is
// specifically the AI-provider mid-stream failure envelope, a different
// concern from this general REST error shape. See lib/errors.ts's header for
// why the two aren't consolidated.

export interface ErrorEntry {
  code: string;
  title: string;
  message: string;
  solution: string;
  category: "auth" | "api" | "db" | "ai" | "file" | "system";
  httpStatus?: number;
}

export const ERROR_CODES = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  AUTH_401: {
    code: "AUTH-401",
    title: "Authentication Required",
    message: "Your session has expired or is invalid.",
    solution: "Please sign in again.",
    category: "auth",
    httpStatus: 401,
  },
  AUTH_403: {
    code: "AUTH-403",
    title: "Access Denied",
    message: "You do not have permission to perform this action.",
    solution: "Contact your administrator or upgrade your plan.",
    category: "auth",
    httpStatus: 403,
  },

  // ── API ─────────────────────────────────────────────────────────────────────
  API_401: {
    code: "API-401",
    title: "API Authentication Failed",
    message: "The request could not be authenticated with the server.",
    solution: "Sign in again. If the problem persists, contact support.",
    category: "api",
    httpStatus: 401,
  },
  API_429: {
    code: "API-429",
    title: "Rate Limit Exceeded",
    message: "Too many requests in a short period.",
    solution: "Wait a moment and try again.",
    category: "api",
    httpStatus: 429,
  },
  API_500: {
    code: "API-500",
    title: "Server Error",
    message: "The server encountered an unexpected condition.",
    solution: "Try again. If the problem persists, contact support.",
    category: "api",
    httpStatus: 500,
  },

  // ── Database ─────────────────────────────────────────────────────────────────
  DB_500: {
    code: "DB-500",
    title: "Database Error",
    message: "A database operation failed unexpectedly.",
    solution: "Try again. If the problem persists, contact support.",
    category: "db",
    httpStatus: 500,
  },

  // ── AI Providers ─────────────────────────────────────────────────────────────
  AI_001: {
    code: "AI-001",
    title: "OpenAI Error",
    message: "The OpenAI API returned an error.",
    solution: "Check your OpenAI API key and usage limits.",
    category: "ai",
  },
  AI_003: {
    code: "AI-003",
    title: "Gemini Error",
    message: "The Google Gemini API returned an error.",
    solution: "Check your Gemini API key and usage limits.",
    category: "ai",
  },
  AI_004: {
    code: "AI-004",
    title: "DeepSeek Error",
    message: "The DeepSeek API returned an error.",
    solution: "Check your DeepSeek API key and usage limits.",
    category: "ai",
  },
  AI_005: {
    code: "AI-005",
    title: "OpenRouter Error",
    message: "The OpenRouter API returned an error.",
    solution: "Check your OpenRouter API key and usage limits.",
    category: "ai",
  },
  AI_429: {
    code: "AI-429",
    title: "AI Rate Limited",
    message: "The AI provider is rate limiting requests.",
    solution: "Wait a moment and try again, or switch to a different provider.",
    category: "ai",
    httpStatus: 429,
  },

  // ── File ──────────────────────────────────────────────────────────────────────
  FILE_001: {
    code: "FILE-001",
    title: "File Processing Error",
    message: "The uploaded file could not be processed.",
    solution: "Ensure the file is in a supported format and try again.",
    category: "file",
  },
  FILE_413: {
    code: "FILE-413",
    title: "File Too Large",
    message: "The file exceeds the maximum allowed size.",
    solution: "Upload a smaller file or compress the existing one.",
    category: "file",
    httpStatus: 413,
  },

  // ── System ───────────────────────────────────────────────────────────────────
  SYSTEM_500: {
    code: "SYSTEM-500",
    title: "Unexpected Application Error",
    message: "An unexpected error occurred in the application.",
    solution: "Refresh the page. If the problem persists, contact support.",
    category: "system",
    httpStatus: 500,
  },
} as const satisfies Record<string, ErrorEntry>;

export type ErrorKey = keyof typeof ERROR_CODES;
export type AppErrorCode = (typeof ERROR_CODES)[ErrorKey]["code"];

/** Look up an entry by its dot-less code string, e.g. "AUTH-401". */
export function findByCode(code: string): ErrorEntry | undefined {
  return Object.values(ERROR_CODES).find((e) => e.code === code);
}

/** Map an AI provider name to its AI-00x code key. */
export function aiProviderKey(provider: string): ErrorKey {
  const p = provider.toLowerCase();
  if (p.includes("openai") || p.includes("gpt")) return "AI_001";
  if (p.includes("gemini") || p.includes("google")) return "AI_003";
  if (p.includes("deepseek")) return "AI_004";
  if (p.includes("openrouter")) return "AI_005";
  return "AI_001";
}
