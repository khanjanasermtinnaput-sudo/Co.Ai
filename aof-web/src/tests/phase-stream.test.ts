// ── phase-stream.ts — splitting one provider generation into phases (no network) ──
// Mirrors provider-stream.test.ts's fake-generator pattern: no real provider is
// ever touched, only stand-in AsyncGenerators. The single most important
// property under test is the one Co.AI Master Prompt Part 4 depends on:
// phaseStream must never yield anything before the wrapped generator's first
// non-empty chunk, or primeAndStream's failover guarantee silently breaks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseStream, type PhaseSummary } from "../lib/server/phase-stream";
import { primeAndStream, PROVIDER_REGISTRY } from "../lib/server/ai-providers";
import { decodeFrames, makeUsageNotice, type UsageNotice } from "../lib/errors";
import type { WorkflowStageSpec } from "../lib/server/model-workflow";

const processing: WorkflowStageSpec = {
  stage: "processing",
  label: "Processing",
  execution: "phase",
  final: false,
  baseMaxTokens: 600,
  instruction: "",
};
const deepThink: WorkflowStageSpec = {
  stage: "deep-think",
  label: "Deep Think",
  execution: "phase",
  final: false,
  baseMaxTokens: 500,
  instruction: "",
};
const review: WorkflowStageSpec = {
  stage: "review",
  label: "Review",
  execution: "phase",
  final: true,
  baseMaxTokens: 1200,
  instruction: "",
};
const LOW_PHASES = [processing, review];
const HIGH_PHASES = [processing, deepThink, review];

function opts(phases: WorkflowStageSpec[], onComplete: (s: PhaseSummary) => void = () => {}) {
  return {
    phases,
    stageOffset: 1,
    totalStages: phases.length,
    errorCtx: { providerLabel: "Test Provider", model: "test-model", requestId: "req_test" },
    onComplete,
  };
}

async function* gen(...chunks: string[]): AsyncGenerator<string, UsageNotice | undefined> {
  for (const c of chunks) yield c;
  return undefined;
}
async function* genWithUsage(chunks: string[], usage: UsageNotice): AsyncGenerator<string, UsageNotice | undefined> {
  for (const c of chunks) yield c;
  return usage;
}
// eslint-disable-next-line require-yield
async function* throwsImmediately(err: unknown): AsyncGenerator<string, UsageNotice | undefined> {
  throw err;
}
async function* throwsAfter(chunks: string[], err: unknown): AsyncGenerator<string, UsageNotice | undefined> {
  for (const c of chunks) yield c;
  throw err;
}
// eslint-disable-next-line require-yield
async function* yieldsNothing(): AsyncGenerator<string, UsageNotice | undefined> {
  return undefined;
}

async function collectDecoded(g: AsyncGenerator<string, UsageNotice | undefined>) {
  let raw = "";
  let usage: UsageNotice | undefined;
  for (;;) {
    const next = await g.next();
    if (next.done) {
      usage = next.value;
      break;
    }
    raw += next.value;
  }
  return { ...decodeFrames(raw), usage };
}

test("High happy path: only FINAL text streams, stage frames fire in order, every phase executed", async () => {
  let summary: PhaseSummary | undefined;
  const src = gen(
    "<<<COAI_DRAFT>>>\n",
    "draft text\n",
    "<<<COAI_DEEPTHINK>>>\n",
    "critique text\n",
    "<<<COAI_FINAL>>>\n",
    "final answer",
  );
  const out = await collectDecoded(phaseStream(src, opts(HIGH_PHASES, (s) => (summary = s))));

  assert.equal(out.text, "final answer");
  assert.ok(!out.text.includes("draft text"));
  assert.ok(!out.text.includes("critique text"));
  assert.deepEqual(
    out.stages.map((s) => [s.stage, s.status]),
    [
      ["processing", "running"],
      ["processing", "done"],
      ["deep-think", "running"],
      ["deep-think", "done"],
      ["review", "running"],
    ],
  );
  assert.ok(summary);
  assert.ok(summary!.phases.every((p) => p.executed));
  assert.equal(summary!.fallback, undefined);
});

test("a <<<COAI_FINAL>>> marker split across chunks at every offset never leaks a fragment", async () => {
  const marker = "<<<COAI_FINAL>>>";
  for (let i = 1; i < marker.length; i++) {
    const src = gen("<<<COAI_DRAFT>>>\ndraft\n" + marker.slice(0, i), marker.slice(i) + "\nfinal answer");
    const out = await collectDecoded(phaseStream(src, opts(LOW_PHASES)));
    assert.equal(out.text, "final answer", `split at offset ${i}`);
    assert.ok(!out.text.includes("<"), `no marker fragment leaked at offset ${i}`);
  }
});

test("no FINAL marker → the draft is flushed as the fallback answer", async () => {
  let summary: PhaseSummary | undefined;
  const src = gen("<<<COAI_DRAFT>>>\n", "draft only, no final marker ever comes");
  const out = await collectDecoded(phaseStream(src, opts(LOW_PHASES, (s) => (summary = s))));

  assert.equal(out.text, "draft only, no final marker ever comes");
  assert.equal(summary?.fallback, "no-final-marker");
  assert.equal(summary!.phases.find((p) => p.stage === "review")!.executed, false);
  assert.equal(summary!.phases.find((p) => p.stage === "processing")!.executed, true);
});

test("no markers at all → the whole output is flushed as the answer (model ignored the protocol)", async () => {
  let summary: PhaseSummary | undefined;
  const src = gen("Sure! ", "Paris is the capital of France.");
  const out = await collectDecoded(phaseStream(src, opts(LOW_PHASES, (s) => (summary = s))));

  assert.equal(out.text, "Sure! Paris is the capital of France.");
  assert.equal(summary?.fallback, "no-final-marker");
  assert.ok(summary!.phases.every((p) => !p.executed));
});

test("provider throws before the first chunk → propagates untouched, onComplete never fires, failover preserved", async () => {
  let called = false;
  const wrapped = phaseStream(
    throwsImmediately({ status: 401, message: "invalid api key" }),
    opts(LOW_PHASES, () => (called = true)),
  );
  const ctx = { provider: PROVIDER_REGISTRY.gemini, model: "test-model", requestId: "req_test" };
  const result = await primeAndStream({ ctx, gen: wrapped });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "AOF_ERROR_002");
  assert.equal(called, false);
});

test("provider yields nothing → phaseStream yields nothing → AOF_ERROR_011 via primeAndStream", async () => {
  const wrapped = phaseStream(yieldsNothing(), opts(LOW_PHASES));
  const ctx = { provider: PROVIDER_REGISTRY.gemini, model: "test-model", requestId: "req_test" };
  const result = await primeAndStream({ ctx, gen: wrapped });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "AOF_ERROR_011");
});

test("provider throws mid-draft (after emitting content) → the throw propagates and onComplete fires exactly once", async () => {
  let calls = 0;
  const wrapped = phaseStream(
    throwsAfter(["<<<COAI_DRAFT>>>\n", "partial draft "], new Error("mid-stream boom")),
    opts(LOW_PHASES, () => (calls += 1)),
  );
  await assert.rejects(async () => {
    for await (const _chunk of wrapped) void _chunk;
  }, /mid-stream boom/);
  assert.equal(calls, 1);
});

test("the provider's UsageNotice passes through phaseStream unchanged", async () => {
  const usage = makeUsageNotice(42, 7);
  let summary: PhaseSummary | undefined;
  const src = genWithUsage(["<<<COAI_DRAFT>>>\nd\n<<<COAI_FINAL>>>\nanswer"], usage);
  const out = await collectDecoded(phaseStream(src, opts(LOW_PHASES, (s) => (summary = s))));

  assert.equal(out.text, "answer");
  assert.deepEqual(out.usage, usage);
  assert.deepEqual(summary?.usage, usage);
});

test("an inline (non-line-start) marker occurrence does not trigger a transition", async () => {
  const src = gen(
    "<<<COAI_DRAFT>>>\n",
    "the docs mention <<<COAI_FINAL>>> inline, not at line start\n<<<COAI_FINAL>>>\nreal final",
  );
  const out = await collectDecoded(phaseStream(src, opts(LOW_PHASES)));
  assert.equal(out.text, "real final");
});

test("a <<<COAI_DEEPTHINK>>> marker in a Low workflow (stage absent from phases) is treated as literal text", async () => {
  let summary: PhaseSummary | undefined;
  const src = gen("<<<COAI_DRAFT>>>\n", "draft with <<<COAI_DEEPTHINK>>> mentioned\n<<<COAI_FINAL>>>\nfinal");
  const out = await collectDecoded(phaseStream(src, opts(LOW_PHASES, (s) => (summary = s))));

  assert.equal(out.text, "final");
  assert.ok(summary!.phases.find((p) => p.stage === "processing")!.chars > 0);
});

test("phaseStream's first result does not resolve until the underlying provider yields its first chunk", async () => {
  let providerYielded = false;
  async function* slowProvider(): AsyncGenerator<string, UsageNotice | undefined> {
    await new Promise((r) => setTimeout(r, 20));
    providerYielded = true;
    yield "<<<COAI_DRAFT>>>\nx\n<<<COAI_FINAL>>>\nanswer";
    return undefined;
  }
  const wrapped = phaseStream(slowProvider(), opts(LOW_PHASES));
  const first = await wrapped.next();
  assert.equal(providerYielded, true, "provider must have yielded before phaseStream's first result resolves");
  assert.equal(first.done, false);
  assert.ok((first.value as string).length > 0);
});

test("a model that jumps straight to FINAL (skipping DEEPTHINK) still transitions correctly", async () => {
  let summary: PhaseSummary | undefined;
  const src = gen("<<<COAI_DRAFT>>>\n", "draft\n", "<<<COAI_FINAL>>>\n", "final answer");
  const out = await collectDecoded(phaseStream(src, opts(HIGH_PHASES, (s) => (summary = s))));

  assert.equal(out.text, "final answer");
  assert.equal(summary!.phases.find((p) => p.stage === "deep-think")!.executed, false);
  assert.equal(summary!.phases.find((p) => p.stage === "processing")!.executed, true);
  assert.equal(summary!.phases.find((p) => p.stage === "review")!.executed, true);
});
