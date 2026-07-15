// v2/recovery — Dead Letter Queue (Master Prompt 6.12).
//
// server/webhooks.ts already has a dead-letter concept, but it's scoped to
// webhook delivery only (DeliveryStatus = 'dead'). Nothing records an
// unrecoverable v2 RUN or NODE for later operator inspection — that general
// gap is this file's entire job. Mirrors v2/checkpoint.ts's persistence
// pattern exactly: local JSONL always, Supabase when configured, never
// throws into the caller's request path.
//
// replay() intentionally does NOT re-execute anything itself — it loads the
// run's last checkpoint (v2/checkpoint.ts, the existing single source of
// truth for resumable state) and hands back a descriptor. Actually resuming
// a run is v2/executor.ts's job (applyCheckpoint + executeGraph, called by
// an operator-triggered path), keeping "who is allowed to resume execution"
// answered in exactly one place.

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RcaKind } from '../logger.js';
import type { FailureKind } from '../../dars/classify.js';
import { loadCheckpoint, type CheckpointState } from '../checkpoint.js';

export interface DeadLetterEntry {
  id: string;
  runId: string;
  kind: 'run' | 'node';
  nodeId?: string;
  agentId?: string;
  /** Always set — every dead-letter has a Logger-derived RCA classification. */
  rcaKind: RcaKind;
  /** Only set when classify() ran against a concrete provider Error (a
   *  node/tool-level dead-letter); a whole-run dead-letter from
   *  RecoveryEngine.assess() has no single Error object to classify. */
  failureKind?: FailureKind;
  error: string;
  /** requestId to resume from, when a checkpoint exists for this run. */
  checkpointRef?: string;
  ts: string;
}

export interface ReplayDescriptor {
  runId: string;
  checkpoint: CheckpointState;
}

const MAX_RECENT = 200;

function deadLetterDir(): string {
  return (
    process.env.AOF_DEAD_LETTER_DIR ??
    (process.env.VERCEL ? '/tmp/aof-dead-letter' : join(process.cwd(), '.aof-server', 'dead-letter'))
  );
}

export class DeadLetterQueue {
  private recent: DeadLetterEntry[] = [];

  /** Best-effort: local JSONL always, Supabase `dead_letters` when
   *  configured. Never throws — a dead-letter write failing must not mask
   *  the original failure it's trying to record. */
  async record(entry: DeadLetterEntry): Promise<void> {
    this.recent.unshift(entry);
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;

    try {
      const dir = deadLetterDir();
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'dead-letters.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      /* non-fatal: degrades to in-memory ring buffer only */
    }

    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    try {
      await fetch(`${url}/rest/v1/dead_letters`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          id: entry.id,
          run_id: entry.runId,
          kind: entry.kind,
          node_id: entry.nodeId ?? null,
          agent_id: entry.agentId ?? null,
          rca_kind: entry.rcaKind,
          failure_kind: entry.failureKind ?? null,
          error: entry.error,
          checkpoint_ref: entry.checkpointRef ?? null,
          ts: entry.ts,
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      /* non-fatal */
    }
  }

  /** In-memory ring buffer of the most recent entries — the local JSONL file
   *  is the durable record; this is the fast operator-facing read path. */
  list(runId?: string): DeadLetterEntry[] {
    return runId ? this.recent.filter((e) => e.runId === runId) : [...this.recent];
  }

  /** Prepare a resumable descriptor from the run's last checkpoint, or null
   *  when none exists. Does not re-run anything — see file header. */
  replay(runId: string): ReplayDescriptor | null {
    const checkpoint = loadCheckpoint(runId);
    if (!checkpoint) return null;
    return { runId, checkpoint };
  }

  /** Read the durable local JSONL log directly (survives process restart,
   *  unlike the in-memory ring above). Best-effort; returns [] on any error. */
  loadPersisted(): DeadLetterEntry[] {
    try {
      const path = join(deadLetterDir(), 'dead-letters.jsonl');
      if (!existsSync(path)) return [];
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as DeadLetterEntry);
    } catch {
      return [];
    }
  }
}

/** Process-wide — the ONE dead-letter queue for unrecoverable v2 runs/nodes. */
export const globalDeadLetter = new DeadLetterQueue();

// Deliberately NOT built: a distributed/cross-process DLQ (Redis/BullMQ-backed
// — local JSONL + optional Supabase mirrors every other durability primitive
// in this codebase, e.g. v2/checkpoint.ts, v2/trace.ts); automatic replay
// (an operator or admin route calls replay() + re-runs deliberately, this
// queue never re-executes on its own); a dead-letter TTL/expiry policy
// (server/queue.ts's `audit.rotate` scheduled job is the existing precedent
// for log rotation — wiring dead-letters into it is a follow-on, not this
// pass, since it would touch server/queue.ts's job registry for a
// non-essential cleanup concern).
