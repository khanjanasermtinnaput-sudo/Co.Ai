// Shared contracts for TMAP v2 (see COAGENTIX_TDD.md §4.1)

export type Role = 'planner' | 'coder' | 'reviewer' | 'validator';
export type Mode = 'lite' | 'normal' | 'pro';

// ── Coagentix Universal Orchestration System types ───────────────────────────

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
  // Cost monitor metrics for the whole orchestration (Round 1 #8).
  tokensUsed?: number;
  estimatedCostUsd?: number;
  llmCalls?: number;
  // True when a cost/token/call ceiling stopped the run early (partial result).
  budgetExceeded?: boolean;
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

// Multimodal message parts (OpenAI-compatible). Used ONLY by the Vision pipeline
// to send an image alongside text to a vision-capable model. Kept separate from
// ChatMessage so every existing text-only agent/call site stays unaffected.
export interface TextContentPart {
  type: 'text';
  text: string;
}
export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}
export type ContentPart = TextContentPart | ImageContentPart;

export interface MultimodalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

// What the OpenAI-compatible client accepts — text-only or multimodal messages.
export type AnyMessage = ChatMessage | MultimodalMessage;

// Options passed to a single LLM call. `signal` lets DARS enforce a timeout.
export interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

// Provider-reported token usage for ONE call. Present only when the upstream API
// returns a `usage` block (all OpenAI-compatible vendors here do). When absent,
// callers fall back to a char/4 estimate — so cost numbers are exact when the
// provider gives them and approximate only as a last resort.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
  // Wire protocol for providers/client.ts to speak. Omitted (default) = the
  // shared OpenAI-compatible /chat/completions shape every existing vendor uses.
  // 'anthropic' = Anthropic's native Messages API (/v1/messages), which is NOT
  // OpenAI-compatible — different auth header and request/response shape.
  // OpenRouter-routed candidates never set this: OpenRouter itself always
  // exposes an OpenAI-compatible endpoint, even for Anthropic-hosted models.
  protocol?: 'openai' | 'anthropic';
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
  kind: 'syntax' | 'skipped';
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

// ── Phase 4: AI Intelligence types ───────────────────────────────────────────

// Summary of one hallucination detection pass (core/hallucination-detector.ts)
export interface Phase4HallucinationSummary {
  detected: boolean;
  issueCount: number;
  confidence: number;
  summary: string;
}

// Summary of one verification pass (core/verifier-agent.ts)
export interface Phase4VerificationSummary {
  passed: boolean;
  issueCount: number;
  summary: string;
}

// One reflection note from a failed iteration (core/reflection.ts)
export interface Phase4ReflectionNote {
  iterationNum: number;
  rootCause: string;
  patternTag: string;
  coachingHint: string;
  ts: number;
}

// Lightweight eval report stored on the blackboard (full report in eval-framework.ts)
export interface Phase4EvalSummary {
  overallScore: number;
  grade: string;
  passed: boolean;
  summary: string;
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
  // ── Phase 4 fields (all optional — won't break existing flows) ──────────────
  p4Hallucination?: Phase4HallucinationSummary;
  p4Verification?: Phase4VerificationSummary;
  p4Reflections?: Phase4ReflectionNote[];
  p4Eval?: Phase4EvalSummary;
  p4SelfCritiqueNotes?: string[];
  // Ypertatos Extreme only (Master Prompt Part 5.11): Self Reflection Engine's
  // read-only inspection report, produced after Validator and before Review.
  selfReflection?: EngineeringReflectionReport;
}

// Self Reflection Engine (Ypertatos Extreme, Master Prompt Part 5.11) — a
// read-only structural inspection report. See core/self-reflection.ts.
export type ReflectionCategory =
  | 'requirement-coverage'
  | 'architecture'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'scalability'
  | 'reliability'
  | 'readability'
  | 'documentation'
  | 'testing';

export type ReflectionSeverity = 'info' | 'warning' | 'critical';

export interface ReflectionFinding {
  category: ReflectionCategory;
  file: string;
  line?: number;
  severity: ReflectionSeverity;
  message: string;
}

export interface EngineeringReflectionReport {
  findings: ReflectionFinding[];
  categoriesCovered: ReflectionCategory[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  summary: string;
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

// ── Phase 5: Sandbox & Developer Platform ─────────────────────────────────────

export type SandboxLanguage = 'javascript' | 'typescript' | 'python' | 'bash';

export interface SandboxInputFile {
  path: string;
  content: string;
}

export interface SandboxOptions {
  language: SandboxLanguage;
  code: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  files?: SandboxInputFile[];
}

export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  language: SandboxLanguage;
  filesCreated?: string[];
  error?: string;
}

export interface UsageQuota {
  dailyTokens: number;
  monthlyTokens: number;
  dailyCostUsd: number;
  monthlyCostUsd: number;
  sandboxRunsPerDay: number;
}

export interface UsagePeriod {
  tokens: number;
  costUsd: number;
  requests: number;
  sandboxRuns: number;
}

export interface QuotaStatus {
  ok: boolean;
  reason?: string;
  daily: UsagePeriod;
  monthly: { tokens: number; costUsd: number; requests: number };
  quota: UsageQuota;
}

// ── Phase 6: Scale & Enterprise ───────────────────────────────────────────────

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';
export interface Team {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
export interface TeamMember {
  teamId:   string;
  userId:   string;
  role:     TeamRole;
  joinedAt: string;
}

export type OrgPlan = 'free' | 'pro' | 'enterprise';
export interface Organization {
  id:         string;
  name:       string;
  slug:       string;
  plan:       OrgPlan;
  ownerId:    string;
  ssoEnabled: boolean;
  createdAt:  string;
  updatedAt:  string;
}

export type PermissionRole   = 'superadmin' | 'org_admin' | 'team_admin' | 'member' | 'viewer';
export type ResourceType     = 'org' | 'team' | 'session' | 'key' | 'usage' | 'analytics' | 'backup';
export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'execute' | 'admin';

export type BackupStatus = 'pending' | 'running' | 'complete' | 'failed';
export interface BackupManifest {
  id:           string;
  createdAt:    string;
  sizeBytes:    number;
  tables:       string[];
  recordCounts: Record<string, number>;
  checksum:     string;
  encrypted:    boolean;
  status:       BackupStatus;
  error?:       string;
}

export interface AnalyticsEvent {
  eventType:   string;
  userId?:     string;
  teamId?:     string;
  orgId?:      string;
  properties:  Record<string, unknown>;
  ts:          string;
}

export interface AnalyticsSummary {
  period:            'day' | 'week' | 'month';
  from:              string;
  to:                string;
  activeUsers:       number;
  totalSessions:     number;
  totalTokens:       number;
  totalCostUsd:      number;
  topFeatures:       Array<{ feature: string; count: number }>;
  providerBreakdown: Array<{ provider: string; tokens: number; costUsd: number }>;
}

export type CircuitState = 'closed' | 'open' | 'half-open';
export interface CircuitBreakerState {
  name:           string;
  state:          CircuitState;
  failures:       number;
  successes:      number;
  lastFailureAt?: string;
  openedAt?:      string;
  nextAttemptAt?: string;
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus   = 'open' | 'investigating' | 'mitigated' | 'resolved';
export interface Incident {
  id:               string;
  title:            string;
  severity:         IncidentSeverity;
  status:           IncidentStatus;
  affectedServices: string[];
  openedAt:         string;
  resolvedAt?:      string;
  notes:            string[];
}
