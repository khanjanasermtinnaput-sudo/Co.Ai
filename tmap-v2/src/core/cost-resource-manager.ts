// Cost & Resource Manager (CRM) — Co.AI Master Prompt v1.0 Part 5.10.
//
// Runs exactly once, before orchestration begins, for Ypertatos Ultra/Extreme
// builds. Estimates the resource envelope a run will need (tokens, context,
// providers, agents, retries, execution time) and produces a Resource
// Allocation Plan the caller logs and can act on.
//
// CRM never changes engineering requirements and never skips a mandatory
// stage — it only sizes the budgets those stages already enforce
// (CostMonitor ceilings, domainGraphMaxParallel, the quality-gate retry
// loop). Estimation is heuristic (no LLM call): CRM must be near-free to run
// ahead of the very thing it is budgeting for. If estimation fails for any
// reason, it falls back to conservative defaults and logs the failure rather
// than blocking the workflow — per spec, "Workflow must never terminate
// because budgeting failed."

import type { Blackboard } from '../types.js';
import type { EngineeringDomain } from './engineering-classifier.js';
import type { YpertatosEffort } from './ypertatos.js';
import { estimateTokens, type BudgetLimits } from './cost-budget.js';
import { domainGraphMaxParallel } from '../v2/domain-graph.js';

export interface TokenBudgetEstimate {
  inputTokens: number;
  expectedOutputTokens: number;
  expectedAgentTokens: number;
  expectedValidationTokens: number;
  expectedReviewTokens: number;
  expectedTotalTokens: number;
}

export interface ContextBudgetEstimate {
  maxContextChars: number;
  repositoryContextChars: number;
  executionContextChars: number;
}

export interface ProviderBudgetEstimate {
  expectedCalls: number;
  maxAllowedCalls: number;
  fallbackProvidersAvailable: boolean;
}

export interface AgentBudgetEstimate {
  requiredAgents: number;
  optionalAgents: number;
  maxParallelAgents: number;
  reservedAgents: number;
}

export interface RetryBudgetEstimate {
  maxRetryCount: number;
  retryDelayMs: number;
  backoffStrategy: 'fixed' | 'exponential';
}

export interface ExecutionTimeBudgetEstimate {
  estimatedPlanningMs: number;
  estimatedEngineeringMs: number;
  estimatedValidationMs: number;
  estimatedReviewMs: number;
  estimatedReflectionMs: number;
  estimatedTotalMs: number;
}

export interface ResourceAllocationPlan {
  effort: YpertatosEffort;
  tokenBudget: TokenBudgetEstimate;
  contextBudget: ContextBudgetEstimate;
  providerBudget: ProviderBudgetEstimate;
  agentBudget: AgentBudgetEstimate;
  retryBudget: RetryBudgetEstimate;
  executionTimeBudget: ExecutionTimeBudgetEstimate;
  optimizationDecisions: string[];
  warnings: string[];
  /** True when estimation threw and this plan is the conservative fallback. */
  degraded: boolean;
}

type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

const BASE_STAGE_CALLS = 3; // architect + planner + reviewer (validator is grounded, no LLM call)
const QUALITY_GATE_EXTRA_CALLS = 2; // matches executeGraph's execOpts.maxReplans on High/Ultra/Extreme
const AVG_CALL_MS = 8_000; // rough per-LLM-call latency budget, used only for the time estimate

function numEnv(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function usesQualityGate(effort: YpertatosEffort): boolean {
  return effort === 'high' || effort === 'ultra' || effort === 'extreme';
}

function estimateTokenBudget(bb: Blackboard, domainCount: number): TokenBudgetEstimate {
  const inputTokens = estimateTokens(bb.task) + estimateTokens(bb.context ?? '');
  const architectPlannerTokens = 1_500;
  const perDomainAgentTokens = 1_500; // system+user prompt overhead + generated file(s)
  const expectedAgentTokens = domainCount * perDomainAgentTokens;
  const expectedValidationTokens = 0; // validateFiles() is grounded toolchain checks, not an LLM call
  const expectedReviewTokens = 600;
  const expectedOutputTokens = architectPlannerTokens + expectedAgentTokens + expectedReviewTokens;
  return {
    inputTokens,
    expectedOutputTokens,
    expectedAgentTokens,
    expectedValidationTokens,
    expectedReviewTokens,
    expectedTotalTokens: inputTokens + expectedOutputTokens,
  };
}

function estimateContextBudget(bb: Blackboard): ContextBudgetEstimate {
  return {
    maxContextChars: numEnv(process.env.COAGENTIX_MAX_CONTEXT_CHARS, 60_000),
    repositoryContextChars: (bb.context ?? '').length,
    executionContextChars: 0, // sized only once the Execution Context Bus starts publishing, mid-run
  };
}

function estimateProviderBudget(domainCount: number, effort: YpertatosEffort, limits: BudgetLimits): ProviderBudgetEstimate {
  const expectedCalls = BASE_STAGE_CALLS + domainCount + (usesQualityGate(effort) ? QUALITY_GATE_EXTRA_CALLS : 0);
  return {
    expectedCalls,
    maxAllowedCalls: limits.maxCalls,
    fallbackProvidersAvailable: true, // DARS health-based provider fallback is structural, not per-run
  };
}

function estimateAgentBudget(domainCount: number, effort: YpertatosEffort): AgentBudgetEstimate {
  return {
    requiredAgents: BASE_STAGE_CALLS + domainCount,
    optionalAgents: effort === 'extreme' ? 1 : 0, // Self Reflection Engine pass
    maxParallelAgents: domainGraphMaxParallel(domainCount, usesQualityGate(effort)),
    reservedAgents: 0, // no held-back fallback agents in the current pipeline
  };
}

function estimateRetryBudget(effort: YpertatosEffort): RetryBudgetEstimate {
  return {
    maxRetryCount: usesQualityGate(effort) ? QUALITY_GATE_EXTRA_CALLS : 0,
    retryDelayMs: 0, // replans re-run immediately; no fixed backoff wired today
    backoffStrategy: 'fixed',
  };
}

function estimateExecutionTimeBudget(providerBudget: ProviderBudgetEstimate, domainCount: number, effort: YpertatosEffort): ExecutionTimeBudgetEstimate {
  const estimatedPlanningMs = 2 * AVG_CALL_MS; // architect + planner
  const engineeringCalls = Math.max(1, providerBudget.expectedCalls - BASE_STAGE_CALLS);
  const maxParallel = Math.max(1, domainGraphMaxParallel(domainCount, usesQualityGate(effort)));
  const estimatedEngineeringMs = Math.ceil(engineeringCalls / maxParallel) * AVG_CALL_MS;
  const estimatedValidationMs = 500; // grounded syntax checks, no network call
  const estimatedReviewMs = AVG_CALL_MS;
  const estimatedReflectionMs = effort === 'extreme' ? 1_500 : 0; // heuristic pass, no LLM call
  return {
    estimatedPlanningMs,
    estimatedEngineeringMs,
    estimatedValidationMs,
    estimatedReviewMs,
    estimatedReflectionMs,
    estimatedTotalMs:
      estimatedPlanningMs + estimatedEngineeringMs + estimatedValidationMs + estimatedReviewMs + estimatedReflectionMs,
  };
}

function optimizationDecisionsFor(domainCount: number, agentBudget: AgentBudgetEstimate): string[] {
  const decisions = [
    `agent allocation capped at ${agentBudget.maxParallelAgents} parallel domain agent(s) — idle agents are never scheduled (buildDomainGraph only creates nodes for detected domains)`,
    'single Validator pass and single Reviewer pass per run — no duplicate validation or review stages',
  ];
  if (domainCount <= 1) {
    decisions.push('single-domain task — Result Integrator conflict-merge pass has nothing to merge');
  }
  return decisions;
}

function warningsFor(tokenBudget: TokenBudgetEstimate, providerBudget: ProviderBudgetEstimate, limits: BudgetLimits): string[] {
  const warnings: string[] = [];
  if (limits.maxTokens > 0 && tokenBudget.expectedTotalTokens > limits.maxTokens * 0.8) {
    warnings.push(`estimated tokens (${tokenBudget.expectedTotalTokens.toLocaleString()}) are within 80% of the run's token ceiling (${limits.maxTokens.toLocaleString()})`);
  }
  if (limits.maxCalls > 0 && providerBudget.expectedCalls > limits.maxCalls) {
    warnings.push(`estimated LLM calls (${providerBudget.expectedCalls}) exceed the run's call ceiling (${limits.maxCalls}) — CostMonitor will stop the run early and return its best-effort partial result`);
  }
  return warnings;
}

/** Pure estimation. Callers should go through runCostResourceManager(), which
 *  wraps this in the spec's required conservative-fallback error handling. */
export function buildResourceAllocationPlan(
  bb: Blackboard,
  domains: EngineeringDomain[],
  effort: YpertatosEffort,
  limits: BudgetLimits,
): ResourceAllocationPlan {
  const domainCount = Math.max(1, domains.length);
  const tokenBudget = estimateTokenBudget(bb, domainCount);
  const contextBudget = estimateContextBudget(bb);
  const providerBudget = estimateProviderBudget(domainCount, effort, limits);
  const agentBudget = estimateAgentBudget(domainCount, effort);
  const retryBudget = estimateRetryBudget(effort);
  const executionTimeBudget = estimateExecutionTimeBudget(providerBudget, domainCount, effort);

  return {
    effort,
    tokenBudget,
    contextBudget,
    providerBudget,
    agentBudget,
    retryBudget,
    executionTimeBudget,
    optimizationDecisions: optimizationDecisionsFor(domainCount, agentBudget),
    warnings: warningsFor(tokenBudget, providerBudget, limits),
    degraded: false,
  };
}

/** Conservative defaults used when estimation itself throws — wide budgets,
 *  no assumed parallelism, so a failed estimate can never under-provision. */
function conservativeDefaultPlan(effort: YpertatosEffort, limits: BudgetLimits): ResourceAllocationPlan {
  return {
    effort,
    tokenBudget: {
      inputTokens: 0,
      expectedOutputTokens: 0,
      expectedAgentTokens: 0,
      expectedValidationTokens: 0,
      expectedReviewTokens: 0,
      expectedTotalTokens: limits.maxTokens || 2_000_000,
    },
    contextBudget: { maxContextChars: 60_000, repositoryContextChars: 0, executionContextChars: 0 },
    providerBudget: { expectedCalls: limits.maxCalls || 40, maxAllowedCalls: limits.maxCalls, fallbackProvidersAvailable: true },
    agentBudget: { requiredAgents: 1, optionalAgents: 0, maxParallelAgents: 1, reservedAgents: 0 },
    retryBudget: { maxRetryCount: 0, retryDelayMs: 0, backoffStrategy: 'fixed' },
    executionTimeBudget: {
      estimatedPlanningMs: 0, estimatedEngineeringMs: 0, estimatedValidationMs: 0,
      estimatedReviewMs: 0, estimatedReflectionMs: 0, estimatedTotalMs: 0,
    },
    optimizationDecisions: [],
    warnings: ['resource estimation failed — running with conservative (unbounded-looking) defaults; real ceilings still enforced by CostMonitor'],
    degraded: true,
  };
}

function summarizePlan(plan: ResourceAllocationPlan): string {
  const parts = [
    `crm: tier=${plan.effort}`,
    `tokens≈${plan.tokenBudget.expectedTotalTokens.toLocaleString()}`,
    `calls≈${plan.providerBudget.expectedCalls}/${plan.providerBudget.maxAllowedCalls || '∞'}`,
    `agents=${plan.agentBudget.requiredAgents}(+${plan.agentBudget.optionalAgents} optional)@parallel≤${plan.agentBudget.maxParallelAgents}`,
    `retries≤${plan.retryBudget.maxRetryCount}`,
    `time≈${Math.round(plan.executionTimeBudget.estimatedTotalMs / 1000)}s`,
  ];
  if (plan.degraded) parts.push('[DEGRADED: conservative defaults]');
  return parts.join(' · ');
}

/**
 * Entry point: builds the Resource Allocation Plan, logs it, and never
 * throws — estimation failure degrades to conservative defaults instead of
 * blocking the workflow (spec Error Handling requirement).
 */
export function runCostResourceManager(
  bb: Blackboard,
  domains: EngineeringDomain[],
  effort: YpertatosEffort,
  limits: BudgetLimits,
  emit: Emit,
): ResourceAllocationPlan {
  let plan: ResourceAllocationPlan;
  try {
    plan = buildResourceAllocationPlan(bb, domains, effort, limits);
  } catch (e) {
    emit('crm', `estimation failed (${(e as Error).message}) — falling back to conservative defaults`, 'error');
    plan = conservativeDefaultPlan(effort, limits);
  }
  emit('crm', summarizePlan(plan), 'status');
  for (const w of plan.warnings) emit('crm', `warning: ${w}`, 'status');
  return plan;
}
