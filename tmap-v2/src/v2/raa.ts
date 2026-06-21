// v2 — RAA: the reasoning + scoring decision engine.
//
// Pipeline: parse intent → decompose into a subtask DAG → score ALL registered
// agents per subtask → select top-K primary + ranked fallbacks → emit an
// ExecutionPlan (an ExecGraph ready for the executor). No keyword routing and
// no static intent→agent map: every assignment comes from score.ts ranking.
//
// Intent parsing and decomposition are injectable so the engine can run fully
// offline in tests; the default implementations are LLM-backed (JSON out).

import { HealthStore } from '../dars/health.js';
import { listAgents, normalizeCapabilities, type AgentDescriptor, type CapabilityVector } from './registry.js';
import { rankAgents, type AgentScore } from './score.js';
import {
  createGraph,
  type ExecGraph,
  type ExecNode,
  type RetryPolicy,
} from './dag.js';
import type { TraceRecorder } from './trace.js';
import type { LLMCall } from '../types.js';

export interface IntentSpec {
  goal: string;
  complexity: number; // 0..1
  requiredCapabilities: CapabilityVector;
}

export interface SubTask {
  id: string;
  description: string;
  requiredCapabilities: CapabilityVector;
  dependencies: string[];
}

export interface TaskGraph {
  subtasks: SubTask[];
}

export type IntentParser = (task: string) => Promise<IntentSpec>;
export type Decomposer = (task: string, intent: IntentSpec) => Promise<TaskGraph>;

/** Runs the agent assigned to a subtask. The production impl wraps
 *  chatWithDARS(agent.role, …); tests inject a deterministic fake. */
export type AgentRunner = (
  agentId: string,
  subtask: SubTask,
  input: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;

export interface RaaConfig {
  health: HealthStore;
  parseIntent: IntentParser;
  decompose: Decomposer;
  runAgent: AgentRunner;
  contextFit?: (a: AgentDescriptor) => number;
  /** Number of fallback agents to record per node. Default 2. */
  fallbacks?: number;
}

export interface ExecutionPlan {
  intent: IntentSpec;
  graph: ExecGraph;
  subtasks: Map<string, SubTask>;
  confidence: number; // mean of selected nodes' top score
}

function retryFor(complexity: number): RetryPolicy {
  // More complex work tolerates more retries.
  return { maxRetries: complexity > 0.66 ? 2 : 1, backoffMs: 400 };
}

/** Build an ExecutionPlan from a task. Pure score-based agent assignment. */
export async function plan(
  task: string,
  requestId: string,
  cfg: RaaConfig,
  trace?: TraceRecorder,
): Promise<ExecutionPlan> {
  const intent = await cfg.parseIntent(task);
  const tg = await cfg.decompose(task, intent);
  const fallbackN = cfg.fallbacks ?? 2;

  const subtasks = new Map<string, SubTask>();
  const nodes: ExecNode[] = [];
  let scoreSum = 0;

  for (const st of tg.subtasks) {
    // Canonicalise the LLM's capability words onto the enum so scoring has a
    // real signal. Fall back to the intent-level capabilities, then to a
    // sensible default — never an empty vector (which would zero out scoring
    // and route everything to the cheapest agent).
    let req = normalizeCapabilities(st.requiredCapabilities);
    if (Object.keys(req).length === 0) req = normalizeCapabilities(intent.requiredCapabilities);
    if (Object.keys(req).length === 0) req = { plan: 0.5 };
    st.requiredCapabilities = req; // keep node + replan in sync
    subtasks.set(st.id, st);

    const ranked: AgentScore[] = rankAgents(req, listAgents(), {
      health: cfg.health,
      contextFit: cfg.contextFit,
    });
    if (!ranked.length) throw new Error(`no agents available to serve subtask ${st.id}`);

    const primary = ranked[0];
    const fallbacks = ranked.slice(1, 1 + fallbackN).map((r) => r.agentId);
    scoreSum += primary.total;
    trace?.scores(st.id, ranked);

    nodes.push({
      id: st.id,
      kind: 'agent',
      agentId: primary.agentId,
      fallbackAgentIds: fallbacks,
      dependencies: st.dependencies,
      retry: retryFor(intent.complexity),
      timeoutMs: 45_000,
      status: 'pending',
      attempts: 0,
      run: (input, signal, agentId) =>
        cfg.runAgent(agentId, st, input as Record<string, unknown>, signal),
    });
  }

  const graph = createGraph(requestId, nodes);
  const confidence = tg.subtasks.length ? scoreSum / tg.subtasks.length : 0;
  return { intent, graph, subtasks, confidence };
}

/** A replan callback for the executor: when a node has burned its fallbacks,
 *  re-rank ALL agents for that subtask afresh (live health may have changed)
 *  and, if a not-yet-current agent scores, give the node another life. */
export function makeReplan(cfg: RaaConfig, subtasks: Map<string, SubTask>) {
  return async (failed: ExecNode, _g: ExecGraph): Promise<string[]> => {
    const st = subtasks.get(failed.id);
    if (!st) return [];
    const ranked = rankAgents(st.requiredCapabilities, listAgents(), {
      health: cfg.health,
      contextFit: cfg.contextFit,
    }).filter((r) => r.agentId !== failed.agentId);
    if (!ranked.length) return [];
    failed.agentId = ranked[0].agentId;
    failed.fallbackAgentIds = ranked.slice(1, 3).map((r) => r.agentId);
    failed.error = undefined;
    failed.status = 'pending'; // revive: pump will retry with the fresh agent
    return [];
  };
}

// ── Default LLM-backed intent + decomposition ────────────────────────────────

function safeJson<T>(text: string, fallback: T): T {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : fallback;
  } catch {
    return fallback;
  }
}

const INTENT_SYS =
  'Extract the user intent. Reply ONLY JSON: {"goal":string,"complexity":0..1,' +
  '"requiredCapabilities":{capability:weight}} where capability is one of ' +
  'plan,code,review,validate,research,write,math,vision,security,refactor,test and weight is 0..1.';

export function llmIntentParser(call: LLMCall): IntentParser {
  return async (task) => {
    const text = await call(
      [
        { role: 'system', content: INTENT_SYS },
        { role: 'user', content: task },
      ],
      { temperature: 0.1, maxTokens: 400 },
    );
    const parsed = safeJson<Partial<IntentSpec>>(text, {});
    const caps = normalizeCapabilities(parsed.requiredCapabilities);
    return {
      goal: parsed.goal ?? task.slice(0, 200),
      complexity: typeof parsed.complexity === 'number' ? parsed.complexity : 0.5,
      requiredCapabilities: Object.keys(caps).length ? caps : { plan: 0.5 },
    };
  };
}

const DECOMP_SYS =
  'Decompose the task into a DAG of subtasks. Reply ONLY JSON: {"subtasks":[' +
  '{"id":string,"description":string,"requiredCapabilities":{capability:weight},' +
  '"dependencies":[id,...]}]}. Keep ids short. dependencies reference earlier ids. ' +
  'requiredCapabilities keys MUST be chosen from this exact set: ' +
  'plan,code,review,validate,research,write,math,vision,security,refactor,test ' +
  '(weight 0..1). Use "code" for writing/implementing code and "test" for tests.';

export function llmDecomposer(call: LLMCall): Decomposer {
  return async (task, intent) => {
    const text = await call(
      [
        { role: 'system', content: DECOMP_SYS },
        { role: 'user', content: `Goal: ${intent.goal}\nTask: ${task}` },
      ],
      { temperature: 0.2, maxTokens: 900 },
    );
    const parsed = safeJson<TaskGraph>(text, { subtasks: [] });
    if (parsed.subtasks?.length) return parsed;
    // Fallback: a single node covering the whole task (still DAG-valid).
    return {
      subtasks: [
        {
          id: 'main',
          description: task,
          requiredCapabilities: intent.requiredCapabilities,
          dependencies: [],
        },
      ],
    };
  };
}
