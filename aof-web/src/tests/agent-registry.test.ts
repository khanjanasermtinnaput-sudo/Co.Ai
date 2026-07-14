// ── agent-registry.test.ts ───────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_IDS,
  AGENT_REGISTRY,
  resolveAgent,
  agentRosterForPrompt,
  buildAgentSystem,
  agentProviderOrder,
  type AgentId,
} from "../lib/server/agent-registry";
import { routeOrder } from "../lib/server/model-registry";

test("every AgentId in AGENT_IDS has a matching AGENT_REGISTRY entry", () => {
  for (const id of AGENT_IDS) {
    const def = AGENT_REGISTRY[id];
    assert.ok(def, `missing registry entry for ${id}`);
    assert.equal(def.id, id);
  }
  assert.equal(AGENT_IDS.length, Object.keys(AGENT_REGISTRY).length);
});

test("resolveAgent never throws and never returns an id outside AGENT_IDS", () => {
  const inputs = [undefined, "", "   ", "architect", "ARCHITECT", "db", "made-up-agent", "🎉", "  frontend  "];
  for (const raw of inputs) {
    const result = resolveAgent(raw);
    assert.ok((AGENT_IDS as string[]).includes(result.id), `resolveAgent(${JSON.stringify(raw)}) returned ${result.id}`);
  }
});

test("unknown, empty, and whitespace-only input resolves to general/fallback", () => {
  for (const raw of [undefined, "", "   ", "devops", "not-a-real-agent"]) {
    const result = resolveAgent(raw);
    assert.equal(result.id, "general");
    assert.equal(result.source, "fallback");
  }
});

test("a real agent id (any case/whitespace) resolves to itself with source:model", () => {
  const result = resolveAgent("  Backend  ");
  assert.equal(result.id, "backend");
  assert.equal(result.source, "model");
});

test("declared aliases resolve to their real agent with source:model", () => {
  assert.deepEqual(resolveAgent("db"), { id: "database", source: "model" });
  assert.deepEqual(resolveAgent("QA"), { id: "testing", source: "model" });
  assert.deepEqual(resolveAgent("docs"), { id: "documentation", source: "model" });
});

test("every agent's declared task yields a non-empty routeOrder() — proves the config is consumed, not decorative", () => {
  for (const id of AGENT_IDS) {
    const def = AGENT_REGISTRY[id];
    const order = routeOrder(def.task);
    assert.ok(order.length > 0, `routeOrder(${def.task}) for agent ${id} was empty`);
    assert.deepEqual(agentProviderOrder(def), order);
  }
});

test("agentRosterForPrompt() names every agent exactly once", () => {
  const roster = agentRosterForPrompt();
  for (const id of AGENT_IDS) {
    const occurrences = roster.split(`- ${id}:`).length - 1;
    assert.equal(occurrences, 1, `agent ${id} appeared ${occurrences} times in the roster`);
  }
});

test("buildAgentSystem() carries the no-repo-writes / no-fabrication contract for every agent", () => {
  for (const id of AGENT_IDS) {
    const system = buildAgentSystem(AGENT_REGISTRY[id]);
    assert.ok(system.includes("cannot write files, run commands, execute code, or modify any repository"));
    assert.ok(system.includes("===COAI ARTIFACT==="));
    assert.ok(system.includes("===END ARTIFACT==="));
    assert.ok(system.includes(AGENT_REGISTRY[id].persona));
  }
});

test("AgentId type and AGENT_IDS array stay in sync (compile-time + runtime cross-check)", () => {
  const fromType: AgentId[] = [
    "architect", "frontend", "backend", "database", "security",
    "testing", "documentation", "reviewer", "validator", "general",
  ];
  assert.deepEqual([...AGENT_IDS].sort(), [...fromType].sort());
});
