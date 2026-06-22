// v2 — Execution trace store / observability (Phase 7 upgrade).
//
// One ExecutionTrace per request reconstructs the full path: DAG shape, agent
// scores, every node attempt (input/output/latency/cost/confidence), failures,
// replan events, and — new in Phase 7 — executionId, totalCostUsd and an
// RCA summary. The TraceRecorder optionally accepts a Logger; when present,
// every trace.node() call also emits structured Node/Latency/Cost/Failure log
// entries automatically.
//
// Persistence: Supabase (execution_traces / trace_nodes) → local JSONL fallback.

import { mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AgentScore } from './score.js';
import type { ExecGraph } from './dag.js';
import type { Logger, RcaSummary } from './logger.js';

export interface NodeExecutionLog {
  nodeId:      string;
  agentId:     string;
  attempt:     number;
  ok:          boolean;
  latencyMs:   number;
  costUsd?:    number;
  confidence?: number;
  input?:      unknown;
  output?:     unknown;
  error?:      string;
  ts:          string;
}

export interface ExecutionTrace {
  requestId:    string;
  /** Unique per run/replay — `${requestId}:${startTimestamp}`. */
  executionId?: string;
  dag:          Array<{ id: string; agentId: string; dependencies: string[] }>;
  nodeLogs:     NodeExecutionLog[];
  agentScores:  Array<{ nodeId: string; scores: AgentScore[] }>;
  memoryUsed:   Array<{ id: string; score: number }>;
  failures:     Array<{ nodeId: string; error: string; ts: string }>;
  replanEvents: Array<{ reason: string; addedNodes: string[]; ts: string }>;
  startedAt:    string;
  finishedAt?:  string;
  /** Aggregated cost across all node attempts (populated at persist time). */
  totalCostUsd?: number;
  /** Structured root-cause analysis (populated at persist time). */
  rcaSummary?:   RcaSummary;
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
  private logger?: Logger;

  constructor(requestId: string, logger?: Logger) {
    this.logger = logger;
    this.trace = {
      requestId,
      executionId: logger?.executionId,
      dag:          [],
      nodeLogs:     [],
      agentScores:  [],
      memoryUsed:   [],
      failures:     [],
      replanEvents: [],
      startedAt:    new Date().toISOString(),
    };
  }

  /** Snapshot the current DAG shape (call after RAA builds it and after replan). */
  graph(g: ExecGraph): void {
    this.trace.dag = [...g.nodes.values()].map((n) => ({
      id:           n.id,
      agentId:      n.agentId,
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

    // ── Phase 7: proxy to structured Logger ──────────────────────────────────
    if (this.logger) {
      this.logger.logNode(entry.nodeId, entry.agentId, entry.attempt, entry.ok, {
        latencyMs:  entry.latencyMs,
        costUsd:    entry.costUsd,
        confidence: entry.confidence,
      });
      this.logger.logLatency(entry.nodeId, entry.agentId, 'execution', entry.latencyMs);
      if (entry.costUsd !== undefined && entry.costUsd > 0) {
        this.logger.logCost(entry.nodeId, entry.agentId, entry.costUsd);
      }
      if (!entry.ok && entry.error) {
        this.logger.logFailure(entry.nodeId, entry.agentId, entry.error);
      }
    }
  }

  replan(reason: string, addedNodes: string[]): void {
    this.trace.replanEvents.push({ reason, addedNodes, ts: new Date().toISOString() });
    this.logger?.logSystem(`replan triggered: ${reason}`, { addedNodes });
  }

  /** The accumulated trace — fully reconstructs the execution path.
   *  Includes executionId, totalCostUsd, rcaSummary when a Logger is attached. */
  get(): ExecutionTrace {
    return {
      ...this.trace,
      totalCostUsd: this.logger?.totalCost() ?? 0,
      rcaSummary:   this.logger?.rcaSummary(),
    };
  }

  /** Persist best-effort: Supabase → local JSONL. Never throws. */
  async persist(): Promise<void> {
    this.trace.finishedAt = new Date().toISOString();

    // Attach final aggregates before saving.
    if (this.logger) {
      this.trace.totalCostUsd = this.logger.totalCost();
      this.trace.rcaSummary   = this.logger.rcaSummary();
    }

    let cloudOk = false;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/execution_traces`, {
          method: 'POST',
          headers: {
            apikey:         SUPABASE_KEY,
            Authorization:  `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer:         'return=minimal',
          },
          body: JSON.stringify({
            request_id:    this.trace.requestId,
            execution_id:  this.trace.executionId,
            trace:         this.trace,
            started_at:    this.trace.startedAt,
            finished_at:   this.trace.finishedAt,
            total_cost_usd: this.trace.totalCostUsd ?? 0,
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
        /* non-fatal */
      }
    }

    // Flush structured log entries (best-effort, parallel to trace).
    await this.logger?.flush().catch(() => {});
  }
}
