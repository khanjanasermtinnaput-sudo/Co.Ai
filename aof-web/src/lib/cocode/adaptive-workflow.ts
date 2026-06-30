// ── Adaptive Workflow Engine (Phase 11) ──────────────────────────────────────
// Determines the right workflow before invoking any AI model.
// Never uses the same workflow for every request.

export type WorkflowSize = "small" | "medium" | "large";
export type WorkflowMode = "single-agent" | "multi-agent" | "full-pipeline";

export interface WorkflowDecision {
  size: WorkflowSize;
  mode: WorkflowMode;
  agents: string[];
  estimatedLatencyMs: number;
  reason: string;
  tmapMode?: "lite" | "1.0" | "pro";
}

// ── Intent classification signals ────────────────────────────────────────────

const SMALL_PATTERNS = [
  /\b(rename|typo|color|colour|padding|margin|icon|text|label|fix typo|button|font|size)\b/i,
  /\b(change .{1,30} to)\b/i,
  /\b(update text|update label|update color)\b/i,
  /\b(remove|delete|add) (a |an )?import\b/i,
];

const LARGE_PATTERNS = [
  /\b(saas|platform|full.stack|complete|entire|whole|entire app|mvp)\b/i,
  /\b(migrate|migration|architecture|refactor the whole|rewrite)\b/i,
  /\b(database schema|multi.page|authentication system|auth system)\b/i,
  /\b(backend|api (with|and)|microservice)\b/i,
];

const MEDIUM_PATTERNS = [
  /\b(dashboard|add auth|crud|login|signup|profile|settings page)\b/i,
  /\b(component|hook|context|provider|modal|form|table)\b/i,
  /\b(refactor|extract|move|split)\b/i,
  /\b(api route|endpoint|handler)\b/i,
];

// Complexity heuristics
function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

function fileCount(text: string): number {
  return (text.match(/\bfile[s]?\b|\bpage[s]?\b|\bcomponent[s]?\b/gi) ?? []).length;
}

// ── Main classifier ───────────────────────────────────────────────────────────

export function classifyWorkflow(
  request: string,
  hasRepoContext: boolean,
  fileCount_param?: number,
): WorkflowDecision {
  const lower = request.toLowerCase();
  const words = wordCount(request);
  const fileRefs = fileCount(request);

  // Small: quick, targeted change
  if (
    SMALL_PATTERNS.some((p) => p.test(lower)) &&
    words < 20 &&
    fileRefs <= 1
  ) {
    return {
      size: "small",
      mode: "single-agent",
      agents: ["Coder"],
      estimatedLatencyMs: 2000,
      reason: "Targeted change — single agent is sufficient",
      tmapMode: "lite",
    };
  }

  // Large: full SaaS / architecture / multi-page
  if (
    LARGE_PATTERNS.some((p) => p.test(lower)) ||
    words > 80 ||
    (fileCount_param !== undefined && fileCount_param > 10)
  ) {
    return {
      size: "large",
      mode: "full-pipeline",
      agents: ["Chief", "TMAP", "Planner", "Frontend", "Backend", "Database", "Security", "Testing"],
      estimatedLatencyMs: 45_000,
      reason: "Large-scale change — full TMAP pipeline with all specialist agents",
      tmapMode: "pro",
    };
  }

  // Medium: component, feature, CRUD, auth
  if (
    MEDIUM_PATTERNS.some((p) => p.test(lower)) ||
    words > 15 ||
    fileRefs > 1
  ) {
    return {
      size: "medium",
      mode: "multi-agent",
      agents: ["Planner", "Coder", "Reviewer", "Tester"],
      estimatedLatencyMs: 15_000,
      reason: "Feature-level change — planner + coder + review + test",
      tmapMode: "1.0",
    };
  }

  // Default: medium
  return {
    size: "medium",
    mode: "multi-agent",
    agents: ["Planner", "Coder", "Reviewer"],
    estimatedLatencyMs: 10_000,
    reason: "General request — standard multi-agent workflow",
    tmapMode: "1.0",
  };
}

// ── Workflow step tracking ────────────────────────────────────────────────────

export type WorkflowStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface WorkflowStep {
  id: string;
  agent: string;
  label: string;
  status: WorkflowStepStatus;
  startedAt?: number;
  completedAt?: number;
  output?: string;
}

export function createWorkflowSteps(decision: WorkflowDecision): WorkflowStep[] {
  return decision.agents.map((agent) => ({
    id: `step_${agent}_${Date.now()}`,
    agent,
    label: agentLabel(agent),
    status: "pending" as WorkflowStepStatus,
  }));
}

function agentLabel(agent: string): string {
  const labels: Record<string, string> = {
    Chief: "Chief Agent — coordinating",
    TMAP: "TMAP Pipeline — orchestrating",
    Planner: "Planner — designing solution",
    Frontend: "Frontend Agent — building UI",
    Backend: "Backend Agent — building API",
    Database: "Database Agent — schema design",
    Security: "Security Agent — reviewing",
    Coder: "Code Agent — generating",
    Reviewer: "Review Agent — auditing",
    Tester: "Testing Agent — verifying",
    Testing: "Testing Agent — verifying",
  };
  return labels[agent] ?? `${agent} Agent`;
}

// ── Refactoring operations (Phase 19) ────────────────────────────────────────

export type RefactorKind =
  | "rename-symbol"
  | "extract-component"
  | "extract-hook"
  | "extract-function"
  | "move-file"
  | "merge-components"
  | "js-to-ts"
  | "css-to-tailwind"
  | "remove-dead-code";

export interface RefactorOperation {
  kind: RefactorKind;
  label: string;
  description: string;
  requiresAI: boolean;
}

export const REFACTOR_OPERATIONS: RefactorOperation[] = [
  {
    kind: "rename-symbol",
    label: "Rename Symbol",
    description: "Rename across all files, updating imports automatically",
    requiresAI: false,
  },
  {
    kind: "extract-component",
    label: "Extract Component",
    description: "Extract selected JSX into a new React component",
    requiresAI: true,
  },
  {
    kind: "extract-hook",
    label: "Extract Hook",
    description: "Extract stateful logic into a custom hook",
    requiresAI: true,
  },
  {
    kind: "extract-function",
    label: "Extract Function",
    description: "Extract selected code block into a named function",
    requiresAI: true,
  },
  {
    kind: "move-file",
    label: "Move File",
    description: "Move file and update all import paths",
    requiresAI: false,
  },
  {
    kind: "js-to-ts",
    label: "Convert JS → TypeScript",
    description: "Add types and convert .js/.jsx to .ts/.tsx",
    requiresAI: true,
  },
  {
    kind: "css-to-tailwind",
    label: "Convert CSS → Tailwind",
    description: "Replace CSS classes with Tailwind utility classes",
    requiresAI: true,
  },
  {
    kind: "remove-dead-code",
    label: "Remove Dead Code",
    description: "Identify and remove unused imports, variables, functions",
    requiresAI: true,
  },
];
