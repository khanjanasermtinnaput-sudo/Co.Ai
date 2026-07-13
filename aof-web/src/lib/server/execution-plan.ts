// ── TMAP — Task Multi-Agent Planning Engine — Co.AI Master Prompt Part 5.4 ──
// Server-only, single-shot, buffered planning stage: turns the Requirement
// Spec RAA produced into an executable Execution Plan. TMAP never generates
// production code, never edits repositories, and never produces the final
// response — its only job is deciding HOW the work should be performed.
//
// Follows requirement-analysis.ts's discipline exactly, reusing its line-walk
// helpers and `key: value | key: value` idiom rather than a second parsing
// style: a tolerant, NEVER-throws parser that degrades to a `partial`/`empty`
// plan instead of propagating, and NEVER fabricates a value the model
// omitted (`priority`/`complexity`/`planConfidence` are `null`, not a
// silently-invented default).
//
// "No orphan tasks" (Part 5.4) is read as "no dangling dependency
// references" — roots and leaves are normal, required DAG shapes that Part
// 5.5's parallel execution is built out of; forbidding them literally would
// forbid the very plans orchestration exists to run.

import {
  hasHeader,
  listUnder,
  lineValue,
  parsePercent,
  parseRisks,
  type RequirementRisk,
  type RequirementSpec,
} from "./requirement-analysis";
import { agentRosterForPrompt, resolveAgent, type AgentId } from "./agent-registry";
import type { RepoMetadata, TaskDecision } from "./task-classifier";

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskComplexityLevel = "simple" | "medium" | "complex";
export type PlanIntegrity = "ok" | "cycle" | "empty";

export interface PlannedTask {
  id: string; // normalized "TASK-001"
  title: string;
  description: string; // "" when omitted — never invented
  agent: AgentId;
  agentSource: "model" | "fallback";
  dependsOn: string[]; // dangling/self edges already removed — see warnings
  priority: TaskPriority | null; // null when omitted — NOT defaulted to "medium"
  complexity: TaskComplexityLevel | null;
  expectedOutput: string;
  validationMethod: string;
  successCriteria: string;
}

export interface PlanWarning {
  kind:
    | "unknown-agent"
    | "dangling-dependency"
    | "self-dependency"
    | "duplicate-task-id"
    | "unparsable-task-line";
  taskId?: string;
  detail: string; // the exact observed text — never a guess
}

export interface ExecutionPlan {
  strategy: string;
  tasks: PlannedTask[];
  risks: RequirementRisk[]; // reused from requirement-analysis.ts — one Risk type
  planConfidence: number | null;
  /** DERIVED (Kahn), never read from the model even if it emits an order.
   *  Each inner array is one parallelizable wave. [] when integrity !== "ok". */
  executionOrder: string[][];
  integrity: PlanIntegrity;
  cycleTasks: string[]; // the residual set Kahn could not order. [] unless "cycle"
  warnings: PlanWarning[];
  raw: string;
  partial: boolean;
}

const PLAN_OPEN = "===COAI EXECUTION PLAN===";
const PLAN_CLOSE = "===END PLAN===";

/** Sections TMAP is always asked to emit a header for — total absence (not
 *  just an empty list) is what marks a plan `partial`, mirroring RAA's
 *  REQUIRED_HEADERS rule. */
const REQUIRED_PLAN_HEADERS = ["Strategy", "Tasks", "Risks"];

export const TMAP_BASE_MAX_TOKENS = 1100; // kept in sync with plannerStage.baseMaxTokens in model-workflow.ts
export const TMAP_TEMPERATURE = 0.25; // planning wants determinism even more than RAA's extraction

export const TMAP_SYSTEM = `You are Co.AI's Task Multi-Agent Planning Engine (TMAP, Master Prompt Part 5.4). Your ONLY job is to transform an already-analyzed request into an executable engineering plan.

YOU MUST NEVER:
- Generate production code, code snippets, or file contents
- Edit or claim to edit any repository
- Produce the final answer shown to the user
- Assign a task to any agent not in the roster below

YOU MUST:
- Break the request into concrete, independently-executable tasks (skip this entirely — zero tasks — only for a request so small a single streamed answer already covers it)
- Give each task a short id-free title, a one-line description, and an agent assignment from the roster below
- Declare each task's dependencies as other task ids, or "none" — dependencies must form a DAG (no task may depend on itself or complete a cycle)
- Give each task a priority (critical/high/medium/low) and complexity (simple/medium/complex) when you can honestly estimate them — omit the field entirely rather than guess
- State each task's expected output, how it should be validated, and its success criteria
- Identify planning risks, each with impact (High/Medium/Low), likelihood (High/Medium/Low), and a mitigation
- Give a Plan Confidence (0-100%) for the plan as a whole. Omit the line entirely if you cannot honestly estimate one — never invent a number.

AGENT ROSTER — you may ONLY assign tasks to these:
${agentRosterForPrompt()}

OUTPUT FORMAT — emit ONLY this block, with no text before or after it:

${PLAN_OPEN}
Strategy: <one line describing the overall approach>
Tasks:
- TASK-001 | title: <short title> | agent: <agent id from the roster> | depends: none | priority: high | complexity: medium | desc: <one line> | output: <what this task produces> | validation: <how to check it> | success: <criteria>
- TASK-002 | title: <short title> | agent: <agent id> | depends: TASK-001 | priority: medium | complexity: simple | desc: <one line> | output: <...> | validation: <...> | success: <...>
Risks:
- <description> | impact: High|Medium|Low | likelihood: High|Medium|Low | mitigation: <mitigation>
Plan Confidence: <0-100>%
${PLAN_CLOSE}

Keep every header even when its list is empty. List task dependencies by exact id ("TASK-001"), comma-separated if more than one, or "none". Be terse — this plan is never shown to the user directly.`;

export function buildTmapMessage(input: {
  message: string;
  spec: RequirementSpec;
  decision: TaskDecision;
  repo?: RepoMetadata;
}): string {
  const lines: string[] = [`Request to plan:\n${input.message}`];

  if (input.spec.functional.length) {
    lines.push("\nFunctional Requirements:", ...input.spec.functional.map((f) => `- ${f.id}: ${f.text}`));
  }
  if (input.spec.nonFunctional.length) {
    lines.push("\nNon-Functional Requirements:", ...input.spec.nonFunctional.map((f) => `- ${f.id}: ${f.text}`));
  }
  if (input.spec.constraints.length) {
    lines.push("\nConstraints:", ...input.spec.constraints.map((c) => `- ${c}`));
  }
  if (input.spec.acceptanceCriteria.length) {
    lines.push("\nAcceptance Criteria:", ...input.spec.acceptanceCriteria.map((c) => `- ${c}`));
  }
  if (!input.spec.readyForPlanning) {
    lines.push(
      "\n(Note: the Requirement Analysis stage marked this request NOT ready for planning — plan around the " +
        "Missing Information below as best you can; do not block.)",
      ...input.spec.missingInformation.map((m) => `- ${m}`),
    );
  }
  if (input.repo) {
    lines.push(`\nWorkspace context: ${input.repo.fileCount} file(s), languages: ${input.repo.languages.join(", ") || "unknown"}.`);
  }
  lines.push(
    `\n(Task Classifier: category=${input.decision.category}, complexity=${input.decision.complexity} — for context only, do not repeat this in your output.)`,
  );
  return lines.join("\n");
}

// ── Parsing — reuses requirement-analysis.ts's line-walk helpers, NEVER throws ─

function normalizeTaskId(raw: string): string | null {
  const m = raw.trim().match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `TASK-${String(n).padStart(3, "0")}`;
}

function fieldsOf(parts: string[]): (key: string) => string | undefined {
  return (key: string) => {
    const p = parts.find((p) => p.toLowerCase().startsWith(`${key}:`));
    return p ? p.slice(p.indexOf(":") + 1).trim() : undefined;
  };
}

const PRIORITY_VALUES = new Set<TaskPriority>(["critical", "high", "medium", "low"]);
function parsePriority(raw: string | undefined): TaskPriority | null {
  const norm = (raw ?? "").trim().toLowerCase();
  return (PRIORITY_VALUES as Set<string>).has(norm) ? (norm as TaskPriority) : null;
}

const COMPLEXITY_VALUES = new Set<TaskComplexityLevel>(["simple", "medium", "complex"]);
function parseComplexity(raw: string | undefined): TaskComplexityLevel | null {
  const norm = (raw ?? "").trim().toLowerCase();
  return (COMPLEXITY_VALUES as Set<string>).has(norm) ? (norm as TaskComplexityLevel) : null;
}

function parseTaskLine(raw: string, warnings: PlanWarning[], seenIds: Set<string>): PlannedTask | null {
  const parts = raw.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    warnings.push({ kind: "unparsable-task-line", detail: raw });
    return null;
  }

  const id = normalizeTaskId(parts[0]);
  if (!id) {
    warnings.push({ kind: "unparsable-task-line", detail: raw });
    return null;
  }
  if (seenIds.has(id)) {
    warnings.push({ kind: "duplicate-task-id", taskId: id, detail: raw });
    return null;
  }
  seenIds.add(id);

  const get = fieldsOf(parts.slice(1));
  const agentRaw = get("agent");
  const { id: agent, source: agentSource } = resolveAgent(agentRaw);
  if (agentSource === "fallback" && agentRaw && agentRaw.trim()) {
    warnings.push({ kind: "unknown-agent", taskId: id, detail: `${id} named "${agentRaw.trim()}"` });
  }

  const dependsRaw = get("depends") ?? "none";
  const dependsOn =
    !dependsRaw.trim() || dependsRaw.trim().toLowerCase() === "none"
      ? []
      : dependsRaw
          .split(",")
          .map((d) => normalizeTaskId(d))
          .filter((d): d is string => d !== null);

  return {
    id,
    title: get("title") ?? "",
    description: get("desc") ?? "",
    agent,
    agentSource,
    dependsOn,
    priority: parsePriority(get("priority")),
    complexity: parseComplexity(get("complexity")),
    expectedOutput: get("output") ?? "",
    validationMethod: get("validation") ?? "",
    successCriteria: get("success") ?? "",
  };
}

/** Second pass, once every task id is known: drop a dependency edge that
 *  targets a nonexistent task (never drop the task itself — that would
 *  throw away real work over what the model probably typo'd), and drop a
 *  self-dependency edge. Both are warned, never silent. */
function resolveDependencies(tasks: PlannedTask[], warnings: PlanWarning[]): void {
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const kept: string[] = [];
    for (const dep of t.dependsOn) {
      if (dep === t.id) {
        warnings.push({ kind: "self-dependency", taskId: t.id, detail: `${t.id} depends on itself` });
        continue;
      }
      if (!ids.has(dep)) {
        warnings.push({ kind: "dangling-dependency", taskId: t.id, detail: `${t.id} -> ${dep}` });
        continue;
      }
      kept.push(dep);
    }
    t.dependsOn = kept;
  }
}

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
/** null-priority tasks sort last within a wave, deterministically by id —
 *  ordering comes from the DAG, so a missing priority only breaks ties. */
function priorityRank(p: TaskPriority | null): number {
  return p === null ? 4 : PRIORITY_RANK[p];
}
function compareForWave(a: PlannedTask, b: PlannedTask): number {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  return byPriority !== 0 ? byPriority : a.id.localeCompare(b.id);
}

/** Kahn's algorithm — the execution order is always DERIVED here, never read
 *  from the model even if it emitted one. A residual (some indegree never
 *  reaches 0) means a cycle: rather than break an arbitrary edge to force an
 *  order — fabricating a plan the planner never produced — orchestration is
 *  simply not run; the streamed model gets the plan plus the cycle warning
 *  and re-derives its own order. */
export function buildExecutionOrder(
  tasks: PlannedTask[],
): { order: string[][]; integrity: PlanIntegrity; cycleTasks: string[] } {
  if (tasks.length === 0) return { order: [], integrity: "empty", cycleTasks: [] };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, t.dependsOn.length);
    for (const dep of t.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(t.id);
    }
  }

  const order: string[][] = [];
  const resolved = new Set<string>();
  let frontier = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);

  while (frontier.length > 0) {
    frontier.sort((a, b) => compareForWave(byId.get(a)!, byId.get(b)!));
    order.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      resolved.add(id);
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    frontier = next;
  }

  if (resolved.size < tasks.length) {
    const cycleTasks = tasks.map((t) => t.id).filter((id) => !resolved.has(id));
    return { order: [], integrity: "cycle", cycleTasks };
  }

  return { order, integrity: "ok", cycleTasks: [] };
}

function emptyPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    strategy: "",
    tasks: [],
    risks: [],
    planConfidence: null,
    executionOrder: [],
    integrity: "empty",
    cycleTasks: [],
    warnings: [],
    raw: "",
    partial: true,
    ...overrides,
  };
}

/** Tolerant, line-walk parser. NEVER throws — any internal failure degrades
 *  to an empty, `partial: true` plan rather than propagating (mirrors
 *  parseRequirementSpec's discipline). */
export function parseExecutionPlan(text: string): ExecutionPlan {
  try {
    const openIdx = text.indexOf(PLAN_OPEN);
    if (openIdx === -1) return emptyPlan();

    const bodyStart = openIdx + PLAN_OPEN.length;
    const closeIdx = text.indexOf(PLAN_CLOSE, bodyStart);
    const hasClose = closeIdx !== -1;
    const block = hasClose ? text.slice(bodyStart, closeIdx) : text.slice(bodyStart);
    const lines = block.split("\n");

    const strategy = lineValue(lines, "Strategy");
    const taskLines = listUnder(lines, "Tasks");
    const warnings: PlanWarning[] = [];
    const seenIds = new Set<string>();
    const tasks: PlannedTask[] = [];
    for (const raw of taskLines) {
      const task = parseTaskLine(raw, warnings, seenIds);
      if (task) tasks.push(task);
    }
    resolveDependencies(tasks, warnings);

    const risks = parseRisks(lines);
    const planConfidence = parsePercent(lineValue(lines, "Plan Confidence"));
    const missingRequiredHeader = REQUIRED_PLAN_HEADERS.some((h) => !hasHeader(lines, h));
    const partial = !hasClose || missingRequiredHeader;

    if (tasks.length === 0) {
      return {
        strategy,
        tasks: [],
        risks,
        planConfidence,
        executionOrder: [],
        integrity: "empty",
        cycleTasks: [],
        warnings,
        raw: block.trim(),
        partial: true,
      };
    }

    const { order, integrity, cycleTasks } = buildExecutionOrder(tasks);

    return {
      strategy,
      tasks,
      risks,
      planConfidence,
      executionOrder: order,
      integrity,
      cycleTasks,
      warnings,
      raw: block.trim(),
      partial,
    };
  } catch {
    return emptyPlan();
  }
}

// ── System-prompt consumption ─────────────────────────────────────────────────

function bulletList(label: string, items: string[]): string {
  return `${label}:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** Fold a plan into the streamed generation's system prompt for the case
 *  where orchestration did NOT run (single task, cycle, or the plan simply
 *  isn't being executed this turn) — the streamed model follows the plan
 *  itself rather than artifacts produced from it. */
export function executionPlanSystemAddon(plan: ExecutionPlan): string {
  const lines: string[] = [
    "── Co.AI Execution Plan (internal) ──",
    "A planning stage already ran for this request. Use it to structure your answer. Never mention this " +
      "plan, its section names, its markers, or that a planning stage ran.",
  ];

  if (plan.strategy) lines.push(`Strategy: ${plan.strategy}`);

  if (plan.tasks.length) {
    lines.push(
      bulletList(
        "Planned tasks",
        plan.tasks.map(
          (t) =>
            `${t.id} (${t.agent}): ${t.title || t.description || "(untitled)"}` +
            (t.dependsOn.length ? ` — depends on ${t.dependsOn.join(", ")}` : ""),
        ),
      ),
    );
  }

  if (plan.integrity === "cycle") {
    lines.push(
      `The plan's dependencies contain a cycle among: ${plan.cycleTasks.join(", ")}. Re-derive a sensible ` +
        "order yourself rather than relying on the declared dependencies for those tasks.",
    );
  }

  if (plan.risks.length) {
    lines.push(
      bulletList(
        "Risks",
        plan.risks.map((r) => `${r.description} (impact: ${r.impact}, likelihood: ${r.likelihood}) — mitigation: ${r.mitigation}`),
      ),
    );
  }

  return lines.join("\n\n");
}

/** System addon used when the buffered TMAP call itself failed, or returned
 *  an empty/unusable plan. Honest degradation: never fabricates a plan. */
export function planUnavailableAddon(): string {
  return (
    "── Co.AI Execution Plan (internal) ──\n\n" +
    "The planning stage could not produce a usable plan for this turn. Proceed directly from the " +
    "requirement analysis above, structuring your own approach. Never mention this note, this stage, or " +
    "that planning was attempted."
  );
}
