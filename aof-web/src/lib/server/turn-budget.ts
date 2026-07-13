// ── turn-budget.ts — the pro-engineering turn's wall-clock ledger (no I/O) ──
// Part 5.5's Execution Monitor needs a real clock to report against. This is
// it: one job, own the turn's remaining time, so RAA/TMAP/orchestration can
// each ask "how long do I actually have left" instead of assuming a fixed
// slice. Orchestration is deliberately the elastic term — it gets whatever
// pre-stream time survives RAA+TMAP, capped, and degrades (skips tasks,
// honestly reported) rather than blowing the budget. See turn-budget.test.ts
// for the drift guard against route.ts's `export const maxDuration = 60`.

/** Mirrors route.ts's `export const maxDuration = 60` literal. Next.js
 * requires that export to be a static literal, so route.ts cannot import
 * this constant — turn-budget.test.ts reads route.ts's source and asserts
 * the two agree, so drift is caught, not assumed. */
export const ROUTE_MAX_DURATION_SEC = 60;

/** 6s margin under the route's hard 60s cap: cold start, auth, rate-limit,
 * body parsing, and time-to-first-byte all eat into the 60s before any
 * stage of this ledger even starts. */
export const TURN_BUDGET_MS = 54_000;

/** Protected window for the streamed answer. A policy floor, not a
 * prediction — deriving it from workflowMaxTokens() would reserve ~28s at
 * ultra effort and starve orchestration to zero, and provider throughput
 * can't be predicted anyway. */
export const STREAM_RESERVE_MS = 26_000;

/** Engineering path only. buffered-call.ts's own DEFAULT_DEADLINE_MS (20s)
 * stays the default for buffered calls made outside this ledger. */
export const RAA_DEADLINE_MS = 12_000;

export const TMAP_DEADLINE_MS = 10_000;

/** A CAP on orchestration's wall-clock spend, not a guaranteed allocation —
 * orchestration gets min(this, whatever's left of the pre-stream pool). */
export const ORCHESTRATION_MAX_MS = 20_000;

export const AGENT_DEADLINE_MS = 12_000;

/** Below this, never start another agent — there isn't enough time left for
 * a real attempt, only a doomed one. */
export const MIN_AGENT_MS = 6_000;

export const MAX_PARALLEL = 3;
export const MAX_TASKS = 6;

export interface TurnBudget {
  readonly startedAt: number;
  elapsedMs(): number;
  /** Wall-clock still spendable on PRE-STREAM work, i.e. after honouring
   * STREAM_RESERVE_MS. Never negative. */
  preStreamRemainingMs(): number;
  /** min(requestedMs, preStreamRemainingMs()) — the deadline a stage
   * actually gets, never more than it asked for and never more than the
   * turn can afford. */
  deadlineFor(requestedMs: number): number;
  /** True when less than minMs remains for pre-stream work — the signal to
   * skip a stage entirely rather than start it. */
  exhausted(minMs: number): boolean;
  snapshot(): { elapsedMs: number; preStreamRemainingMs: number };
}

export function makeTurnBudget(
  startedAt: number,
  opts?: { totalMs?: number; streamReserveMs?: number },
): TurnBudget {
  const totalMs = opts?.totalMs ?? TURN_BUDGET_MS;
  const streamReserveMs = opts?.streamReserveMs ?? STREAM_RESERVE_MS;
  const preStreamPoolMs = Math.max(0, totalMs - streamReserveMs);

  function elapsedMs(): number {
    return Math.max(0, Date.now() - startedAt);
  }

  function preStreamRemainingMs(): number {
    return Math.max(0, preStreamPoolMs - elapsedMs());
  }

  function deadlineFor(requestedMs: number): number {
    return Math.max(0, Math.min(requestedMs, preStreamRemainingMs()));
  }

  function exhausted(minMs: number): boolean {
    return preStreamRemainingMs() < minMs;
  }

  function snapshot() {
    return { elapsedMs: elapsedMs(), preStreamRemainingMs: preStreamRemainingMs() };
  }

  return { startedAt, elapsedMs, preStreamRemainingMs, deadlineFor, exhausted, snapshot };
}
