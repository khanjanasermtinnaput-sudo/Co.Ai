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
import { runResearchAgent } from '../core/research-agent.js';
import { runWritingAgent } from '../core/writing-agent.js';
import { runMathAgent } from '../core/math-agent.js';
import { generateImagePrompt } from '../core/vision-agent.js';
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
import { rankMemories, memoriesToContextV2, contextFitFrom, updateUsageFrequency } from './memory-v2.js';
import { loadMemory, saveMemory } from '../core/memory.js';
import { Logger } from './logger.js';
import { globalRunQueue } from './queue.js';
import { globalRoutingTelemetry, type RoutingRoute } from './routing-telemetry.js';

export type V2Emit = (event: object) => void;

export interface RunV2Opts {
  creds: CredentialBag;
  userId: string;
  emit?: V2Emit;
  health?: HealthStore;
}

export interface RunV2Result {
  requestId:    string;
  output:       string;
  confidence:   number;
  mode:         string;
  /** Which engine actually produced the output. */
  route:        RoutingRoute;
  /** True when the score-based DAG was skipped/aborted and the legacy single
   *  route served the request instead (low confidence or an execution error). */
  fallbackUsed: boolean;
  trace:        ExecutionTrace;
  totalCostUsd: number;
}

/** Below this RAA plan confidence we don't execute the (guessy) DAG — we drop to
 *  the cheaper, more predictable legacy single route. Read at call time so it is
 *  tunable per deployment (and overridable in tests) without a restart. */
export function raaMinConfidence(): number {
  const v = Number(process.env.COAGENTIX_RAA_MIN_CONFIDENCE);
  return Number.isFinite(v) ? v : 0.25;
}

export async function runV2(task: string, opts: RunV2Opts): Promise<RunV2Result> {
  // System resource control: bound concurrent v2 runs per instance; excess runs
  // queue (FIFO) instead of stampeding every provider at once.
  return globalRunQueue.run(() => runV2Inner(task, opts));
}

async function runV2Inner(task: string, opts: RunV2Opts): Promise<RunV2Result> {
  const health = opts.health ?? globalHealth;
  const requestId = randomUUID();
  const emit = opts.emit ?? (() => {});
  const sessionId = 'v2-' + opts.userId;

  // Phase 7: structured logger (traceId == requestId; executionId adds timestamp for replay)
  const logger = new Logger(requestId);
  logger.logSystem('runV2 started', { userId: opts.userId, task: task.slice(0, 200) });

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
  const trace = new TraceRecorder(requestId, logger);
  try {
    const mem = await loadMemory(opts.userId);
    const ranked = rankMemories(task, mem, 5);
    memContext = memoriesToContextV2(ranked);
    contextFit = contextFitFrom(ranked);
    trace.memory(ranked.map((r) => ({ id: r.id, score: r.score })));
    if (ranked.length) {
      emit({ role: 'v2', kind: 'status', text: `memory: ${ranked.length} relevant note(s)` });
      mem.usageFrequency = updateUsageFrequency(ranked, mem.usageFrequency ?? {});
      saveMemory(mem).catch(() => {}); // fire-and-forget; memory is best-effort
    }
  } catch {
    /* memory is best-effort */
  }

  // ── Each subtask node runs as its scored agent ──
  // Specialist agents (research/writing/math/vision) dispatch to their real
  // domain implementations so their behavior (confidence flags, tone detection,
  // verification, structured image specs) is preserved. Generic agents
  // (planner/coder/reviewer/validator) run as their DARS role with a concise
  // subtask prompt. Selection between them is purely score-based (score.ts).
  const runAgent: AgentRunner = async (agentId, subtask, input, signal) => {
    const role = getAgent(agentId)?.role ?? 'coder';
    const depText = Object.entries(input)
      .map(([k, v]) => `# from ${k}\n${String(v)}`)
      .join('\n\n');
    const specialistContext = [memContext && `Project memory:\n${memContext}`, depText]
      .filter(Boolean)
      .join('\n\n') || undefined;

    switch (agentId) {
      case 'research':
        return (await runResearchAgent(callFor('planner'), subtask.description, specialistContext)).answer;
      case 'writing':
        return (await runWritingAgent(callFor('planner'), subtask.description, specialistContext)).content;
      case 'math':
        return (await runMathAgent(callFor('reviewer'), subtask.description)).solution;
      case 'vision': {
        const spec = await generateImagePrompt(callFor('planner'), subtask.description);
        return `**Image prompt**\n${spec.fullPrompt}\n\n**Negative prompt:** ${spec.negativePrompt}`;
      }
      default: {
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
      }
    }
  };

  const cfg: RaaConfig = {
    health,
    parseIntent: llmIntentParser(callFor('planner')),
    decompose: llmDecomposer(callFor('planner')),
    runAgent,
    contextFit: () => contextFit,
  };

  // Legacy single-route fallback: one direct model pass. Cheap, predictable, and
  // contract-compatible (plain text output) — used when the score-based plan is
  // low-confidence or the DAG execution fails. This is the legacy router kept
  // strictly as a safety net, never the primary path.
  const legacyRoute = async (): Promise<string> => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a capable assistant. Complete the task directly and concisely.' },
      { role: 'user', content: [memContext && `Project memory:\n${memContext}`, task].filter(Boolean).join('\n\n') },
    ];
    return callFor('planner')(messages);
  };

  // ── RAA: build the execution plan (score-based, DAG) ──
  emit({ role: 'v2', kind: 'status', text: 'RAA: intent → decompose → score' });

  let route: RoutingRoute = 'raa-v2';
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let confidence = 0;
  let selectedAgents: string[] = [];
  let mode = 'fallback';
  let output = '';

  try {
    const ep = await raaPlan(task, requestId, cfg, trace);
    confidence = ep.confidence;
    selectedAgents = [...ep.graph.nodes.values()].map((n) => n.agentId);
    emit({
      role: 'v2',
      kind: 'plan',
      confidence,
      nodes: [...ep.graph.nodes.values()].map((n) => ({ id: n.id, agent: n.agentId, deps: n.dependencies })),
    });

    const minConfidence = raaMinConfidence();
    if (confidence < minConfidence) {
      // Confidence gate: skip the guessy DAG, drop to the legacy single route.
      route = 'legacy-fallback';
      fallbackUsed = true;
      fallbackReason = `confidence ${confidence.toFixed(3)} < threshold ${minConfidence}`;
      emit({ role: 'v2', kind: 'status', text: `RAA low confidence → legacy fallback (${fallbackReason})` });
      output = await legacyRoute();
    } else {
      // ── Orchestrator: probabilistic mode + parallelism ──
      const decision = decideExecution(ep, health);
      mode = decision.mode;
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
      output = pick.map((n) => String(n.output ?? '')).join('\n\n').trim();
    }
  } catch (err) {
    // Never crash the request: any RAA planning or DAG execution failure drops to
    // the legacy single route so the user still gets an answer.
    route = 'legacy-fallback';
    fallbackUsed = true;
    fallbackReason = (err as Error).message;
    emit({ role: 'v2', kind: 'status', text: `RAA error → legacy fallback: ${fallbackReason}` });
    try {
      output = await legacyRoute();
    } catch (e2) {
      output = '';
      fallbackReason = `${fallbackReason}; legacy fallback also failed: ${(e2 as Error).message}`;
    }
  }

  // ── Structured routing decision: log + metrics ──
  const decisionLog = {
    requestId,
    route,
    confidence,
    selected_agents: selectedAgents,
    fallback_used: fallbackUsed,
    reason: fallbackReason,
    ts: new Date().toISOString(),
  };
  globalRoutingTelemetry.record(decisionLog);
  logger.logSystem('routing_decision', decisionLog);
  emit({ role: 'v2', kind: 'routing', ...decisionLog });

  await trace.persist();
  return {
    requestId,
    output,
    confidence,
    mode,
    route,
    fallbackUsed,
    trace:        trace.get(),
    totalCostUsd: logger.totalCost(),
  };
}
