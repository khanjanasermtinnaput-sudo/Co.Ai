import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProviderError,
  missingKeyError,
  configError,
  emptyResponseError,
  redact,
  isAofProviderError,
  isFailoverNotice,
  makeFailoverNotice,
  encodeErrorFrame,
  encodeFailoverFrame,
  decodeFrames,
  formatErrorBlock,
  formatUtc,
  ERROR_CATALOG,
  type AofErrorCode,
} from "../lib/errors.js";

const P = "Claude (Anthropic)";

// ── Classification by hint ──────────────────────────────────────────────────

test("missing-key hint → AOF_ERROR_001 with env var in solution", () => {
  const e = missingKeyError(P, "ANTHROPIC_API_KEY");
  assert.equal(e.code, "AOF_ERROR_001");
  assert.equal(e.problem, "API Key Missing");
  assert.match(e.details, /ANTHROPIC_API_KEY/);
  assert.match(e.solution, /ANTHROPIC_API_KEY/);
});

test("config hint → AOF_ERROR_013", () => {
  assert.equal(configError(P, "bad config").code, "AOF_ERROR_013");
});

test("empty hint → AOF_ERROR_011", () => {
  assert.equal(emptyResponseError(P).code, "AOF_ERROR_011");
});

test("timeout hint → AOF_ERROR_008", () => {
  assert.equal(classifyProviderError({ provider: P, hint: "timeout" }).code, "AOF_ERROR_008");
});

test("network hint → AOF_ERROR_007", () => {
  assert.equal(classifyProviderError({ provider: P, hint: "network" }).code, "AOF_ERROR_007");
});

// ── Classification by HTTP status ───────────────────────────────────────────

test("401 invalid → 002, expired → 003, generic → 010", () => {
  assert.equal(classifyProviderError({ provider: P, status: 401, message: "invalid x-api-key" }).code, "AOF_ERROR_002");
  assert.equal(classifyProviderError({ provider: P, status: 401, message: "token has expired" }).code, "AOF_ERROR_003");
  assert.equal(classifyProviderError({ provider: P, status: 401, message: "unauthorized" }).code, "AOF_ERROR_010");
});

test("403 quota → 004, generic → 010", () => {
  assert.equal(classifyProviderError({ provider: P, status: 403, message: "billing quota exceeded" }).code, "AOF_ERROR_004");
  assert.equal(classifyProviderError({ provider: P, status: 403, message: "forbidden" }).code, "AOF_ERROR_010");
});

test("404 → 009 (invalid model)", () => {
  assert.equal(classifyProviderError({ provider: P, status: 404, model: "claude-x" }).code, "AOF_ERROR_009");
});

test("429 rate-limit → 005, quota → 004", () => {
  assert.equal(classifyProviderError({ provider: P, status: 429, message: "too many requests" }).code, "AOF_ERROR_005");
  assert.equal(classifyProviderError({ provider: P, status: 429, message: "monthly quota exceeded" }).code, "AOF_ERROR_004");
});

test("400 with model → 009, otherwise → 012", () => {
  assert.equal(classifyProviderError({ provider: P, status: 400, message: "unknown model foo" }).code, "AOF_ERROR_009");
  assert.equal(classifyProviderError({ provider: P, status: 400, message: "bad request" }).code, "AOF_ERROR_012");
});

test("402 → 004 (out of credit)", () => {
  assert.equal(classifyProviderError({ provider: P, status: 402 }).code, "AOF_ERROR_004");
});

test("5xx → 006 provider unavailable", () => {
  for (const s of [500, 502, 503, 504]) {
    assert.equal(classifyProviderError({ provider: P, status: s }).code, "AOF_ERROR_006");
  }
});

// ── Classification by message/type text ─────────────────────────────────────

test("network error messages → 007", () => {
  assert.equal(classifyProviderError({ provider: P, message: "fetch failed" }).code, "AOF_ERROR_007");
  assert.equal(classifyProviderError({ provider: P, message: "getaddrinfo ENOTFOUND api" }).code, "AOF_ERROR_007");
});

test("timeout messages → 008", () => {
  assert.equal(classifyProviderError({ provider: P, message: "ETIMEDOUT" }).code, "AOF_ERROR_008");
  assert.equal(classifyProviderError({ provider: P, message: "Request aborted: deadline" }).code, "AOF_ERROR_008");
});

test("anthropic error types map correctly", () => {
  assert.equal(classifyProviderError({ provider: P, errorType: "rate_limit_error" }).code, "AOF_ERROR_005");
  assert.equal(classifyProviderError({ provider: P, errorType: "authentication_error" }).code, "AOF_ERROR_002");
  assert.equal(classifyProviderError({ provider: P, errorType: "not_found_error" }).code, "AOF_ERROR_009");
  assert.equal(classifyProviderError({ provider: P, errorType: "insufficient_quota" }).code, "AOF_ERROR_004");
});

test("unrecognized failure → 012", () => {
  assert.equal(classifyProviderError({ provider: P, message: "??? something weird" }).code, "AOF_ERROR_012");
});

// ── Shape + catalog ─────────────────────────────────────────────────────────

test("every classified error carries the canonical fields", () => {
  const e = classifyProviderError({ provider: P, status: 429, model: "m" });
  assert.equal(e.kind, "aof-provider-error");
  assert.ok(e.code && e.problem && e.provider && e.details && e.solution && e.timestamp);
  assert.equal(e.provider, P);
  assert.equal(e.model, "m");
  assert.ok(isAofProviderError(e));
});

test("problem matches the catalog for the code", () => {
  const e = classifyProviderError({ provider: P, status: 500 });
  assert.equal(e.problem, ERROR_CATALOG[e.code as AofErrorCode].problem);
});

// ── Redaction ───────────────────────────────────────────────────────────────

test("redact removes secret-looking strings", () => {
  assert.match(String(redact("key is sk-ant-abcdef123456")), /«redacted»/);
  assert.match(String(redact("Authorization: Bearer abcdef123456")), /«redacted»/);
  assert.doesNotMatch(String(redact("a normal message")), /«redacted»/);
});

test("diagnostic fields are redacted on the error", () => {
  const e = classifyProviderError({ provider: P, status: 401, message: "bad sk-ant-SECRETKEY999 here" });
  assert.doesNotMatch(String(e.rawMessage), /SECRETKEY999/);
});

// ── Display helpers ──────────────────────────────────────────────────────────

test("formatUtc renders YYYY-MM-DD HH:MM:SS UTC", () => {
  assert.equal(formatUtc("2026-06-15T12:42:18.000Z"), "2026-06-15 12:42:18 UTC");
});

test("formatErrorBlock includes code and all fields", () => {
  const e = missingKeyError(P, "ANTHROPIC_API_KEY", "claude");
  const block = formatErrorBlock(e);
  assert.match(block, /AOF_ERROR_001/);
  assert.match(block, /Provider:/);
  assert.match(block, /Problem:/);
  assert.match(block, /Details:/);
  assert.match(block, /Solution:/);
  assert.match(block, /Timestamp:/);
});

// ── Failover ──────────────────────────────────────────────────────────────────

test("failover notice round-trips through the guard", () => {
  const n = makeFailoverNotice("Claude", "OpenRouter", "AOF_ERROR_004 · Quota Exceeded");
  assert.ok(isFailoverNotice(n));
  assert.equal(n.from, "Claude");
  assert.equal(n.to, "OpenRouter");
});

// ── Wire protocol: encode / decode frames ───────────────────────────────────

test("decodeFrames passes normal text through untouched", () => {
  const r = decodeFrames("Hello, this is a normal reply.");
  assert.equal(r.text, "Hello, this is a normal reply.");
  assert.equal(r.errors.length, 0);
  assert.equal(r.remainder, "");
});

test("decodeFrames extracts an error frame and strips it from text", () => {
  const e = classifyProviderError({ provider: P, status: 429 });
  const buffer = "partial answer" + encodeErrorFrame(e);
  const r = decodeFrames(buffer);
  assert.equal(r.text, "partial answer");
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, "AOF_ERROR_005");
});

test("decodeFrames extracts a failover frame", () => {
  const n = makeFailoverNotice("Claude", "OpenRouter", "reason");
  const r = decodeFrames(encodeFailoverFrame(n) + "now answering");
  assert.equal(r.text, "now answering");
  assert.equal(r.failovers.length, 1);
  assert.equal(r.failovers[0].to, "OpenRouter");
});

// Simulate the streaming decode loop: feed the encoded frame split across chunks.
function streamDecode(chunks: string[]) {
  let buffer = "";
  let text = "";
  const errors = [] as ReturnType<typeof decodeFrames>["errors"];
  const failovers = [] as ReturnType<typeof decodeFrames>["failovers"];
  for (const chunk of chunks) {
    buffer += chunk;
    const d = decodeFrames(buffer);
    buffer = d.remainder;
    text += d.text;
    errors.push(...d.errors);
    failovers.push(...d.failovers);
  }
  const fin = decodeFrames(buffer);
  text += fin.text;
  errors.push(...fin.errors);
  failovers.push(...fin.failovers);
  return { text, errors, failovers };
}

test("a frame split across many chunks is still decoded, never leaked as text", () => {
  const e = classifyProviderError({ provider: P, status: 500 });
  const full = "here is some output" + encodeErrorFrame(e);
  // Split into 5-char chunks to stress the boundary handling.
  const chunks: string[] = [];
  for (let i = 0; i < full.length; i += 5) chunks.push(full.slice(i, i + 5));
  const r = streamDecode(chunks);
  assert.equal(r.text, "here is some output");
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, "AOF_ERROR_006");
  // The control delimiter must never appear in the user-visible text.
  assert.doesNotMatch(r.text, /AOF_ERR/);
});

test("failover frame then content, char-by-char, decodes cleanly", () => {
  const n = makeFailoverNotice("Claude", "OpenRouter", "AOF_ERROR_006 · Provider Unavailable");
  const full = encodeFailoverFrame(n) + "Switched and answering now.";
  const chunks = full.split("");
  const r = streamDecode(chunks);
  assert.equal(r.text, "Switched and answering now.");
  assert.equal(r.failovers.length, 1);
});
