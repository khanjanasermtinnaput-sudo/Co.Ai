import { test } from "node:test";
import assert from "node:assert/strict";
import {
  primeAndStream,
  toAofError,
  isAbort,
  ProviderHttpError,
  PROVIDER_REGISTRY,
} from "@/lib/server/ai-providers.js";
import { decodeFrames, encodeFailoverFrame, makeFailoverNotice } from "@/lib/errors.js";

const ctx = { provider: PROVIDER_REGISTRY.anthropic, model: "claude-haiku", requestId: "req_test" };

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

// ── Generators standing in for a provider adapter ───────────────────────────

async function* throwsBeforeToken(): AsyncGenerator<string> {
  throw { status: 401, message: "invalid api key" };
}
// eslint-disable-next-line require-yield
async function* yieldsNothing(): AsyncGenerator<string> {
  return;
}
async function* helloWorld(): AsyncGenerator<string> {
  yield "hello";
  yield " world";
}
async function* yieldThenThrow(): AsyncGenerator<string> {
  yield "partial answer";
  throw { status: 500, message: "upstream exploded" };
}
async function* aborts(): AsyncGenerator<string> {
  throw { name: "APIUserAbortError", message: "aborted" };
}

// ── primeAndStream ──────────────────────────────────────────────────────────

test("failure before the first token → ok:false with a classified error (no stream)", async () => {
  const r = await primeAndStream({ ctx, gen: throwsBeforeToken() });
  assert.equal(r.ok, false);
  assert.equal(r.stream, undefined);
  assert.equal(r.error?.code, "AOF_ERROR_002");
  assert.equal(r.error?.provider, PROVIDER_REGISTRY.anthropic.label);
});

test("provider closes with no content → AOF_ERROR_011 (empty response)", async () => {
  const r = await primeAndStream({ ctx, gen: yieldsNothing() });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "AOF_ERROR_011");
});

test("successful stream replays every token", async () => {
  const r = await primeAndStream({ ctx, gen: helloWorld() });
  assert.equal(r.ok, true);
  const text = await readAll(r.stream!);
  assert.equal(text, "hello world");
});

test("prefix frame (failover) is emitted before the first token", async () => {
  const notice = makeFailoverNotice("Claude (Anthropic)", "OpenRouter", "AOF_ERROR_006");
  const r = await primeAndStream({ ctx, gen: helloWorld(), prefixFrame: encodeFailoverFrame(notice) });
  assert.equal(r.ok, true);
  const decoded = decodeFrames(await readAll(r.stream!));
  assert.equal(decoded.text, "hello world");
  assert.equal(decoded.failovers.length, 1);
  assert.equal(decoded.failovers[0].to, "OpenRouter");
});

test("mid-stream failure after content → in-band error frame, partial text preserved", async () => {
  const r = await primeAndStream({ ctx, gen: yieldThenThrow() });
  assert.equal(r.ok, true); // streaming already started
  const decoded = decodeFrames(await readAll(r.stream!));
  assert.equal(decoded.text, "partial answer");
  assert.equal(decoded.errors.length, 1);
  assert.equal(decoded.errors[0].code, "AOF_ERROR_006");
});

test("user abort while priming → aborted, no error surfaced", async () => {
  const r = await primeAndStream({ ctx, gen: aborts() });
  assert.equal(r.aborted, true);
  assert.equal(r.ok, false);
  assert.equal(r.error, undefined);
});

// ── toAofError / isAbort ────────────────────────────────────────────────────

test("toAofError maps a ProviderHttpError by status", () => {
  assert.equal(toAofError(ctx, new ProviderHttpError(429, "{}", "rate_limit")).code, "AOF_ERROR_005");
  assert.equal(toAofError(ctx, new ProviderHttpError(404, "{}")).code, "AOF_ERROR_009");
  assert.equal(toAofError(ctx, new ProviderHttpError(503, "{}")).code, "AOF_ERROR_006");
});

test("toAofError treats connection-named errors as network", () => {
  const e = toAofError(ctx, { name: "APIConnectionError", message: "connect ECONNREFUSED" });
  assert.equal(e.code, "AOF_ERROR_007");
});

test("isAbort detects user/SDK aborts only", () => {
  assert.equal(isAbort({ name: "AbortError" }), true);
  assert.equal(isAbort({ name: "APIUserAbortError" }), true);
  assert.equal(isAbort(new Error("nope")), false);
});
