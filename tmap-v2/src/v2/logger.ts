// v2 — Phase 7: Unified structured logging engine.
//
// Emits typed log entries keyed by TraceID + ExecutionID.
// Supports Node Logs, Agent Logs, Latency Logs, Cost Logs, Failure Logs,
// Root Cause Analysis, Replay timeline, and Debugging queries.
//
// Persistence: Supabase `execution_logs` table → local JSONL fallback.
// All methods are synchronous; flush() is async + best-effort.

import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type TraceID     = string; // == requestId (one per user request)
export type ExecutionID = string; // traceId:timestamp (unique per run/replay)

export type LogLevel    = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'node' | 'agent' | 'latency' | 'cost' | 'failure' | 'system';

export type RcaKind =
  | 'provider_auth'        // HTTP 401/403
  | 'provider_quota'       // HTTP 402/429 / insufficient credits
  | 'provider_unavailable' // HTTP 5xx / network error
  | 'timeout'              // node exceeded timeoutMs
  | 'bad_output'           // low-quality / validation failure
  | 'cascade_failure'      // downstream of another failure
  | 'unknown';

export interface LogEntry {
  id:          string;
  traceId:     TraceID;
  executionId: ExecutionID;
  nodeId?:     string;
  agentId?:    string;
  level:       LogLevel;
  category:    LogCategory;
  message:     string;
  meta:        Record<string, unknown>;
  ts:          string; // ISO-8601
}

export interface RcaSummary {
  rootCause?: {
    nodeId:  string;
    agentId: string;
    kind:    RcaKind;
    error:   string;
    ts:      string;
  };
  /** nodeIds that failed as a downstream consequence of the root cause. */
  cascadeChain:  string[];
  totalFailures: number;
  /** True when every failed node eventually had a successful retry or replan. */
  recovered:     boolean;
  /** agentIds that succeeded after a prior failure on the same node. */
  recoveryPath:  string[];
}

// ── RCA error classifier ──────────────────────────────────────────────────────

export function classifyError(error: string): RcaKind {
  const e = error.toLowerCase();
  if (/40[13]|unauthorized|forbidden/.test(e))                          return 'provider_auth';
  if (/402|429|credits?|quota|rate.?limit/.test(e))                     return 'provider_quota';
  if (/5\d{2}|bad gateway|service unavail|econnrefused|enotfound/.test(e)) return 'provider_unavailable';
  if (/time.?out|timed out/.test(e))                                    return 'timeout';
  if (/low.?quality|validation|bad output/.test(e))                     return 'bad_output';
  return 'unknown';
}

// ── Logger ────────────────────────────────────────────────────────────────────

export class Logger {
  readonly traceId:     TraceID;
  readonly executionId: ExecutionID;
  private entries: LogEntry[] = [];

  constructor(traceId: TraceID) {
    this.traceId     = traceId;
    // Include a uuid fragment so two Logger instances for the same traceId
    // (e.g. replay) always get distinct executionIds even within the same ms.
    this.executionId = `${traceId}:${randomUUID().slice(0, 8)}`;
  }

  // ── Core private push ──────────────────────────────────────────────────────

  private push(
    level:    LogLevel,
    category: LogCategory,
    message:  string,
    meta:     Record<string, unknown>,
    nodeId?:  string,
    agentId?: string,
  ): LogEntry {
    const entry: LogEntry = {
      id: randomUUID(),
      traceId:     this.traceId,
      executionId: this.executionId,
      nodeId,
      agentId,
      level,
      category,
      message,
      meta,
      ts: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  // ── Typed log helpers ──────────────────────────────────────────────────────

  /** Node-level outcome (success or failure, with attempt count). */
  logNode(
    nodeId:  string,
    agentId: string,
    attempt: number,
    ok:      boolean,
    meta:    Record<string, unknown> = {},
  ): void {
    this.push(
      ok ? 'info' : 'error',
      'node',
      ok
        ? `node:${nodeId} done (attempt ${attempt + 1})`
        : `node:${nodeId} failed (attempt ${attempt + 1})`,
      { attempt, ok, ...meta },
      nodeId,
      agentId,
    );
  }

  /** Agent-level outcome: provider used, latency, cost, success/failure. */
  logAgent(
    nodeId:    string,
    agentId:   string,
    provider:  string,
    latencyMs: number,
    costUsd:   number | undefined,
    ok:        boolean,
    error?:    string,
  ): void {
    this.push(
      ok ? 'info' : 'warn',
      'agent',
      `agent:${agentId} via ${provider} — ${ok ? 'ok' : 'failed'}`,
      { provider, latencyMs, costUsd: costUsd ?? 0, ok, error },
      nodeId,
      agentId,
    );
  }

  /** Latency measurement for a named phase within a node. */
  logLatency(nodeId: string, agentId: string, phase: string, latencyMs: number): void {
    this.push(
      latencyMs > 30_000 ? 'warn' : 'debug',
      'latency',
      `latency:${phase} ${latencyMs}ms (node:${nodeId})`,
      { phase, latencyMs },
      nodeId,
      agentId,
    );
  }

  /** Cost attribution per node attempt. */
  logCost(
    nodeId:  string,
    agentId: string,
    costUsd: number,
    tokens?: { input: number; output: number },
  ): void {
    this.push(
      'info',
      'cost',
      `cost:$${costUsd.toFixed(6)} (node:${nodeId})`,
      { costUsd, tokens: tokens ?? null },
      nodeId,
      agentId,
    );
  }

  /** Failure with auto-classified RCA kind. */
  logFailure(nodeId: string, agentId: string, error: string, kind?: RcaKind): void {
    const resolvedKind = kind ?? classifyError(error);
    this.push(
      'error',
      'failure',
      `failure:${resolvedKind} in node:${nodeId} — ${error.slice(0, 200)}`,
      { error, kind: resolvedKind },
      nodeId,
      agentId,
    );
  }

  /** System-level annotation (pipeline phase, memory hits, etc.). */
  logSystem(message: string, meta: Record<string, unknown> = {}): void {
    this.push('info', 'system', message, meta);
  }

  // ── Query API (for debugging / root-cause inspection) ─────────────────────

  /** All entries, in insertion order. */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /** All entries for a given node — full execution history of that node. */
  forNode(nodeId: string): LogEntry[] {
    return this.entries.filter((e) => e.nodeId === nodeId);
  }

  /** All entries in a given category (e.g. 'failure', 'cost'). */
  forCategory(cat: LogCategory): LogEntry[] {
    return this.entries.filter((e) => e.category === cat);
  }

  // ── Aggregation ────────────────────────────────────────────────────────────

  /** Sum of all cost entries. */
  totalCost(): number {
    return this.entries
      .filter((e) => e.category === 'cost')
      .reduce((sum, e) => sum + ((e.meta.costUsd as number) ?? 0), 0);
  }

  /** Sum of input+output tokens across all cost entries that carried token meta. */
  totalTokens(): number {
    return this.entries
      .filter((e) => e.category === 'cost')
      .reduce((sum, e) => {
        const t = e.meta.tokens as { input?: number; output?: number } | null | undefined;
        return sum + (t ? (t.input ?? 0) + (t.output ?? 0) : 0);
      }, 0);
  }

  /**
   * Root Cause Analysis: identifies the first failure, the cascade chain it
   * triggered, and whether the run eventually recovered.
   */
  rcaSummary(): RcaSummary {
    const failures = this.entries.filter((e) => e.category === 'failure');
    if (!failures.length) {
      return { cascadeChain: [], totalFailures: 0, recovered: true, recoveryPath: [] };
    }

    // Root = first failure chronologically
    const root = failures[0];
    const rootKind = (root.meta.kind as RcaKind) ?? classifyError(String(root.meta.error ?? ''));

    // Cascade chain = all other distinct failed nodes after root
    const seen = new Set<string>([root.nodeId ?? '']);
    const cascadeChain = failures
      .slice(1)
      .map((f) => f.nodeId ?? '')
      .filter((id) => id && !seen.has(id) && (seen.add(id), true));

    const failedNodeIds = new Set([root.nodeId ?? '', ...cascadeChain].filter(Boolean));

    // Recovery: a success log for any previously-failed node
    const successAfterFail = this.entries
      .filter((e) => e.category === 'node' && e.meta.ok === true && failedNodeIds.has(e.nodeId ?? ''))
      .map((e) => e.agentId ?? '')
      .filter(Boolean);

    return {
      rootCause: root.nodeId
        ? {
            nodeId:  root.nodeId,
            agentId: root.agentId ?? '',
            kind:    rootKind,
            error:   String(root.meta.error ?? ''),
            ts:      root.ts,
          }
        : undefined,
      cascadeChain,
      totalFailures: failedNodeIds.size,
      recovered:     successAfterFail.length > 0,
      recoveryPath:  [...new Set(successAfterFail)],
    };
  }

  // ── Replay / debugging ─────────────────────────────────────────────────────

  /**
   * Ordered timeline with ms offset from first entry.
   * Enables deterministic replay: feed entries back into the bus in offsetMs order.
   */
  timeline(): Array<LogEntry & { offsetMs: number }> {
    if (!this.entries.length) return [];
    const t0 = new Date(this.entries[0].ts).getTime();
    return this.entries.map((e) => ({
      ...e,
      offsetMs: new Date(e.ts).getTime() - t0,
    }));
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * Flush all entries to Supabase `execution_logs` table.
   * Falls back to a local JSONL file. Never throws.
   */
  async flush(): Promise<void> {
    if (!this.entries.length) return;
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let cloudOk = false;

    if (url && key) {
      try {
        const rows = this.entries.map((e) => ({
          id:           e.id,
          trace_id:     e.traceId,
          execution_id: e.executionId,
          node_id:      e.nodeId ?? null,
          agent_id:     e.agentId ?? null,
          level:        e.level,
          category:     e.category,
          message:      e.message,
          meta:         e.meta,
          ts:           e.ts,
        }));
        const resp = await fetch(`${url}/rest/v1/execution_logs`, {
          method: 'POST',
          headers: {
            apikey:         key,
            Authorization:  `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer:         'return=minimal,resolution=ignore-duplicates',
          },
          body: JSON.stringify(rows),
          signal: AbortSignal.timeout(4_000),
        });
        cloudOk = resp.ok;
      } catch {
        cloudOk = false;
      }
    }

    if (!cloudOk) {
      try {
        const dir =
          process.env.AOF_TRACE_DIR ??
          (process.env.VERCEL ? '/tmp/aof-trace' : join(process.cwd(), '.aof-server', 'trace'));
        mkdirSync(dir, { recursive: true });
        appendFileSync(
          join(dir, `log-${this.traceId}.jsonl`),
          this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
          'utf8',
        );
      } catch {
        /* non-fatal: logs degrade to in-memory only */
      }
    }
  }
}
