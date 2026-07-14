// ── execution-plan.test.ts — TMAP's parser, NEVER throws, NEVER fabricates ──

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExecutionPlan, buildExecutionOrder, type PlannedTask } from "../lib/server/execution-plan";

const OPEN = "===COAI EXECUTION PLAN===";
const CLOSE = "===END PLAN===";

function block(body: string): string {
  return `${OPEN}\n${body}\n${CLOSE}`;
}

test("happy path: a well-formed single-task plan parses cleanly", () => {
  const text = block(
    [
      "Strategy: build it directly",
      "Tasks:",
      "- TASK-001 | title: Build the thing | agent: backend | depends: none | priority: high | complexity: medium | desc: do the work | output: an endpoint | validation: manual test | success: it works",
      "Risks:",
      "- scope creep | impact: Low | likelihood: Medium | mitigation: keep it small",
      "Plan Confidence: 80%",
    ].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.partial, false);
  assert.equal(plan.integrity, "ok");
  assert.equal(plan.strategy, "build it directly");
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].id, "TASK-001");
  assert.equal(plan.tasks[0].agent, "backend");
  assert.equal(plan.tasks[0].priority, "high");
  assert.equal(plan.tasks[0].complexity, "medium");
  assert.equal(plan.planConfidence, 80);
  assert.equal(plan.risks.length, 1);
  assert.deepEqual(plan.executionOrder, [["TASK-001"]]);
});

test("no block at all → empty/partial, never throws, never a synthesized task", () => {
  const plan = parseExecutionPlan("just some unrelated text with no markers");
  assert.equal(plan.integrity, "empty");
  assert.equal(plan.partial, true);
  assert.deepEqual(plan.tasks, []);
  assert.deepEqual(plan.executionOrder, []);
});

test("no closing marker → parses what's there, marked partial", () => {
  const text = `${OPEN}\nStrategy: partial run\nTasks:\n- TASK-001 | title: X | agent: general | depends: none\nRisks:\n`;
  const plan = parseExecutionPlan(text);
  assert.equal(plan.partial, true);
  assert.equal(plan.tasks.length, 1);
});

test("never throws on empty string, garbage, or huge input", () => {
  assert.doesNotThrow(() => parseExecutionPlan(""));
  assert.doesNotThrow(() => parseExecutionPlan("🎉".repeat(5000)));
  assert.doesNotThrow(() => parseExecutionPlan(block("Tasks:\n- | | | garbage | | |")));
  assert.doesNotThrow(() => parseExecutionPlan(block("")));
});

test("unknown agent id falls back to general, tags source, warns — task still runs", () => {
  const text = block(
    ["Strategy: s", "Tasks:", "- TASK-001 | title: X | agent: devops | depends: none", "Risks:"].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].agent, "general");
  assert.equal(plan.tasks[0].agentSource, "fallback");
  const warning = plan.warnings.find((w) => w.kind === "unknown-agent");
  assert.ok(warning);
  assert.equal(warning?.taskId, "TASK-001");
  assert.match(warning?.detail ?? "", /devops/);
});

test("dependency on a nonexistent task: the EDGE is dropped, the task survives, warned", () => {
  const text = block(
    ["Strategy: s", "Tasks:", "- TASK-001 | title: X | agent: backend | depends: TASK-999", "Risks:"].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.tasks.length, 1);
  assert.deepEqual(plan.tasks[0].dependsOn, []);
  const warning = plan.warnings.find((w) => w.kind === "dangling-dependency");
  assert.ok(warning);
  assert.equal(plan.integrity, "ok");
});

test("self-dependency: the edge is dropped, warned", () => {
  const text = block(
    ["Strategy: s", "Tasks:", "- TASK-001 | title: X | agent: backend | depends: TASK-001", "Risks:"].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.deepEqual(plan.tasks[0].dependsOn, []);
  assert.ok(plan.warnings.some((w) => w.kind === "self-dependency"));
});

test("duplicate task id: first wins, later dropped, warned", () => {
  const text = block(
    [
      "Strategy: s",
      "Tasks:",
      "- TASK-001 | title: First | agent: backend | depends: none",
      "- TASK-001 | title: Second | agent: frontend | depends: none",
      "Risks:",
    ].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].title, "First");
  assert.ok(plan.warnings.some((w) => w.kind === "duplicate-task-id"));
});

test("a garbage task line is dropped and warned; siblings survive", () => {
  const text = block(
    [
      "Strategy: s",
      "Tasks:",
      "- not a valid task line at all",
      "- TASK-001 | title: Real one | agent: backend | depends: none",
      "Risks:",
    ].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].id, "TASK-001");
  assert.ok(plan.warnings.some((w) => w.kind === "unparsable-task-line"));
});

test("omitted priority/complexity/planConfidence are null — never a fabricated default", () => {
  const text = block(
    ["Strategy: s", "Tasks:", "- TASK-001 | title: X | agent: backend | depends: none", "Risks:"].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.tasks[0].priority, null);
  assert.equal(plan.tasks[0].complexity, null);
  assert.equal(plan.planConfidence, null);
});

test("id normalization: TASK-1, task_01, and TASK-001 all normalize the same way", () => {
  const text = block(["Strategy: s", "Tasks:", "- TASK-1 | title: X | agent: backend | depends: none", "Risks:"].join("\n"));
  const plan = parseExecutionPlan(text);
  assert.equal(plan.tasks[0].id, "TASK-001");
});

test("a dependency cycle: integrity=cycle, executionOrder=[], cycleTasks populated, orchestration should not run", () => {
  const text = block(
    [
      "Strategy: s",
      "Tasks:",
      "- TASK-001 | title: A | agent: backend | depends: TASK-002",
      "- TASK-002 | title: B | agent: backend | depends: TASK-001",
      "Risks:",
    ].join("\n"),
  );
  const plan = parseExecutionPlan(text);
  assert.equal(plan.integrity, "cycle");
  assert.deepEqual(plan.executionOrder, []);
  assert.deepEqual([...plan.cycleTasks].sort(), ["TASK-001", "TASK-002"]);
});

test("diamond DAG: buildExecutionOrder produces 3 waves in the expected shape", () => {
  const tasks: PlannedTask[] = [
    mkTask("TASK-001", []),
    mkTask("TASK-002", ["TASK-001"]),
    mkTask("TASK-003", ["TASK-001"]),
    mkTask("TASK-004", ["TASK-002", "TASK-003"]),
  ];
  const { order, integrity, cycleTasks } = buildExecutionOrder(tasks);
  assert.equal(integrity, "ok");
  assert.deepEqual(cycleTasks, []);
  assert.deepEqual(order, [["TASK-001"], ["TASK-002", "TASK-003"], ["TASK-004"]]);
});

test("buildExecutionOrder on zero tasks returns integrity:empty", () => {
  const { order, integrity } = buildExecutionOrder([]);
  assert.deepEqual(order, []);
  assert.equal(integrity, "empty");
});

function mkTask(id: string, dependsOn: string[]): PlannedTask {
  return {
    id,
    title: id,
    description: "",
    agent: "general",
    agentSource: "fallback",
    dependsOn,
    priority: null,
    complexity: null,
    expectedOutput: "",
    validationMethod: "",
    successCriteria: "",
  };
}
