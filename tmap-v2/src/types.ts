// Shared contracts for TMAP v2 (see AOF_CODE_TDD.md §4.1)

export type Role = 'planner' | 'coder' | 'reviewer' | 'validator';
export type Mode = 'lite' | 'normal' | 'pro';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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
  kind: 'syntax' | 'skipped';
  passed: boolean;
  logs: string;
}

export interface CodeFile {
  path: string;
  language: string;
  content: string;
}

// The Blackboard — shared working memory every agent reads/writes.
export interface Blackboard {
  sessionId: string;
  task: string;
  mode: Mode;
  context: string;
  plan: PlanStep[];
  planText: string;
  files: CodeFile[];
  review: ReviewIssue[];
  reviewText: string;
  validations: ValidationResult[];
  iterations: number;
  log: AgentEvent[];
}

export interface AgentEvent {
  ts: number;
  role: Role | 'system';
  type: 'status' | 'output' | 'validation' | 'error';
  text: string;
}
