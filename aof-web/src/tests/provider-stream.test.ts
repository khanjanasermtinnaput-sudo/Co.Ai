import { test } from "node:test";
import assert from "node:assert/strict";
import {
  primeAndStream,
  toAofError,
  isAbort,
  openrouterTextStream,
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

// ── OpenRouter transient-error retry ────────────────────────────────────────

function sseResponse(tokens: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const t of tokens) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("openrouter retries a transient 503, then streams the recovered response", async () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls < 3) return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    return sseResponse(["hello", " world"]);
  }) as typeof fetch;

  try {
    const input = {
      system: "s",
      history: [],
      message: "hi",
      maxTokens: 16,
      temperature: 0.5,
      signal: new AbortController().signal,
    };
    let out = "";
    for await (const chunk of openrouterTextStream(input)) out += chunk;
    assert.equal(out, "hello world");
    assert.equal(calls, 3); // two transient failures + one success
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
  }
});

test("openrouter gives up after exhausting retries and throws the upstream status", async () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "still down" } }), { status: 502 });
  }) as typeof fetch;

  try {
    const input = {
      system: "s",
      history: [],
      message: "hi",
      maxTokens: 16,
      temperature: 0.5,
      signal: new AbortController().signal,
    };
    await assert.rejects(
      (async () => {
        for await (const _ of openrouterTextStream(input)) void _;
      })(),
      (err: unknown) => err instanceof ProviderHttpError && err.status === 502,
    );
    assert.equal(calls, 3); // capped at OPENROUTER_MAX_ATTEMPTS
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
  }
});
