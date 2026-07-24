import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openAiUserContent,
  geminiTextStream,
} from "@/lib/server/ai-providers.js";

// ── openAiUserContent (Gemini/DeepSeek/Qwen/Llama/Z.AI/OpenRouter/Ollama/vLLM dialect) ──

test("openAiUserContent returns the plain string when there are no images (unchanged request shape)", () => {
  assert.equal(openAiUserContent("hello", undefined), "hello");
  assert.equal(openAiUserContent("hello", []), "hello");
});

test("openAiUserContent builds a text + image_url content array when images are present", () => {
  const content = openAiUserContent("what is this?", [{ mediaType: "image/png", data: "AAAA" }]);
  assert.ok(Array.isArray(content));
  const arr = content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  assert.equal(arr[0].type, "text");
  assert.equal(arr[0].text, "what is this?");
  assert.equal(arr[1].type, "image_url");
  assert.equal(arr[1].image_url?.url, "data:image/png;base64,AAAA");
});

test("openAiUserContent includes one image_url part per attached image", () => {
  const content = openAiUserContent("compare these", [
    { mediaType: "image/png", data: "AAAA" },
    { mediaType: "image/jpeg", data: "BBBB" },
  ]);
  const arr = content as Array<{ type: string }>;
  assert.equal(arr.length, 3); // text + 2 images
});

// ── End-to-end: an OpenAI-compatible adapter actually sends the image in the request body ──

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

test("geminiTextStream sends the image as an image_url content part in the request body", async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  const prevFetch = globalThis.fetch;
  let sentBody: { messages: Array<{ role: string; content: unknown }> } | undefined;
  try {
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      sentBody = JSON.parse(String(args[1]?.body));
      return sseResponse(["ok"]);
    }) as typeof fetch;

    let out = "";
    for await (const chunk of geminiTextStream({
      system: "s",
      history: [],
      message: "what is in this image?",
      maxTokens: 16,
      temperature: 0.5,
      signal: new AbortController().signal,
      images: [{ mediaType: "image/png", data: "AAAA" }],
    })) {
      out += chunk;
    }
    assert.equal(out, "ok");

    const userMessage = sentBody!.messages.find((m) => m.role === "user")!;
    const content = userMessage.content as Array<{ type: string; image_url?: { url: string } }>;
    assert.ok(Array.isArray(content));
    assert.ok(content.some((p) => p.type === "image_url" && p.image_url?.url === "data:image/png;base64,AAAA"));
  } finally {
    globalThis.fetch = prevFetch;
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
});

test("geminiTextStream sends a plain string user message when there is no image (unchanged shape)", async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  const prevFetch = globalThis.fetch;
  let sentBody: { messages: Array<{ role: string; content: unknown }> } | undefined;
  try {
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      sentBody = JSON.parse(String(args[1]?.body));
      return sseResponse(["ok"]);
    }) as typeof fetch;

    for await (const _ of geminiTextStream({
      system: "s",
      history: [],
      message: "hello",
      maxTokens: 16,
      temperature: 0.5,
      signal: new AbortController().signal,
    })) void _;

    const userMessage = sentBody!.messages.find((m) => m.role === "user")!;
    assert.equal(userMessage.content, "hello");
  } finally {
    globalThis.fetch = prevFetch;
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
});
