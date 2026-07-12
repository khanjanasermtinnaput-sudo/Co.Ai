// ── workflow-runner.ts — interior stage sequencing (no network) ──────────────
// Mirrors provider-stream.test.ts's fake-generator pattern: adapterLookup is
// injected so these tests never touch a real provider, only stand-in
// AsyncGenerators standing in for an adapter's stream.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInteriorStages } from "../lib/server/workflow-runner";
import { PROVIDER_REGISTRY, type AdapterInput } from "../lib/server/ai-providers";
import { makeUsageNotice, type StageNotice } from "../lib/errors";
import type { WorkflowStageSpec } from "../lib/server/model-workflow";

const provider = PROVIDER_REGISTRY.anthropic;

function stubStage(stage: WorkflowStageSpec["stage"], label: string): WorkflowStageSpec {
  return {
    stage,
    label,
    final: false,
    baseMaxTokens: 100,
    temperature: 0.5,
    buildSystem: (ctx) =>
      [ctx.baseSystem, ...ctx.priorOutputs.map((o) => `<${o.stage}>${o.text}</${o.stage}>`)].join("\n"),
  };
}

const finalStub: WorkflowStageSpec = {
  stage: "review",
  label: "Review",
  final: true,
  baseMaxTokens: 100,
  temperature: 0.5,
  buildSystem: (ctx) =>
    [ctx.baseSystem, ...ctx.priorOutputs.map((o) => `<${o.stage}>${o.text}</${o.stage}>`)].join("\n"),
};

async function* textThenUsage(text: string): AsyncGenerator<string> {
  yield text;
  return makeUsageNotice(10, 20);
}

// eslint-disable-next-line require-yield
async function* throwsImmediately(): AsyncGenerator<string> {
  throw new Error("stage provider exploded");
}

function baseOpts(overrides: Partial<Parameters<typeof runInteriorStages>[0]> = {}) {
  return {
    stages: [stubStage("context-builder", "Context Builder"), stubStage("processing", "Processing")],
    finalStage: finalStub,
    totalStages: 3,
    provider,
    overrides: {},
    baseSystem: "BASE",
    message: "hello",
    history: [],
    effort: "normal" as const,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("stage-2's captured system contains stage-1's output", async () => {
  const captured: string[] = [];
  const outcome = await runInteriorStages(
    baseOpts({
      adapterLookup: () => (input: AdapterInput) => {
        captured.push(input.system);
        return input.system.includes("Context Builder output")
          ? textThenUsage("draft using context")
          : textThenUsage("Context Builder output: relevant fact");
      },
    }),
  );

  assert.equal(captured.length, 2);
  assert.doesNotMatch(captured[0], /relevant fact/); // stage 1 sees nothing prior
  assert.match(captured[1], /Context Builder output: relevant fact/); // stage 2 sees stage 1's output
  assert.match(outcome.system, /draft using context/); // final stage's system folds in both
  assert.equal(outcome.results.length, 2);
  assert.equal(outcome.results[0].usage?.inputTokens, 10);
});

test("a mid-stage throw propagates — no result is ever returned", async () => {
  let calls = 0;
  await assert.rejects(
    runInteriorStages(
      baseOpts({
        adapterLookup: () => () => {
          calls += 1;
          return calls === 1 ? textThenUsage("stage 1 ok") : throwsImmediately();
        },
      }),
    ),
    /stage provider exploded/,
  );
  assert.equal(calls, 2); // stage 1 ran, stage 2 threw — no stage 3 (there is none to run anyway)
});

test("onStage fires running then done, in index order, for every interior stage", async () => {
  const events: StageNotice[] = [];
  await runInteriorStages(
    baseOpts({
      onStage: (n) => events.push(n),
      adapterLookup: () => () => textThenUsage("ok"),
    }),
  );

  assert.deepEqual(
    events.map((e) => [e.stage, e.status, e.index, e.total]),
    [
      ["context-builder", "running", 1, 3],
      ["context-builder", "done", 1, 3],
      ["processing", "running", 2, 3],
      ["processing", "done", 2, 3],
    ],
  );
});

test("an empty interior stage list still resolves the final stage's system with no prior outputs", async () => {
  const outcome = await runInteriorStages(baseOpts({ stages: [] }));
  assert.equal(outcome.results.length, 0);
  assert.equal(outcome.system, "BASE");
});
