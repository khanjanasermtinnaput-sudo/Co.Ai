// Smart Cost Optimizer: route tasks to the right model tier based on complexity

import chalk from "chalk";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskTier = "simple" | "medium" | "complex" | "titan";

export interface CostPlan {
  tier: TaskTier;
  model: string;
  endpoint: string;
  mode: string;
  estimatedTokens: number;
  reason: string;
}

// Model routing table — maps to backend model names
const TIER_CONFIG: Record<TaskTier, { model: string; endpoint: string; mode: string }> = {
  simple:  { model: "qwen-coder",       endpoint: "/v1/run",   mode: "fast" },
  medium:  { model: "deepseek-coder",   endpoint: "/v1/run",   mode: "balanced" },
  complex: { model: "llama-3.3-70b",    endpoint: "/v1/run",   mode: "pro" },
  titan:   { model: "multi-agent",      endpoint: "/v1/titan", mode: "titan" },
};

// ── Complexity Signals ─────────────────────────────────────────────────────────

interface ComplexitySignals {
  taskLength: number;
  hasMultipleFiles: boolean;
  hasArchitectureWords: boolean;
  hasSecurityWords: boolean;
  hasRefactorWords: boolean;
  hasGenerateWords: boolean;
  contextTokens: number;
}

function analyzeTask(task: string, contextLength: number): ComplexitySignals {
  const lower = task.toLowerCase();
  return {
    taskLength:           task.length,
    hasMultipleFiles:     /multi(?:ple)?\s+file|entire\s+(?:repo|project|codebase)|all\s+file/i.test(task),
    hasArchitectureWords: /architect|system\s+design|microservice|monorepo|migration|refactor\s+entire/i.test(lower),
    hasSecurityWords:     /security|auth(?:entication|orization)|jwt|oauth|rbac|encrypt/i.test(lower),
    hasRefactorWords:     /refactor|restructure|clean\s+up|reorganize|rewrite/i.test(lower),
    hasGenerateWords:     /generate|create\s+(?:a\s+)?(?:full|complete|entire|new)|build\s+(?:a\s+)?(?:full|app|project)/i.test(lower),
    contextTokens:        Math.round(contextLength / 4),
  };
}

// ── Tier Selection ─────────────────────────────────────────────────────────────

export function selectTier(
  task: string,
  contextLength: number,
  overrides?: { titan?: boolean; model?: string },
): CostPlan {
  // User explicitly requested titan
  if (overrides?.titan) {
    return buildPlan("titan", task, contextLength, "User requested --titan mode");
  }

  const s = analyzeTask(task, contextLength);
  let tier: TaskTier;
  let reason: string;

  // Titan: huge scope or architecture-level
  if (s.hasMultipleFiles && s.hasArchitectureWords) {
    tier   = "titan";
    reason = "Multi-file + architecture change → multi-agent orchestration";
  }
  // Complex: security, full architecture, large refactors
  else if (s.hasArchitectureWords || s.hasSecurityWords || (s.hasRefactorWords && s.hasMultipleFiles)) {
    tier   = "complex";
    reason = "Architecture/security/multi-file refactor → premium model";
  }
  // Medium: generation, moderate length, multi-step
  else if (s.hasGenerateWords || s.taskLength > 200 || s.contextTokens > 20_000) {
    tier   = "medium";
    reason = "Code generation or large context → balanced model";
  }
  // Simple: short tasks, single-file fixes, explanations
  else {
    tier   = "simple";
    reason = "Short focused task → lightweight model";
  }

  // Override model if user specified
  const plan = buildPlan(tier, task, contextLength, reason);
  if (overrides?.model) {
    plan.model = overrides.model;
    plan.reason += ` (model override: ${overrides.model})`;
  }

  return plan;
}

function buildPlan(tier: TaskTier, task: string, contextLength: number, reason: string): CostPlan {
  const cfg = TIER_CONFIG[tier];
  return {
    tier,
    model:           cfg.model,
    endpoint:        cfg.endpoint,
    mode:            cfg.mode,
    estimatedTokens: Math.round(contextLength / 4) + Math.round(task.length / 4),
    reason,
  };
}

// ── Print ─────────────────────────────────────────────────────────────────────

const TIER_COLOR: Record<TaskTier, (s: string) => string> = {
  simple:  chalk.green,
  medium:  chalk.cyan,
  complex: chalk.yellow,
  titan:   chalk.magenta,
};

export function printCostPlan(plan: CostPlan): void {
  const color = TIER_COLOR[plan.tier];
  console.log(
    chalk.dim("  ") +
    color(`[${plan.tier.toUpperCase()}]`) +
    chalk.dim(` model: ${plan.model}  ~${plan.estimatedTokens.toLocaleString()} tokens`) +
    chalk.dim(`  · ${plan.reason}`),
  );
}
