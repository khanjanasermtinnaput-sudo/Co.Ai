// ── buffered-call.ts — the one buffered (non-streamed) provider call (no network) ──
// Mirrors phase-stream.test.ts / provider-stream.test.ts's fake-generator
// pattern: no real provider is ever touched. Locks in: real usage/attempts
// passthrough, the same failover policy route.ts's streamed loop uses, that
// it never throws (returns a failure object instead — Master Prompt 5.3:
// "never terminate the workflow unexpectedly"), and that a deadline or an
// abort both resolve promptly rather than hanging.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runBufferedCall } from "../lib/server/buffered-call";
import type { ProviderMeta, AdapterInput, ProviderId } from "../lib/server/ai-providers";
import { makeUsageNotice, type UsageNotice } from "../lib/errors";

function meta(id: ProviderId, label: string): ProviderMeta {
  return {
    id,
    label,
    envVar: `${id.toUpperCase()}_API_KEY`,
    modelEnv: `${id.toUpperCase()}_MODEL`,
    defaultModel: `${id}-default`,
    priority: 1,
  };
}

const PROVIDER_A = meta("deepseek", "Provider A");
const PROVIDER_B = meta("gemini", "Provider B");

async function* okGen(chunks: string[], usage: UsageNotice): AsyncGenerator<string, UsageNotice | undefined> {
  for (const c of chunks) yield c;
  return usage;
}
// eslint-disable-next-line require-yield
async function* throwsImmediately(err: unknown): AsyncGenerator<string, UsageNotice | undefined> {
  throw err;
}
async function* neverResolves(): AsyncGenerator<string, UsageNotice | undefined> {
  await new Promise(() => {}); // hangs forever — only a deadline/abort can end this
  yield "unreachable";
  return undefined;
}
async function* slowThenYields(ms: number): AsyncGenerator<string, UsageNotice | undefined> {
  await new Promise((r) => setTimeout(r, ms));
  yield "late";
  return undefined;
}

function baseOpts(overrides: Partial<Parameters<typeof runBufferedCall>[0]> = {}) {
  return {
    providers: [PROVIDER_A],
    system: "SYSTEM",
    message: "analyze this",
    history: [],
    maxTokens: 900,
    temperature: 0.3,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("happy path: concatenates chunks, passes real usage through, attempts=1", async () => {
  const usage = makeUsageNotice(50, 20);
  const result = await runBufferedCall(
    baseOpts({
      adapterLookup: () => () => okGen(["Hello ", "world"], usage),
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, "Hello world");
  assert.deepEqual(result.usage, usage);
  assert.equal(result.provider.id, "deepseek");
  assert.equal(result.attempts, 1);
});

test("a failover-worthy error on provider #1 falls over to provider #2", async () => {
  const usage = makeUsageNotice(10, 10);
  const result = await runBufferedCall(
    baseOpts({
      providers: [PROVIDER_A, PROVIDER_B],
      adapterLookup: (id: ProviderId) => (_input: AdapterInput) =>
        id === "deepseek" ? throwsImmediately({ status: 500, message: "overloaded" }) : okGen(["ok"], usage),
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.id, "gemini");
  assert.equal(result.attempts, 2);
});

test("all providers fail → ok:false with a classified error, never throws", async () => {
  await assert.doesNotReject(
    runBufferedCall(
      baseOpts({
        providers: [PROVIDER_A, PROVIDER_B],
        adapterLookup: () => () => throwsImmediately({ status: 500, message: "overloaded" }),
      }),
    ),
  );
  const result = await runBufferedCall(
    baseOpts({
      providers: [PROVIDER_A, PROVIDER_B],
      adapterLookup: () => () => throwsImmediately({ status: 503, message: "still down" }),
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.aborted, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.error.kind, "coagentix-provider-error");
});

test("deadline exceeded → ok:false, does not hang", async () => {
  const result = await runBufferedCall(
    baseOpts({
      deadlineMs: 20,
      adapterLookup: () => () => slowThenYields(500),
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.aborted, false);
});

test("abort mid-drain → ok:false, aborted:true", async () => {
  const controller = new AbortController();
  const promise = runBufferedCall(
    baseOpts({
      signal: controller.signal,
      adapterLookup: () => () => neverResolves(),
    }),
  );
  setTimeout(() => controller.abort(), 10);
  const result = await promise;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.aborted, true);
});
