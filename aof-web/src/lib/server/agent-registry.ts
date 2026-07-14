// ── Agent Registry — Co.AI Master Prompt Part 5.6 ────────────────────────────
// Single source of truth for every engineering agent Ypertatos's orchestrator
// (orchestrator.ts) can assign a task to, and every agent name TMAP
// (execution-plan.ts) is allowed to reference. Mirrors model-registry.ts's
// shape (a const table + lookups) for the same reason: a routing decision
// deserves one declared table, not scattered string literals.
//
// The roster is exactly the names Parts 5.1-5.3 reserved in
// YPERTATOS_RESERVED_STAGES (model-workflow.ts) as agent ids, not stages —
// they were never meant to be a second set of workflow stages, and moving
// them here is what lets that reservation shrink to just "consensus".
//
// Every agent produces ONE text engineering artifact (schema, endpoint code,
// component code, findings) — never a repo write. /api/chat has no write
// surface, so "the agent modified the repo" is not a claim any persona here
// is allowed to make; AGENT_CONTRACT below says so explicitly, in every
// agent's system prompt, not just documentation.

import type { ProviderId } from "./ai-providers";
import { routeOrder, type TaskCategory } from "./model-registry";

export type AgentId =
  | "architect"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "testing"
  | "documentation"
  | "reviewer"
  | "validator"
  | "general";

export type AgentCapability =
  | "system-design"
  | "ui"
  | "api"
  | "schema"
  | "security"
  | "tests"
  | "docs"
  | "code-review"
  | "verification"
  | "general";

export interface AgentDef {
  id: AgentId;
  /** Reused as the StageNotice label prefix, e.g. "Backend Agent — TASK-002". */
  label: string;
  /** One line describing when TMAP should assign this agent — rendered
   *  verbatim into TMAP_SYSTEM's roster so the planner can only ever pick a
   *  real, declared agent. */
  purpose: string;
  capabilities: AgentCapability[];
  /** The ONE place agent → provider chain is decided: routeOrder(task) from
   *  model-registry.ts. No second routing source of truth — a test asserts
   *  routeOrder(def.task) is non-empty for every agent, so this field can
   *  never become decoration nobody reads. */
  task: TaskCategory;
  /** The agent-specific half of its system prompt. buildAgentSystem() always
   *  prepends AGENT_CONTRACT — the shared no-repo-writes / no-fabrication
   *  rules every agent obeys regardless of persona. */
  persona: string;
  baseMaxTokens: number;
  temperature: number;
}

export const AGENT_REGISTRY: Record<AgentId, AgentDef> = {
  architect: {
    id: "architect",
    label: "Architect Agent",
    purpose: "System design, architecture decisions, and API contracts spanning multiple components",
    capabilities: ["system-design", "api"],
    task: "reasoning",
    persona:
      "You are Co.AI's Architect Agent. You design system architecture and API contracts — module " +
      "boundaries, data flow, and how components fit together. You do not write full implementations; " +
      "you produce a structured design (interfaces, contracts, key decisions with brief rationale) that " +
      "other agents' implementations must conform to.",
    baseMaxTokens: 700,
    temperature: 0.4,
  },
  frontend: {
    id: "frontend",
    label: "Frontend Agent",
    purpose: "UI components, client-side state, and user-facing interaction logic",
    capabilities: ["ui"],
    task: "coding",
    persona:
      "You are Co.AI's Frontend Agent. You write UI components and client-side logic — real, runnable " +
      "code for the task assigned to you, consistent with any upstream architecture or API contract you " +
      "were given.",
    baseMaxTokens: 700,
    temperature: 0.45,
  },
  backend: {
    id: "backend",
    label: "Backend Agent",
    purpose: "Server-side endpoints, business logic, and integration code",
    capabilities: ["api", "system-design"],
    task: "coding",
    persona:
      "You are Co.AI's Backend Agent. You write server-side endpoints and business logic — real, " +
      "runnable code for the task assigned to you, consistent with any upstream architecture or API " +
      "contract you were given.",
    baseMaxTokens: 700,
    temperature: 0.4,
  },
  database: {
    id: "database",
    label: "Database Agent",
    purpose: "Schema design, migrations, and query/index design",
    capabilities: ["schema"],
    task: "coding",
    persona:
      "You are Co.AI's Database Agent. You design schemas, migrations, and queries/indexes for the task " +
      "assigned to you. State every table, column, type, and constraint explicitly — never leave a " +
      "schema decision implicit.",
    baseMaxTokens: 600,
    temperature: 0.35,
  },
  security: {
    id: "security",
    label: "Security Agent",
    purpose: "Threat review, auth/authorization design, and vulnerability findings",
    capabilities: ["security"],
    task: "reasoning",
    persona:
      "You are Co.AI's Security Agent. You review the task assigned to you for security concerns — " +
      "authentication, authorization, injection, data exposure — and report concrete findings with " +
      "severity and a fix, not generic advice.",
    baseMaxTokens: 600,
    temperature: 0.3,
  },
  testing: {
    id: "testing",
    label: "Testing Agent",
    purpose: "Test plans and test code covering the task's acceptance criteria",
    capabilities: ["tests", "verification"],
    task: "coding",
    persona:
      "You are Co.AI's Testing Agent. You write tests (or a precise test plan when no test framework is " +
      "known) that verify the task assigned to you actually satisfies its acceptance criteria — including " +
      "the edge cases a happy-path test would miss.",
    baseMaxTokens: 600,
    temperature: 0.35,
  },
  documentation: {
    id: "documentation",
    label: "Documentation Agent",
    purpose: "User-facing or developer-facing documentation for what was built",
    capabilities: ["docs"],
    task: "chat",
    persona:
      "You are Co.AI's Documentation Agent. You write clear, accurate documentation for the task assigned " +
      "to you — only what it actually does, never what a full product might eventually do.",
    baseMaxTokens: 500,
    temperature: 0.5,
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer Agent",
    purpose: "Cross-task consistency and code-quality review once other artifacts exist",
    capabilities: ["code-review"],
    task: "reasoning",
    persona:
      "You are Co.AI's Reviewer Agent. You review the artifacts produced by the tasks you depend on for " +
      "correctness, consistency, and quality, and report concrete findings — never a vague approval.",
    baseMaxTokens: 600,
    temperature: 0.35,
  },
  validator: {
    id: "validator",
    label: "Validator Agent",
    purpose: "Checking a task's output against its own stated success criteria",
    capabilities: ["verification"],
    task: "reasoning",
    persona:
      "You are Co.AI's Validator Agent. You check whether the artifacts you depend on satisfy their " +
      "task's stated success criteria, and report exactly which criteria pass, fail, or can't be verified " +
      "from the artifact alone.",
    baseMaxTokens: 500,
    temperature: 0.3,
  },
  general: {
    id: "general",
    label: "General Engineering Agent",
    purpose: "Fallback for any task that doesn't fit a more specific agent, or an unrecognized agent name",
    capabilities: ["general"],
    task: "coding",
    persona:
      "You are Co.AI's General Engineering Agent. You handle the task assigned to you directly and " +
      "practically, producing whatever artifact (code, design notes, findings) the task actually calls for.",
    baseMaxTokens: 700,
    temperature: 0.45,
  },
};

export const AGENT_IDS: AgentId[] = [
  "architect",
  "frontend",
  "backend",
  "database",
  "security",
  "testing",
  "documentation",
  "reviewer",
  "validator",
  "general",
];

/** Declared aliases only — never a fuzzy match, so a resolution can always be
 *  explained. Common shorthand a model might emit instead of the exact id. */
const AGENT_ALIASES: Record<string, AgentId> = {
  db: "database",
  test: "testing",
  tests: "testing",
  qa: "testing",
  docs: "documentation",
  doc: "documentation",
  review: "reviewer",
  ui: "frontend",
  client: "frontend",
  api: "backend",
  server: "backend",
  sec: "security",
  validate: "validator",
  validation: "validator",
  fallback: "general",
};

/** NEVER invents an agent — mirrors requirement-analysis.ts's
 *  readyForPlanningSource precedent: unknown / absent / whitespace resolves
 *  to "general" with source:"fallback", so a log can never claim TMAP chose
 *  an agent it did not choose. */
export function resolveAgent(raw: string | undefined): { id: AgentId; source: "model" | "fallback" } {
  const norm = (raw ?? "").trim().toLowerCase();
  if (!norm) return { id: "general", source: "fallback" };
  if ((AGENT_IDS as string[]).includes(norm)) return { id: norm as AgentId, source: "model" };
  const aliased = AGENT_ALIASES[norm];
  if (aliased) return { id: aliased, source: "model" };
  return { id: "general", source: "fallback" };
}

/** One line per agent, in registry order — embedded in TMAP_SYSTEM so the
 *  planner is only ever shown real, declared agents to assign work to. */
export function agentRosterForPrompt(): string {
  return AGENT_IDS.map((id) => `- ${id}: ${AGENT_REGISTRY[id].purpose}`).join("\n");
}

const AGENT_CONTRACT = `You produce exactly ONE text engineering artifact for the single task assigned to you below. You cannot write files, run commands, execute code, or modify any repository — you have no such access. Never claim or imply that you did.

Never invent a file path, API, database table, dependency, or fact you were not given in the task description, the requirement spec, or the artifacts of the tasks you depend on.

Emit ONLY the block below, with no text before or after it:

===COAI ARTIFACT===
Title: <one line>
<the artifact itself — schema, endpoint code, component code, or findings, as appropriate to your role>
===END ARTIFACT===`;

/** Every agent's real system prompt = its persona + the shared contract.
 *  The contract is never optional and never per-agent — one rule set, not
 *  ten copies that could drift. */
export function buildAgentSystem(def: AgentDef): string {
  return `${def.persona}\n\n${AGENT_CONTRACT}`;
}

/** The provider chain a given agent's call should try, in order — routes
 *  through the same model-registry.ts routeOrder() the rest of the app
 *  uses, keyed off the agent's declared task category. */
export function agentProviderOrder(def: AgentDef): ProviderId[] {
  return routeOrder(def.task);
}
