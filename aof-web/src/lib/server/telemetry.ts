// ── Observability & Telemetry Platform — Co.AI Master Prompt v1.0 Part 6.9 ───
// aof-web's real gap: every runtime decision already has a real, observed
// value (logAofStage's Input/Processing/Output lines), but nothing ties them
// into ONE per-turn timeline — reconstructing what a turn actually did means
// grepping a shared requestId across a dozen separate log lines. buildTimeline()
// closes that gap: a PURE aggregation of the real, already-computed structured
// data every stage of this turn already produced (prestream-dispatch.ts's
// PreStreamTelemetry, Prompt Compiler's PromptMetadata, Token Manager's
// TokenBudget/GuardOverflowResult, Budget Enforcer's EnforcementDecision) into
// one trace object, keyed by the SAME turnRequestId that already correlates
// every existing log line — that id IS this turn's trace id; no new id scheme.
//
// Boundary (documented, following the Part 5.5 precedent of not building an
// Event Bus/Recovery Engine/standalone Monitor for a stateless, single-request
// pipeline — see orchestrator.ts's own header): there is no long-lived global
// event bus and no live dashboard here. aof-web is a stateless per-request
// Vercel runtime with no persistent process to host one. The "dashboard" this
// codebase already has is /api/admin/analytics + /api/timeline (product
// surfaces) and tmap-v2's Prometheus/health endpoints (a genuinely long-lived
// process, the right place for that). This module's job is narrower and real:
// emit ONE structured, complete timeline per turn from data that was already
// being computed anyway.
//
// Never fabricates a span or a duration: every span reflects a stage that
// actually ran (or was actually skipped, with the real reason), sourced from
// the exact same structured objects route.ts already logs field-by-field. A
// stage that didn't run for this turn is simply absent, never a placeholder.

import type { PreStreamTelemetry } from "./prestream-dispatch";
import type { PromptMetadata } from "./prompt-compiler";
import type { TokenBudget, GuardOverflowResult } from "./token-manager";
import type { EnforcementDecision } from "./budget-enforcer";

export type SpanStatus = "ok" | "degraded" | "skipped" | "error";

export interface TimelineSpan {
  name: string;
  status: SpanStatus;
  durationMs?: number;
  detail?: Record<string, string | number | boolean | undefined>;
}

export interface TimelineAlert {
  severity: "warning" | "error";
  span: string;
  message: string;
}

export interface WorkflowTimeline {
  traceId: string;
  totalDurationMs: number;
  outcome: "success" | "failure";
  spans: TimelineSpan[];
  alerts: TimelineAlert[];
}

export interface BuildTimelineOpts {
  traceId: string;
  turnStart: number;
  now?: number;
  outcome: "success" | "failure";
  preStream?: PreStreamTelemetry;
  promptCompiler?: PromptMetadata;
  tokenBudget?: TokenBudget;
  overflowGuard?: GuardOverflowResult;
  budgetDecision?: EnforcementDecision;
}

/** Pure aggregation — no I/O, no fabricated fields. Every span/alert below is
 *  sourced from a real value the caller already computed this turn. */
export function buildTimeline(opts: BuildTimelineOpts): WorkflowTimeline {
  const spans: TimelineSpan[] = [];
  const alerts: TimelineAlert[] = [];

  const cb = opts.preStream?.contextBuilder;
  if (cb) {
    spans.push({
      name: "context-builder",
      status: cb.degraded ? "degraded" : "ok",
      durationMs: cb.durationMs,
      detail: { charsSaved: cb.charsSaved },
    });
  }

  const raa = opts.preStream?.raa;
  if (raa) {
    spans.push({
      name: "requirement-analysis",
      status: raa.degraded ? "degraded" : "ok",
      durationMs: raa.durationMs,
      detail: { attempts: raa.attempts },
    });
    if (raa.degraded) {
      alerts.push({
        severity: "warning",
        span: "requirement-analysis",
        message: `degraded${raa.errorCode ? `: ${raa.errorCode}` : ""} — workflow fell back to lightweight`,
      });
    }
  }

  const tmap = opts.preStream?.tmap;
  if (tmap) {
    spans.push({
      name: "planner",
      status: tmap.degraded ? "degraded" : "ok",
      durationMs: tmap.durationMs,
      detail: { tasks: tmap.tasks, integrity: tmap.integrity },
    });
    if (tmap.degraded) {
      alerts.push({
        severity: "warning",
        span: "planner",
        message: `degraded${tmap.errorCode ? `: ${tmap.errorCode}` : ""} — proceeding without a plan`,
      });
    }
  }

  const orch = opts.preStream?.orchestration;
  if (orch) {
    spans.push({
      name: "multi-agent",
      status: orch.failed > 0 ? "degraded" : "ok",
      durationMs: orch.durationMs,
      detail: { completed: orch.completed, failed: orch.failed, skipped: orch.skipped, waves: orch.waves },
    });
    if (orch.failed > 0) {
      alerts.push({
        severity: "warning",
        span: "multi-agent",
        message: `${orch.failed} of ${orch.completed + orch.failed} agent task(s) failed`,
      });
    }
  } else if (opts.preStream?.orchestrationSkipped) {
    spans.push({ name: "multi-agent", status: "skipped", detail: { reason: opts.preStream.orchestrationSkipped } });
  }

  if (opts.promptCompiler) {
    spans.push({
      name: "prompt-compiler",
      status: "ok",
      durationMs: opts.promptCompiler.compileMs,
      detail: { estTokens: opts.promptCompiler.estTokens, cacheHit: opts.promptCompiler.cacheHit },
    });
  }

  if (opts.tokenBudget && opts.overflowGuard) {
    spans.push({
      name: "token-manager",
      status: opts.overflowGuard.stillOver ? "error" : opts.overflowGuard.overflow ? "degraded" : "ok",
      detail: {
        promptTokens: opts.tokenBudget.promptTokens,
        contextWindow: opts.tokenBudget.contextWindow,
        historyDropped: opts.overflowGuard.historyDropped || undefined,
      },
    });
    if (opts.overflowGuard.overflow) {
      alerts.push({
        severity: opts.overflowGuard.stillOver ? "error" : "warning",
        span: "token-manager",
        message: opts.overflowGuard.stillOver
          ? "context overflow could not be fully mitigated — output budget floored"
          : `context overflow mitigated by dropping ${opts.overflowGuard.historyDropped} history turn(s)`,
      });
    }
  }

  if (opts.budgetDecision) {
    spans.push({
      name: "budget-enforcer",
      status:
        opts.budgetDecision.level === "healthy" ? "ok" : opts.budgetDecision.level === "warning" ? "degraded" : "error",
      detail: { level: opts.budgetDecision.level, category: opts.budgetDecision.category, ratio: opts.budgetDecision.ratio },
    });
    if (opts.budgetDecision.level === "critical" || opts.budgetDecision.level === "exceeded") {
      alerts.push({
        severity: opts.budgetDecision.level === "exceeded" ? "error" : "warning",
        span: "budget-enforcer",
        message: opts.budgetDecision.recommendation,
      });
    }
  }

  if (opts.outcome === "failure") {
    alerts.push({ severity: "error", span: "provider", message: "every configured provider failed" });
  }

  return {
    traceId: opts.traceId,
    totalDurationMs: (opts.now ?? Date.now()) - opts.turnStart,
    outcome: opts.outcome,
    spans,
    alerts,
  };
}

/** Flattens a WorkflowTimeline into the same greppable key=value shape
 *  logAofStage's other fields already use, so it logs through the SAME
 *  sink rather than a second logging format. Omits fields the existing
 *  Output log line already carries (requestId, durationMs, success) —
 *  only the genuinely NEW information (per-span timeline, alerts). */
export function summarizeTimeline(t: WorkflowTimeline): Record<string, string | number | boolean | undefined> {
  return {
    spanCount: t.spans.length,
    spans: t.spans
      .map((s) => `${s.name}:${s.status}${s.durationMs !== undefined ? `(${Math.round(s.durationMs)}ms)` : ""}`)
      .join(","),
    alertCount: t.alerts.length || undefined,
    alerts: t.alerts.length ? t.alerts.map((a) => `${a.severity}:${a.span}`).join(",") : undefined,
  };
}
