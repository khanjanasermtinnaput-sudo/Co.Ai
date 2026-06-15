import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderError,
  classifyException,
  classifyHttpStatus,
  encodeErrorSentinel,
  extractErrorSentinel,
  formatErrorLog,
  publicError,
} from "../lib/provider-errors.js";

// ── classifyHttpStatus ────────────────────────────────────────────────────────

test("classifyHttpStatus: 401 → invalid key", () => {
  assert.equal(classifyHttpStatus(401, "invalid api key"), "AOF_ERROR_002");
});

test("classifyHttpStatus: 401 mentioning expiry → expired key", () => {
  assert.equal(classifyHttpStatus(401, "this key has expired"), "AOF_ERROR_003");
});

test("classifyHttpStatus: 403 → auth failure", () => {
  assert.equal(classifyHttpStatus(403, "forbidden"), "AOF_ERROR_010");
});

test("classifyHttpStatus: 429 with quota wording → quota exceeded", () => {
  assert.equal(classifyHttpStatus(429, "you exceeded your current quota"), "AOF_ERROR_004");
  assert.equal(classifyHttpStatus(429, "insufficient_quota: billing"), "AOF_ERROR_004");
});

test("classifyHttpStatus: plain 429 → rate limit", () => {
  assert.equal(classifyHttpStatus(429, "too many requests"), "AOF_ERROR_005");
});

test("classifyHttpStatus: 404 model → invalid model", () => {
  assert.equal(classifyHttpStatus(404, "the model gpt-x does not exist"), "AOF_ERROR_009");
});

test("classifyHttpStatus: 400 model → invalid model", () => {
  assert.equal(classifyHttpStatus(400, "unsupported model"), "AOF_ERROR_009");
});

test("classifyHttpStatus: 5xx → provider unavailable", () => {
  assert.equal(classifyHttpStatus(500), "AOF_ERROR_006");
  assert.equal(classifyHttpStatus(502), "AOF_ERROR_006");
  assert.equal(classifyHttpStatus(503), "AOF_ERROR_006");
  assert.equal(classifyHttpStatus(529), "AOF_ERROR_006");
});

test("classifyHttpStatus: 408/504 → timeout", () => {
  assert.equal(classifyHttpStatus(408), "AOF_ERROR_008");
  assert.equal(classifyHttpStatus(504), "AOF_ERROR_008");
});

test("classifyHttpStatus: unmapped → unknown", () => {
  assert.equal(classifyHttpStatus(418, "teapot"), "AOF_ERROR_012");
});

// ── classifyException ─────────────────────────────────────────────────────────

test("classifyException: network errors → 007", () => {
  assert.equal(classifyException(new TypeError("fetch failed")), "AOF_ERROR_007");
  assert.equal(classifyException({ code: "ECONNREFUSED" }), "AOF_ERROR_007");
  assert.equal(classifyException({ code: "ENOTFOUND" }), "AOF_ERROR_007");
});

test("classifyException: timeout → 008", () => {
  assert.equal(classifyException({ name: "TimeoutError" }), "AOF_ERROR_008");
  assert.equal(classifyException({ code: "ETIMEDOUT" }), "AOF_ERROR_008");
});

test("classifyException: SDK error with status is mapped via status", () => {
  assert.equal(classifyException({ status: 429, message: "rate limit" }), "AOF_ERROR_005");
  assert.equal(classifyException({ status: 401, message: "bad key" }), "AOF_ERROR_002");
});

test("classifyException: unknown → 012", () => {
  assert.equal(classifyException(new Error("boom")), "AOF_ERROR_012");
});

// ── buildProviderError ────────────────────────────────────────────────────────

test("buildProviderError: fills problem + solution from catalog", () => {
  const err = buildProviderError({ code: "AOF_ERROR_001", providerId: "gemini" });
  assert.equal(err.code, "AOF_ERROR_001");
  assert.equal(err.provider, "Gemini");
  assert.equal(err.problem, "API Key Missing");
  assert.match(err.solution, /GEMINI_API_KEY/);
  assert.match(err.details, /GEMINI_API_KEY/);
  assert.ok(err.timestamp);
});

test("buildProviderError: invalid-key solution names the env var + provider", () => {
  const err = buildProviderError({ code: "AOF_ERROR_002", providerId: "groq", httpStatus: 401 });
  assert.equal(err.problem, "Invalid API Key");
  assert.match(err.solution, /GROQ_API_KEY/);
  assert.equal(err.httpStatus, 401);
});

test("buildProviderError: truncates provider response to 500 chars", () => {
  const big = "x".repeat(2000);
  const err = buildProviderError({ code: "AOF_ERROR_006", providerId: "deepseek", providerResponse: big });
  assert.equal(err.providerResponse?.length, 500);
});

// ── publicError ───────────────────────────────────────────────────────────────

test("publicError: strips stack + rawError unless dev mode", () => {
  const err = buildProviderError({
    code: "AOF_ERROR_012",
    providerId: "openrouter",
    rawError: "secret-ish detail",
    stack: "Error\n at x",
  });
  const prod = publicError(err, false);
  assert.equal(prod.stack, undefined);
  assert.equal(prod.rawError, undefined);
  const dev = publicError(err, true);
  assert.equal(dev.stack, "Error\n at x");
  assert.equal(dev.rawError, "secret-ish detail");
});

// ── formatErrorLog ────────────────────────────────────────────────────────────

test("formatErrorLog: produces an [AOF ERROR] block with the key fields", () => {
  const err = buildProviderError({
    code: "AOF_ERROR_004",
    providerId: "gemini",
    httpStatus: 429,
    model: "gemini-2.0-flash",
    requestId: "req_123",
  });
  const log = formatErrorLog(err);
  assert.match(log, /\[AOF ERROR\]/);
  assert.match(log, /AOF_ERROR_004/);
  assert.match(log, /Provider: Gemini/);
  assert.match(log, /Model: gemini-2.0-flash/);
  assert.match(log, /Status: 429/);
  assert.match(log, /Request ID: req_123/);
});

// ── stream sentinel protocol ──────────────────────────────────────────────────

test("encode/extract sentinel round-trips the error and cleans the text", () => {
  const err = publicError(
    buildProviderError({ code: "AOF_ERROR_006", providerId: "groq", httpStatus: 503 }),
    false,
  );
  const stream = "Here is a partial answer." + encodeErrorSentinel(err);
  const { clean, error } = extractErrorSentinel(stream);
  assert.equal(clean, "Here is a partial answer.");
  assert.equal(error?.code, "AOF_ERROR_006");
  assert.equal(error?.provider, "Groq");
});

test("extractErrorSentinel: passthrough when no sentinel present", () => {
  const { clean, error } = extractErrorSentinel("just a normal reply");
  assert.equal(clean, "just a normal reply");
  assert.equal(error, null);
});

test("extractErrorSentinel: handles an unterminated sentinel by trimming it", () => {
  const partial = "answer\n[[AOF_ERROR]]{\"code\":\"AOF_ERR";
  const { clean, error } = extractErrorSentinel(partial);
  assert.equal(clean, "answer");
  assert.equal(error, null);
});
