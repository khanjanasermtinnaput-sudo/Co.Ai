// Shared contracts for TMAP v2 (see AOF_CODE_TDD.md §4.1)

export type Role = 'planner' | 'coder' | 'reviewer' | 'validator';
export type Mode = 'lite' | 'normal' | 'pro';

// ── AOF AI Universal Orchestration System types ───────────────────────────────

export type TaskCategory =
  | 'coding'
  | 'image_generation'
  | 'image_editing'
  | 'research'
  | 'writing'
  | 'mathematics'
  | 'science'
  | 'data_analysis'
  | 'education'
  | 'business'
  | 'translation'
  | 'ui_design'
  | 'ux_design'
  | 'product_design'
  | 'video'
  | 'audio'
  | 'multi_step';

export type AgentType = 'coding' | 'research' | 'writing' | 'math' | 'vision' | 'chief';

export interface ChiefPlan {
  intent: string;
  categories: TaskCategory[];
  agents: AgentType[];
  subtasks: string[];
  strategy: string;
  expandedPrompt: string;
}

export interface QualityScore {
  score: number; // 0-100
  issues: string[];
  passed: boolean; // score >= 90
}

export interface OrchestrationResult {
  response: string;
  categories: TaskCategory[];
  agentsUsed: AgentType[];
  qualityScore: number;
  iterations: number;
}

export interface ResearchResult {
  answer: string;
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface WritingResult {
  content: string;
  wordCount: number;
  tone: string;
}

export interface MathResult {
  solution: string;
  steps: string[];
  verified: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Options passed to a single LLM call. `signal` lets DARS enforce a timeout.
export interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

// What an agent calls to talk to a model. The orchestrator injects an
// implementation backed by DARS (failover/health), so agents stay model-agnostic.
export type LLMCall = (messages: ChatMessage[], opts?: ChatOpts) => Promise<string>;

export interface ResolvedProvider {
  role: Role;
  providerName: string; // 'Gemini' | 'DeepSeek' | ...
  baseURL: string;
  apiKey: string;
  model: string;
  mode: 'direct' | 'openrouter' | 'fallback' | 'mock';
}

export interface PlanStep {
  file: string;
  action: 'create' | 'modify' | 'delete';
  intent: string;
}

export interface ReviewIssue {
  severity: 'HIGH' | 'MED' | 'LOW';
  file?: string;
  message: string;
}

export interface ValidationResult {
  kind: 'syntax' | 'skipped' | 'runtime';
  passed: boolean;
  logs: string;
}

export interface CodeFile {
  path: string;
  language: string;
  content: string;
}

// Session phase for the two-mode system (TDD §5 — Planning → Generation).
export type SessionPhase = 'planning' | 'generation';

// Structured metadata produced by the Context Engine v2 (core/context-engine.ts).
export interface ContextMeta {
  projectType: string;
  relevantFiles: string[];
  conventions: string[];
  fileCount: number;
}

// Architect Agent output (core/architect.ts) — the design stage before planning.
export interface ArchitectDecision {
  approach: string;        // short design approach / pattern
  newFiles: string[];      // files that should be created
  modifyFiles: string[];   // existing files that should be modified
  risks: string[];         // architectural concerns flagged up-front
  techStack: string;
  raw: string;
}

// Impact Analysis Engine output (core/impact.ts).
export interface ImpactRisk {
  file: string;
  level: 'high' | 'med' | 'low';
  reason: string;
  affects: string[];       // files that import / depend on this one
}

export interface ImpactReport {
  risks: ImpactRisk[];
  affectedFiles: string[];
  summary: string;
  skipped?: boolean;       // true when there was no dependency graph to analyse
}

// The Blackboard — shared working memory every agent reads/writes.
export interface Blackboard {
  sessionId: string;
  task: string;
  mode: Mode;
  context: string;
  contextMeta?: ContextMeta;
  architect?: ArchitectDecision;  // design stage output
  impact?: ImpactReport;          // pre-flight risk analysis
  docs?: CodeFile[];              // generated documentation files
  plan: PlanStep[];
  planText: string;
  files: CodeFile[];
  review: ReviewIssue[];
  reviewText: string;
  validations: ValidationResult[];
  iterations: number;
  log: AgentEvent[];
  agentRuns?: AgentRun[];   // which provider actually served each agent call (DARS)
  failureNotes?: string[];  // L4: validation/review failures seen this run (fed to memory)
}

// Record of one agent call after DARS resolution (TDD §5.3 / §8 agent_logs).
export interface AgentRun {
  role: Role;
  provider: string;  // provider that actually produced the result
  model: string;
  attempts: number;  // 0 = first choice worked; >0 = failover happened
  ts: number;
}

export interface AgentEvent {
  ts: number;
  role: Role | 'system';
  type: 'status' | 'output' | 'validation' | 'error';
  text: string;
}

// Session record stored in db.json
export interface SessionRecord {
  id: string;
  userId: string;
  task: string;
  mode: Mode;
  status: 'running' | 'done' | 'error';
  filesCount: number;
  iterations: number;
  costUsd: number;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
  summary?: string; // short one-line summary of what was built
}

// Per-agent-call log entry
export interface AgentLog {
  id: string;
  sessionId: string;
  role: Role;
  provider: string;
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  ts: string;
}

// Cost tracking per user
export interface CostRecord {
  userId: string;
  totalCostUsd: number;
  totalTokens: number;
  sessionCount: number;
  updatedAt: string;
}
