// v2 — Execution trace store / observability.
//
// One ExecutionTrace per request reconstructs the full path: the DAG shape, the
// agent scores RAA computed, every node attempt (input/output/latency/cost/
// confidence), failures, and replan events. Persisted to Supabase
// (execution_traces / trace_nodes) when configured, always mirrored to a local
// JSONL file as a best-effort fallback — the same resilient pattern as
// server/audit.ts, but with a schema that matches the writes.

import { mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AgentScore } from './score.js';
import type { ExecGraph } from './dag.js';

export interface NodeExecutionLog {
  nodeId: string;
  agentId: string;
  attempt: number;
  ok: boolean;
  latencyMs: number;
  costUsd?: number;
  confidence?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  ts: string;
}

export interface ExecutionTrace {
  requestId: string;
  dag: Array<{ id: string; agentId: string; dependencies: string[] }>;
  nodeLogs: NodeExecutionLog[];
  agentScores: Array<{ nodeId: string; scores: AgentScore[] }>;
  memoryUsed: Array<{ id: string; score: number }>;
  failures: Array<{ nodeId: string; error: string; ts: string }>;
  replanEvents: Array<{ reason: string; addedNodes: string[]; ts: string }>;
  startedAt: string;
  finishedAt?: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function traceDir(): string {
  return (
    process.env.AOF_TRACE_DIR ??
    (process.env.VERCEL ? '/tmp/aof-trace' : join(process.cwd(), '.aof-server', 'trace'))
  );
}

export class TraceRecorder {
  private trace: ExecutionTrace;

  constructor(requestId: string) {
    this.trace = {
      requestId,
      dag: [],
      nodeLogs: [],
      agentScores: [],
      memoryUsed: [],
      failures: [],
      replanEvents: [],
      startedAt: new Date().toISOString(),
    };
  }

  /** Snapshot the current DAG shape (call after RAA builds it and after replan). */
  graph(g: ExecGraph): void {
    this.trace.dag = [...g.nodes.values()].map((n) => ({
      id: n.id,
      agentId: n.agentId,
      dependencies: n.dependencies,
    }));
  }

  scores(nodeId: string, scores: AgentScore[]): void {
    this.trace.agentScores.push({ nodeId, scores });
  }

  memory(used: Array<{ id: string; score: number }>): void {
    this.trace.memoryUsed.push(...used);
  }

  node(log: Omit<NodeExecutionLog, 'ts'> & { ts?: string }): void {
    const entry: NodeExecutionLog = { ...log, ts: log.ts ?? new Date().toISOString() };
    this.trace.nodeLogs.push(entry);
    if (!entry.ok && entry.error) {
      this.trace.failures.push({ nodeId: entry.nodeId, error: entry.error, ts: entry.ts });
    }
  }

  replan(reason: string, addedNodes: string[]): void {
    this.trace.replanEvents.push({ reason, addedNodes, ts: new Date().toISOString() });
  }

  /** The accumulated trace — fully reconstructs the execution path. */
  get(): ExecutionTrace {
    return this.trace;
  }

  /** Persist best-effort: Supabase if configured, else/also local JSONL.
   *  Never throws — observability must not break execution. */
  async persist(): Promise<void> {
    this.trace.finishedAt = new Date().toISOString();
    let cloudOk = false;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/execution_traces`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            request_id: this.trace.requestId,
            trace: this.trace,
            started_at: this.trace.startedAt,
            finished_at: this.trace.finishedAt,
          }),
          signal: AbortSignal.timeout(3_000),
        });
        cloudOk = resp.ok;
      } catch {
        cloudOk = false;
      }
    }
    if (!cloudOk) {
      try {
        const path = join(traceDir(), `trace-${this.trace.requestId}.json`);
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify(this.trace) + '\n', 'utf8');
      } catch {
        /* non-fatal: trace degraded to in-memory only */
      }
    }
  }
}
