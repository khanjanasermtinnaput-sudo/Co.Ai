// v2 — DAG checkpoint + resume.
//
// The executor already resumes an in-memory graph (re-running executeGraph only
// re-runs non-`done` nodes). This adds DURABLE checkpointing so a run can resume
// after a process restart / cold start: serialize per-node runtime state, persist
// it (local JSONL always, Supabase when configured — same resilient pattern as
// trace.ts), and re-apply it onto a freshly rebuilt graph.
//
// `run` closures are intentionally NOT serialized. To resume: rebuild the graph
// structure (same node ids, via RAA), applyCheckpoint(savedState), then call
// executeGraph again — completed nodes keep their outputs and are never recomputed.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ExecGraph, NodeStatus } from './dag.js';
import type { AgentWorkingMemory } from './awm.js';

export interface NodeCheckpoint {
  id: string;
  status: NodeStatus;
  attempts: number;
  agentId: string;            // may have been re-bound to a fallback
  fallbackAgentIds: string[]; // remaining fallbacks
  dependencies: string[];
  error?: string;
  output?: unknown;
  /** Ephemeral Agent Working Memory (awm.ts) — carried along so a resumed run
   *  picks up a node's progress notes / partial result, not just its final output. */
  awm?: AgentWorkingMemory;
}

export interface CheckpointState {
  requestId: string;
  savedAt: string;
  nodes: NodeCheckpoint[];
}

/** Capture the resumable runtime state of every node. Pure — no IO. */
export function serializeGraph(g: ExecGraph): CheckpointState {
  return {
    requestId: g.requestId,
    savedAt: new Date().toISOString(),
    nodes: [...g.nodes.values()].map((n) => ({
      id: n.id,
      status: n.status,
      attempts: n.attempts,
      agentId: n.agentId,
      fallbackAgentIds: [...n.fallbackAgentIds],
      dependencies: [...n.dependencies],
      error: n.error,
      output: n.output,
      awm: n.awm,
    })),
  };
}

/** Restore saved runtime state onto a freshly-built graph (matched by node id).
 *  Ids in the checkpoint that are absent from the graph are ignored, so a plan
 *  that changed shape between runs degrades safely rather than throwing. */
export function applyCheckpoint(g: ExecGraph, state: CheckpointState): void {
  for (const snap of state.nodes) {
    const node = g.nodes.get(snap.id);
    if (!node) continue;
    node.status = snap.status;
    node.attempts = snap.attempts;
    node.agentId = snap.agentId;
    node.fallbackAgentIds = [...snap.fallbackAgentIds];
    node.error = snap.error;
    node.output = snap.output;
    node.awm = snap.awm;
  }
}

// ── Persistence (best-effort; never throws) ───────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function checkpointDir(): string {
  return (
    process.env.AOF_CHECKPOINT_DIR ??
    (process.env.VERCEL ? '/tmp/aof-checkpoint' : join(process.cwd(), '.aof-server', 'checkpoint'))
  );
}

function checkpointPath(requestId: string): string {
  return join(checkpointDir(), `ckpt-${requestId}.json`);
}

/** Persist a checkpoint. Local file always (atomic-ish overwrite), Supabase too
 *  when configured. Observability/durability must never break execution. */
export async function saveCheckpoint(g: ExecGraph): Promise<void> {
  const state = serializeGraph(g);
  try {
    const path = checkpointPath(state.requestId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state), 'utf8');
  } catch {
    /* non-fatal: checkpoint degraded to in-memory only */
  }
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/execution_checkpoints`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ request_id: state.requestId, state, saved_at: state.savedAt }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      /* non-fatal */
    }
  }
}

/** Load the latest checkpoint for a request from local disk, or null. */
export function loadCheckpoint(requestId: string): CheckpointState | null {
  try {
    const path = checkpointPath(requestId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as CheckpointState;
  } catch {
    return null;
  }
}
