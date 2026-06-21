// v2 — Orchestration entrypoint.
//
// Wires the v2 engine to real models: load + rank memory → RAA plan (intent →
// decompose → score) → orchestrator decides mode/parallelism → DAG executor
// runs it (each node calls chatWithDARS as its assigned role, with node-level
// retry/fallback/replan) → trace persisted. Returns the assembled output plus
// the reconstructable ExecutionTrace.

import { randomUUID } from 'node:crypto';

import { chatWithDARS } from '../dars/run.js';
import { HealthStore, globalHealth } from '../dars/health.js';
import type { CredentialBag } from '../config.js';
import type { ChatMessage, ChatOpts, Role } from '../types.js';

import { getAgent } from './registry.js';
import {
  plan as raaPlan,
  makeReplan,
  llmIntentParser,
  llmDecomposer,
  type AgentRunner,
  type RaaConfig,
} from './raa.js';
import { executeGraph } from './executor.js';
import { TraceRecorder, type ExecutionTrace } from './trace.js';
import { EventBus, type WorkflowEvent } from './events.js';
import { decideExecution } from './orchestrator-v2.js';
import { rankMemories, memoriesToContextV2, contextFitFrom } from './memory-v2.js';
import { loadMemory } from '../core/memory.js';

export type V2Emit = (event: object) => void;

export interface RunV2Opts {
  creds: CredentialBag;
  userId: string;
  emit?: V2Emit;
  health?: HealthStore;
}

export interface RunV2Result {
  requestId: string;
  output: string;
  confidence: number;
  mode: string;
  trace: ExecutionTrace;
}

export async function runV2(task: string, opts: RunV2Opts): Promise<RunV2Result> {
  const health = opts.health ?? globalHealth;
  const requestId = randomUUID();
  const emit = opts.emit ?? (() => {});
  const sessionId = 'v2-' + opts.userId;

  const callFor = (role: Role) => async (messages: ChatMessage[], o: ChatOpts = {}) => {
    const r = await chatWithDARS(role, messages, o, {
      creds: opts.creds,
      health,
      emit: () => {},
      sessionId,
    });
    return r.text;
  };

  // ── Memory influence ──
  let memContext = '';
  let contextFit = 0.5;
  const trace = new TraceRecorder(requestId);
  try {
    const mem = await loadMemory(opts.userId);
    const ranked = rankMemories(task, mem, 5);
    memContext = memoriesToContextV2(ranked);
    contextFit = contextFitFrom(ranked);
    trace.memory(ranked.map((r) => ({ id: r.id, score: r.score })));
    if (ranked.length) emit({ role: 'v2', kind: 'status', text: `memory: ${ranked.length} relevant note(s)` });
  } catch {
    /* memory is best-effort */
  }

  // ── Each subtask node runs as its scored agent's DARS role ──
  const runAgent: AgentRunner = async (agentId, subtask, input, signal) => {
    const role = getAgent(agentId)?.role ?? 'coder';
    const depText = Object.entries(input)
      .map(([k, v]) => `# from ${k}\n${String(v)}`)
      .join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: `You are agent "${agentId}". Complete the subtask precisely and concisely.` },
      {
        role: 'user',
        content: [
          memContext && `Project memory:\n${memContext}`,
          `Subtask: ${subtask.description}`,
          depText && `Inputs from prior steps:\n${depText}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
    return callFor(role)(messages, { signal });
  };

  const cfg: RaaConfig = {
    health,
    parseIntent: llmIntentParser(callFor('planner')),
    decompose: llmDecomposer(callFor('planner')),
    runAgent,
    contextFit: () => contextFit,
  };

  // ── RAA: build the execution plan (score-based, DAG) ──
  emit({ role: 'v2', kind: 'status', text: 'RAA: intent → decompose → score' });
  const ep = await raaPlan(task, requestId, cfg, trace);
  emit({
    role: 'v2',
    kind: 'plan',
    confidence: ep.confidence,
    nodes: [...ep.graph.nodes.values()].map((n) => ({ id: n.id, agent: n.agentId, deps: n.dependencies })),
  });

  // ── Orchestrator: probabilistic mode + parallelism ──
  const decision = decideExecution(ep, health);
  emit({ role: 'v2', kind: 'status', text: `orchestrator: ${decision.reason} → parallel=${decision.maxParallel}` });

  // ── Event-driven execution ──
  const bus = new EventBus();
  bus.onAny((e: WorkflowEvent) => emit({ role: 'v2', kind: 'event', event: e }));

  await executeGraph(ep.graph, trace, bus, {
    maxParallel: decision.maxParallel,
    maxReplans: decision.maxReplans,
    replan: makeReplan(cfg, ep.subtasks),
  });

  // ── Assemble output from sink nodes (no dependents), else all completed ──
  const nodes = [...ep.graph.nodes.values()];
  const isDependedOn = new Set<string>();
  for (const n of nodes) n.dependencies.forEach((d) => isDependedOn.add(d));
  const sinks = nodes.filter((n) => !isDependedOn.has(n.id) && n.status === 'done');
  const pick = sinks.length ? sinks : nodes.filter((n) => n.status === 'done');
  const output = pick.map((n) => String(n.output ?? '')).join('\n\n').trim();

  await trace.persist();
  return { requestId, output, confidence: ep.confidence, mode: decision.mode, trace: trace.get() };
}
