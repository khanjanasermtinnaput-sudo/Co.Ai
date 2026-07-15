// v2/recovery — Runtime Recovery Engine (Master Prompt 6.12).
//
// "Recovery is architecture. Recovery is not exception handling." Exploration
// found the actual recovery MECHANISMS already exist and are mature: retry +
// backoff (server/failover.ts withRetry, executor.ts's per-node retry loop),
// three circuit breakers, DARS provider failover, node-level agent fallback +
// bounded replan (executor.ts handleFailure), and durable checkpoints
// (v2/checkpoint.ts). None of that is reimplemented here. What was missing:
// a single place that turns "what just happened during this run" into an
// honest, structured RecoveryReport, and a general dead-letter record for
// runs that could not be recovered (only a webhook-scoped one existed).
//
// RecoveryEngine.assess() is a PURE, POST-HOC READER over data the run has
// already produced (Logger entries, the executed ExecGraph, whether the
// caller ultimately produced usable output) — it makes no provider calls,
// retries nothing, and never mutates the graph or the run's output. It maps
// errors through the two classifiers that already exist (dars/classify.ts's
// FailureKind, v2/logger.ts's RcaKind) rather than inventing a third
// taxonomy, and reads recovery evidence (root cause, cascade, recoveryPath)
// straight from Logger.rcaSummary() rather than re-deriving it.

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger, RcaKind, RcaSummary } from '../logger.js';
import { classifyError as classifyRcaError } from '../logger.js';
import { classifyError as classifyDarsError, type FailureKind } from '../../dars/classify.js';
import { isBudgetError, type BudgetExceededError } from '../../core/cost-budget.js';
import { listCircuits } from '../../server/failover.js';
import type { ExecGraph } from '../dag.js';

/** What the engine can honestly say happened, given REAL signals available
 *  today. 'provider_failover' is defined for forward compatibility (DARS
 *  already fails over between providers/instances inside a single node's
 *  chatWithDARS call) but is deliberately never emitted by inferStrategies()
 *  in this pass — nothing in the current call path (grep-confirmed: Logger's
 *  logAgent() is called only from tests, never from dars/run.ts or
 *  v2/executor.ts) surfaces that as a distinct signal. Reporting it anyway
 *  would be exactly the fabricated evidence this repo's discipline forbids. */
export type RecoveryStrategy =
  | 'node_retry'
  | 'agent_fallback'
  | 'replan'
  | 'skip_dependents'
  | 'route_fallback'      // whole run dropped from the scored DAG to run.ts's legacy single-call route
  | 'provider_failover'   // reserved — see note above; not emitted today
  | 'checkpoint_resume'   // reserved — set only by DeadLetterQueue.replay() callers, never by assess()
  | 'dead_letter'
  | 'none';

export interface RecoveryReport {
  runId: string;
  failureSummary: string;
  rootCause?: RcaSummary['rootCause'];
  strategiesApplied: RecoveryStrategy[];
  durationMs: number;
  recoveredComponents: string[];
  remainingRisks: string[];
  recovered: boolean;
  deadLettered: boolean;
  timestamp: string;
}

export interface AssessInput {
  runId: string;
  logger: Logger;
  /** Date.now() captured at the start of the run — durationMs is measured
   *  from here, never fabricated as a fixed/round number. */
  startedAt: number;
  /** The executed graph, when the run reached execution (absent when RAA
   *  planning itself failed before a graph existed). */
  graph?: ExecGraph;
  /** The error object run.ts's own try/catch caught, if the RAA plan or DAG
   *  execution threw. Absent when the run completed without a fatal error
   *  (per-node failures still show up via `graph`/`logger` either way). */
  fatalError?: unknown;
  /** True when the turn still returned non-empty output despite fatalError /
   *  node failures (e.g. run.ts's legacy-route safety net produced an
   *  answer). Real, caller-supplied evidence — assess() never guesses this. */
  producedOutput?: boolean;
}

export class RecoveryEngine {
  /** Maps a raw error through BOTH existing classifiers. Never defines a
   *  third taxonomy — this is a mapping, not a new classification. */
  classify(error: Error | string): { failureKind: FailureKind; rcaKind: RcaKind } {
    const err = typeof error === 'string' ? new Error(error) : error;
    return {
      failureKind: classifyDarsError(err),
      rcaKind: classifyRcaError(err.message ?? String(error)),
    };
  }

  /** Reads what the executor's own failure ladder (v2/executor.ts
   *  handleFailure) already did, from the signals it already produces —
   *  infers from evidence, never re-decides a strategy itself. */
  private inferStrategies(input: AssessInput): Set<RecoveryStrategy> {
    const strategies = new Set<RecoveryStrategy>();
    const entries = input.logger.getEntries();

    // executor.ts's runNode() increments node.attempts per retry; trace.node()
    // proxies every attempt into logger.logNode() with that attempt number.
    if (entries.some((e) => e.category === 'node' && Number(e.meta.attempt) > 0)) {
      strategies.add('node_retry');
    }

    // A node whose logNode entries carry more than one distinct agentId was
    // re-bound to a fallback agent by handleFailure() step 1.
    const agentIdsByNode = new Map<string, Set<string>>();
    for (const e of entries) {
      if (e.category !== 'node' || !e.nodeId || !e.agentId) continue;
      const set = agentIdsByNode.get(e.nodeId) ?? new Set<string>();
      set.add(e.agentId);
      agentIdsByNode.set(e.nodeId, set);
    }
    if ([...agentIdsByNode.values()].some((s) => s.size > 1)) {
      strategies.add('agent_fallback');
    }

    // trace.ts's replan() always logs 'replan triggered: ...' via logSystem —
    // the one real signal a bounded RAA replan happened.
    if (entries.some((e) => e.category === 'system' && e.message.startsWith('replan triggered:'))) {
      strategies.add('replan');
    }

    // Skipped nodes never call node.run() at all, so they leave no Logger
    // entry — the graph's own status is the only real signal.
    if (input.graph && [...input.graph.nodes.values()].some((n) => n.status === 'skipped')) {
      strategies.add('skip_dependents');
    }

    if (input.fatalError !== undefined) {
      strategies.add('route_fallback');
    }

    return strategies;
  }

  /** Pure aggregation over a run's already-collected telemetry. Makes zero
   *  provider calls, mutates nothing, and is deterministic for identical
   *  inputs (see recovery-engine.test.ts's regression test). */
  assess(input: AssessInput): RecoveryReport {
    const { runId, logger, startedAt, graph, fatalError, producedOutput } = input;
    const rca = logger.rcaSummary();
    const strategies = this.inferStrategies(input);

    const failedNodes = graph ? [...graph.nodes.values()].filter((n) => n.status === 'failed') : [];
    const budgetHit = isBudgetError(fatalError);

    const remainingRisks: string[] = [];
    if (budgetHit) remainingRisks.push(`budget exceeded: ${(fatalError as BudgetExceededError).message}`);
    if (failedNodes.length) {
      remainingRisks.push(`${failedNodes.length} node(s) terminally failed: ${failedNodes.map((n) => n.id).join(', ')}`);
    }
    const openCircuits = listCircuits().filter((c) => c.state === 'open');
    if (openCircuits.length) {
      remainingRisks.push(`${openCircuits.length} circuit(s) open: ${openCircuits.map((c) => c.name).join(', ')}`);
    }

    // "Recovered" is measured the way the spec frames it — did the run have
    // the highest possible chance of still completing? A run with failure
    // signals that nonetheless produced usable output (legacy-route safety
    // net, a successful retry/fallback) counts as recovered; one that has
    // failure signals AND no usable output does not.
    //
    // rca.recovered is ONLY meaningful when there were per-node Logger
    // failures to recover from — Logger.rcaSummary() returns `recovered: true`
    // VACUOUSLY when totalFailures is 0 (see logger.ts), which is exactly the
    // shape of a top-level fatalError (RAA/budget errors are never logged as
    // node failures). OR-ing that vacuous truth in unconditionally would make
    // every fatalError run "recovered" regardless of producedOutput — so it
    // only applies when there were real node-level failures to judge.
    const anyFailure = Boolean(fatalError) || failedNodes.length > 0 || rca.totalFailures > 0;
    const recovered = !anyFailure
      ? true
      : fatalError !== undefined
        ? Boolean(producedOutput)
        : rca.recovered || Boolean(producedOutput);
    const deadLettered = anyFailure && !recovered;
    if (deadLettered) strategies.add('dead_letter');
    if (!anyFailure) strategies.add('none');

    const failureSummary = budgetHit
      ? `run terminated: ${(fatalError as Error).message}`
      : fatalError !== undefined
        ? `RAA/execution error: ${(fatalError as Error).message ?? String(fatalError)}`
        : rca.totalFailures > 0
          ? `${rca.totalFailures} node failure(s), root cause ${rca.rootCause?.kind ?? 'unknown'} on node ${rca.rootCause?.nodeId ?? '?'}`
          : 'no failures recorded';

    return {
      runId,
      failureSummary,
      rootCause: rca.rootCause,
      strategiesApplied: [...strategies],
      durationMs: Date.now() - startedAt,
      recoveredComponents: rca.recoveryPath,
      remainingRisks,
      recovered,
      deadLettered,
      timestamp: new Date().toISOString(),
    };
  }

  /** Best-effort JSONL persistence — mirrors v2/checkpoint.ts's / v2/trace.ts's
   *  local-file-always, Supabase-when-configured, never-throws pattern. */
  async persist(report: RecoveryReport): Promise<void> {
    try {
      const dir =
        process.env.AOF_RECOVERY_DIR ??
        (process.env.VERCEL ? '/tmp/aof-recovery' : join(process.cwd(), '.aof-server', 'recovery'));
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'recovery-reports.jsonl'), JSON.stringify(report) + '\n', 'utf8');
    } catch {
      /* non-fatal: recovery reporting degrades to in-memory (log line) only */
    }

    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    try {
      await fetch(`${url}/rest/v1/recovery_reports`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          run_id: report.runId,
          report,
          recovered: report.recovered,
          dead_lettered: report.deadLettered,
          ts: report.timestamp,
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      /* non-fatal */
    }
  }
}

/** Process-wide — the ONE Recovery Engine coordinating this instance's runs. */
export const globalRecoveryEngine = new RecoveryEngine();

// Deliberately NOT built: a new retry/backoff implementation (executor.ts +
// server/failover.ts's withRetry already own this); a fourth circuit breaker
// (three already exist and are intentionally not merged — see dars/health.ts's
// own header); a replacement for DARS provider failover; an automatic
// cross-process resume daemon (DeadLetterQueue.replay() prepares a resumable
// descriptor; actually resuming is operator-invoked, never automatic); a
// saga/compensation/transaction-rollback framework beyond the checkpoint
// resume v2/checkpoint.ts already provides.
