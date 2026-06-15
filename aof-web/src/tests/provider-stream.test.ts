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

// ── OpenRouter transient retry + free-model fallback ────────────────────────

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

const ORTEST_INPUT = {
  system: "s",
  history: [],
  message: "hi",
  maxTokens: 16,
  temperature: 0.5,
  signal: new AbortController().signal,
};

/** A 200 stream that never emits a token (and errors when its signal aborts). */
function hangingResponse(signal?: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      signal?.addEventListener(
        "abort",
        () => {
          try {
            c.error(new DOMException("Aborted", "AbortError"));
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Run `fn` with OpenRouter env + global fetch stubbed, then restore everything. */
async function withOpenRouter(
  env: { model?: string; models?: string; firstToken?: string },
  fetchImpl: typeof fetch,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = {
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
    models: process.env.OPENROUTER_MODELS,
    firstToken: process.env.OPENROUTER_FIRST_TOKEN_MS,
    fetch: globalThis.fetch,
  };
  const set = (k: string, v: string | undefined) =>
    v === undefined ? delete process.env[k] : (process.env[k] = v);
  process.env.OPENROUTER_API_KEY = "test-key";
  set("OPENROUTER_MODEL", env.model);
  set("OPENROUTER_MODELS", env.models);
  set("OPENROUTER_FIRST_TOKEN_MS", env.firstToken);
  globalThis.fetch = fetchImpl;
  try {
    await fn();
  } finally {
    set("OPENROUTER_API_KEY", prev.key);
    set("OPENROUTER_MODEL", prev.model);
    set("OPENROUTER_MODELS", prev.models);
    set("OPENROUTER_FIRST_TOKEN_MS", prev.firstToken);
    globalThis.fetch = prev.fetch;
  }
}

test("a single configured model retries a transient 503, then streams", async () => {
  let calls = 0;
  await withOpenRouter({ model: "test/solo", models: "test/solo" }, async () => {
    calls += 1;
    if (calls < 3) return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    return sseResponse(["hello", " world"]);
  }, async () => {
    let out = "";
    for await (const chunk of openrouterTextStream(ORTEST_INPUT)) out += chunk;
    assert.equal(out, "hello world");
    assert.equal(calls, 3); // two transient failures + one success on the same model
  });
});

test("an overloaded model falls through to the next free model", async () => {
  let calls = 0;
  await withOpenRouter({ model: "test/m1", models: "test/m1,test/m2" }, async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
    return sseResponse(["ok"]);
  }, async () => {
    let out = "";
    for await (const chunk of openrouterTextStream(ORTEST_INPUT)) out += chunk;
    assert.equal(out, "ok");
    assert.equal(calls, 2); // m1 failed once, m2 answered — one attempt per model
  });
});

test("exhausting the whole model chain throws the last upstream status", async () => {
  let calls = 0;
  await withOpenRouter({ model: "test/m1", models: "test/m1,test/m2,test/m3" }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "down" } }), { status: 502 });
  }, async () => {
    await assert.rejects(
      (async () => {
        for await (const _ of openrouterTextStream(ORTEST_INPUT)) void _;
      })(),
      (err: unknown) => err instanceof ProviderHttpError && err.status === 502,
    );
    assert.equal(calls, 3); // one attempt for each of the three models
  });
});

test("a model slow to send its first token times out and falls through", async () => {
  let calls = 0;
  await withOpenRouter(
    { model: "test/m1", models: "test/m1,test/m2", firstToken: "40" },
    (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      const init = args[1];
      if (calls === 1) return hangingResponse(init?.signal ?? undefined); // never sends a token
      return sseResponse(["ok"]);
    }) as typeof fetch,
    async () => {
      let out = "";
      for await (const chunk of openrouterTextStream(ORTEST_INPUT)) out += chunk;
      assert.equal(out, "ok");
      assert.equal(calls, 2); // m1 timed out, m2 answered
    },
  );
});

test("a fatal 401 stops immediately without trying other models", async () => {
  let calls = 0;
  await withOpenRouter({ model: "test/m1", models: "test/m1,test/m2" }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "no auth" } }), { status: 401 });
  }, async () => {
    await assert.rejects(
      (async () => {
        for await (const _ of openrouterTextStream(ORTEST_INPUT)) void _;
      })(),
      (err: unknown) => err instanceof ProviderHttpError && err.status === 401,
    );
    assert.equal(calls, 1); // auth failure is not retried across models
  });
});
