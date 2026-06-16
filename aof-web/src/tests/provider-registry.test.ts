import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_REGISTRY,
  apiKeyFor,
  adapterFor,
  configuredProvidersForOrder,
  geminiTextStream,
  deepseekTextStream,
  qwenTextStream,
  llamaTextStream,
} from "@/lib/server/ai-providers.js";
import { bestModelFor, routeOrder } from "@/lib/server/model-registry.js";

// ── Registry shape ──────────────────────────────────────────────────────────

test("all six providers are registered", () => {
  const ids = Object.keys(PROVIDER_REGISTRY).sort();
  assert.deepEqual(ids, ["anthropic", "deepseek", "gemini", "llama", "openrouter", "qwen"]);
});

test("adapterFor returns a distinct generator function per provider", () => {
  const fns = new Set(Object.keys(PROVIDER_REGISTRY).map((id) => adapterFor(id as never)));
  assert.equal(fns.size, 6);
});

// ── Key overrides (per-user keys beat env) ──────────────────────────────────

test("a user-saved key overrides the server env var", () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "env-key";
  try {
    assert.equal(apiKeyFor(PROVIDER_REGISTRY.gemini), "env-key");
    assert.equal(apiKeyFor(PROVIDER_REGISTRY.gemini, { gemini: "user-key" }), "user-key");
  } finally {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
});

test("configuredProvidersForOrder only returns providers with a key, in the given order", () => {
  const prev = { gemini: process.env.GEMINI_API_KEY, deepseek: process.env.DEEPSEEK_API_KEY };
  delete process.env.GEMINI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = configuredProvidersForOrder(["gemini", "deepseek", "qwen"], { deepseek: "k" });
    assert.deepEqual(result.map((p) => p.id), ["deepseek"]);
  } finally {
    if (prev.gemini !== undefined) process.env.GEMINI_API_KEY = prev.gemini;
    if (prev.deepseek !== undefined) process.env.DEEPSEEK_API_KEY = prev.deepseek;
  }
});

// ── Model registry routing ───────────────────────────────────────────────────

test("chat task prioritizes Gemini, then Claude, then DeepSeek/Qwen/Llama, then OpenRouter", () => {
  assert.deepEqual(routeOrder("chat"), ["gemini", "anthropic", "deepseek", "qwen", "llama", "openrouter"]);
});

test("coding task prioritizes Claude, then DeepSeek, then Qwen Coder, then Gemini", () => {
  assert.deepEqual(routeOrder("coding"), ["anthropic", "deepseek", "qwen", "gemini", "openrouter"]);
  assert.equal(bestModelFor("qwen", "coding"), "qwen-coder");
});

test("reasoning/research tasks prefer Gemini Pro-capable models", () => {
  assert.equal(bestModelFor("gemini", "reasoning"), "gemini-2.5-pro");
  assert.equal(bestModelFor("deepseek", "reasoning"), "deepseek-reasoner");
});

// ── New OpenAI-compatible adapters stream correctly ─────────────────────────

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

const BASE_INPUT = {
  system: "s",
  history: [],
  message: "hi",
  maxTokens: 16,
  temperature: 0.5,
  signal: new AbortController().signal,
};

async function withStubFetch(fetchImpl: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await fn();
  } finally {
    globalThis.fetch = prevFetch;
  }
}

const NEW_ADAPTERS = [
  { name: "gemini", envVar: "GEMINI_API_KEY", stream: geminiTextStream },
  { name: "deepseek", envVar: "DEEPSEEK_API_KEY", stream: deepseekTextStream },
  { name: "qwen", envVar: "QWEN_API_KEY", stream: qwenTextStream },
  { name: "llama", envVar: "LLAMA_API_KEY", stream: llamaTextStream },
] as const;

for (const { name, envVar, stream } of NEW_ADAPTERS) {
  test(`${name} adapter streams tokens from an OpenAI-compatible SSE response`, async () => {
    const prev = process.env[envVar];
    process.env[envVar] = "test-key";
    try {
      await withStubFetch(
        (async () => sseResponse(["hello", " world"])) as typeof fetch,
        async () => {
          let out = "";
          for await (const chunk of stream(BASE_INPUT)) out += chunk;
          assert.equal(out, "hello world");
        },
      );
    } finally {
      if (prev === undefined) delete process.env[envVar];
      else process.env[envVar] = prev;
    }
  });
}
