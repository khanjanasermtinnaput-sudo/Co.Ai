// v2 — TMAP DAG execution engine.
//
// Executes an ExecGraph topologically with bounded parallelism. Each node gets
// per-node retry (exponential backoff) under a per-attempt timeout. On
// exhaustion the node falls back to its next-ranked agent; if all fallbacks are
// spent it triggers a replan (RAA recomputes / splices the affected subgraph);
// if replan can't recover, the node fails and its dependents are skipped.
//
// Because all state lives on the nodes, calling executeGraph again on the same
// graph resumes from failed/pending nodes only — `done` nodes keep their output
// and are never recomputed (re-run from failure).

import { ExecGraph, ExecNode, readyNodes, topoOrder, gatherInputs } from './dag.js';
import { TraceRecorder } from './trace.js';
import { EventBus } from './events.js';

export interface ExecOptions {
  maxParallel: number;
  /** Patch the graph in place to recover from `failed`. To retry the same node,
   *  set its status back to 'pending'; to route around it, add alternative
   *  nodes. Returns the ids of any nodes added. */
  replan?: (failed: ExecNode, g: ExecGraph) => Promise<string[]>;
  /** Cap how many replans the whole run may trigger (prevents loops). */
  maxReplans?: number;
  /** Called after every node settles (done/failed/skipped or re-queued), so a
   *  caller can durably checkpoint the graph for resume-after-restart. Must not
   *  throw; best-effort. */
  onProgress?: (g: ExecGraph) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isTerminal = (n: ExecNode): boolean =>
  n.status === 'done' || n.status === 'failed' || n.status === 'skipped';

/** Mark every transitive dependent of a failed node as skipped. */
function skipDependents(g: ExecGraph, failedId: string): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of g.nodes.values()) {
      if (n.status !== 'pending') continue;
      const blocked = n.dependencies.some((d) => {
        const dep = g.nodes.get(d);
        return dep && (dep.status === 'failed' || dep.status === 'skipped');
      });
      if (n.dependencies.includes(failedId) || blocked) {
        n.status = 'skipped';
        n.error = `skipped: dependency ${failedId} did not complete`;
        changed = true;
      }
    }
  }
}

/** Run one node through its retry policy. Returns true on success. */
async function runNode(node: ExecNode, g: ExecGraph, trace: TraceRecorder): Promise<boolean> {
  const input = gatherInputs(g, node);
  for (let attempt = 0; attempt <= node.retry.maxRetries; attempt++) {
    node.attempts = attempt + 1;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), node.timeoutMs);
    const t0 = Date.now();
    try {
      const output = await node.run(input, ac.signal, node.agentId);
      node.output = output;
      trace.node({
        nodeId: node.id,
        agentId: node.agentId,
        attempt,
        ok: true,
        latencyMs: Date.now() - t0,
        output,
      });
      return true;
    } catch (e) {
      node.error = String((e as Error)?.message ?? e);
      trace.node({
        nodeId: node.id,
        agentId: node.agentId,
        attempt,
        ok: false,
        latencyMs: Date.now() - t0,
        error: node.error,
      });
      if (attempt < node.retry.maxRetries) await sleep(node.retry.backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

export async function executeGraph(
  g: ExecGraph,
  trace: TraceRecorder,
  bus: EventBus,
  opts: ExecOptions,
): Promise<void> {
  topoOrder(g); // validate acyclic + no dangling deps up front
  trace.graph(g);

  const maxReplans = opts.maxReplans ?? 2;
  let replans = 0;
  let running = 0;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown): void => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // Recover from a node that exhausted its retries.
    const handleFailure = async (node: ExecNode): Promise<void> => {
      // 1) Fall back to the next-ranked agent, if any remain.
      if (node.fallbackAgentIds.length > 0) {
        const next = node.fallbackAgentIds.shift() as string;
        node.agentId = next;
        node.status = 'pending';
        return;
      }
      // 2) Replan (bounded).
      if (opts.replan && replans < maxReplans) {
        replans++;
        bus.emit({ type: 'replan_triggered', reason: node.error ?? 'node failed', nodeId: node.id });
        const added = await opts.replan(node, g);
        trace.replan(node.error ?? 'node failed', added);
        trace.graph(g);
        // If replan revived the node (set it back to pending) let the pump retry
        // it; otherwise treat it as terminally failed.
        if (node.status !== 'pending') {
          node.status = 'failed';
          bus.emit({ type: 'node_fail', nodeId: node.id, error: node.error ?? 'failed' });
          skipDependents(g, node.id);
        }
        return;
      }
      // 3) No recovery left.
      node.status = 'failed';
      bus.emit({ type: 'node_fail', nodeId: node.id, error: node.error ?? 'failed' });
      skipDependents(g, node.id);
    };

    const pump = (): void => {
      if (settled) return;
      const nodes = [...g.nodes.values()];
      if (nodes.every(isTerminal) && running === 0) return finish();

      const slots = Math.max(0, opts.maxParallel - running);
      const ready = readyNodes(g).slice(0, slots);

      // Deadlock guard: nothing running, nothing ready, but not all terminal.
      if (running === 0 && ready.length === 0 && !nodes.every(isTerminal)) {
        return finish(new Error('execution stalled: unresolved non-terminal nodes'));
      }

      for (const node of ready) {
        node.status = 'running';
        running++;
        bus.emit({ type: 'node_start', nodeId: node.id });
        runNode(node, g, trace)
          .then(async (ok) => {
            running--;
            if (ok) {
              node.status = 'done';
              bus.emit({ type: 'node_complete', nodeId: node.id });
            } else {
              await handleFailure(node);
            }
            try { opts.onProgress?.(g); } catch { /* checkpoint is best-effort */ }
            pump();
          })
          .catch((err) => {
            running--;
            finish(err);
          });
      }
    };

    pump();
  });
}
