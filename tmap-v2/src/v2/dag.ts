// v2 — DAG model + topological scheduler.
//
// Execution is a directed acyclic graph of nodes. Each node declares its
// dependencies, retry policy, timeout, the agent assigned by RAA scoring, and
// ranked fallback agents. Node state lives on the node itself so a re-run can
// resume from a failed node without recomputing `done` nodes.

import type { NodeKind } from './registry.js';

export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export interface ExecNode<I = unknown, O = unknown> {
  id: string;
  kind: NodeKind;
  agentId: string;             // chosen by RAA scoring (score.ts)
  fallbackAgentIds: string[];  // next-ranked agents, tried on failure
  dependencies: string[];      // node ids that must be `done` first
  retry: RetryPolicy;
  timeoutMs: number;
  /** Executes the node. Receives merged outputs of its dependencies. The
   *  agentId may have been re-bound to a fallback before this is called. */
  run: (input: I, signal: AbortSignal, agentId: string) => Promise<O>;

  // ── runtime state ──
  status: NodeStatus;
  attempts: number;
  output?: O;
  error?: string;
}

export interface ExecGraph {
  requestId: string;
  nodes: Map<string, ExecNode>;
}

export function createGraph(requestId: string, nodes: ExecNode[]): ExecGraph {
  const map = new Map<string, ExecNode>();
  for (const n of nodes) map.set(n.id, n);
  return { requestId, nodes: map };
}

/** Kahn topological order. Throws if the graph contains a cycle or a dangling
 *  dependency — both violate the DAG invariant and must fail fast. */
export function topoOrder(g: ExecGraph): string[] {
  const indeg = new Map<string, number>();
  for (const n of g.nodes.values()) {
    for (const d of n.dependencies) {
      if (!g.nodes.has(d)) throw new Error(`node ${n.id} depends on unknown node ${d}`);
    }
    indeg.set(n.id, n.dependencies.length);
  }

  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];

  while (queue.length) {
    const id = queue.shift() as string;
    order.push(id);
    for (const n of g.nodes.values()) {
      if (n.dependencies.includes(id)) {
        const d = (indeg.get(n.id) ?? 0) - 1;
        indeg.set(n.id, d);
        if (d === 0) queue.push(n.id);
      }
    }
  }

  if (order.length !== g.nodes.size) {
    throw new Error('cycle detected in execution DAG');
  }
  return order;
}

/** Nodes whose dependencies are all `done` and which haven't started yet. */
export function readyNodes(g: ExecGraph): ExecNode[] {
  return [...g.nodes.values()].filter(
    (n) =>
      n.status === 'pending' &&
      n.dependencies.every((d) => g.nodes.get(d)?.status === 'done'),
  );
}

/** Merge the outputs of a node's dependencies into a keyed object. */
export function gatherInputs(g: ExecGraph, node: ExecNode): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const d of node.dependencies) {
    const dep = g.nodes.get(d);
    if (dep && dep.status === 'done') input[d] = dep.output;
  }
  return input;
}
