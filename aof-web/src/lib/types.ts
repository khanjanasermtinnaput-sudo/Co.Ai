// ── Domain types shared across the Co.AI frontend ────────────────────────────

import type { AofProviderError, FailoverNotice, ModelNotice, SourcesNotice, UsageNotice } from "./errors";

/** Top-level products surfaced in the sidebar. Titan is intentionally absent —
 *  it is a mode *inside* CoCode, never a product on the homepage. */
export type ProductKey = "chat" | "code" | "projects" | "settings";

/** Chat models shown in the chat header selector. */
export type ChatModel = "lite" | "normal";

/** CoCode modes. `titan` only appears inside the Code workspace. */
export type CodeMode = "lite" | "1.0" | "pro" | "titan";

/** The tier a request may ask the server to STAGE (model-workflow.ts's
 *  stagesFor()). Superset of ChatModel: CoCode's code-chat path may also
 *  request "pro" (Ypertatos) — reachable ONLY from there, never from
 *  CoChat's header selector, which stays typed ChatModel. "titan" is
 *  excluded — it has its own workflow and never reaches /api/chat's staging
 *  path. ChatModel is structurally assignable to this, so CoChat's existing
 *  call sites need no change. */
export type WorkflowModelId = "lite" | "normal" | "pro";

/** CoCode's open workspace, as seen by the Ypertatos Task Classifier
 *  (task-classifier.ts) — its "attached files / repo metadata" input. Defined
 *  here (not in lib/server/) since api.ts (client-safe) also needs the shape
 *  to send it in the request body; task-classifier.ts re-exports this same
 *  type rather than redefining it. */
export interface RepoMetadata {
  fileCount: number;
  /** distinct file extensions present, lowercased, no dot. */
  languages: string[];
}

/** Reasoning-effort dial shown in the model menus.
 *  Low / Normal / High belong to Mikros & Kanon; Ultra / Extreme are
 *  Ypertatos-only. Titan has no dial — it is gated by its own workflow. */
export type EffortLevel = "low" | "normal" | "high" | "ultra" | "extreme";

export type Role = "user" | "assistant" | "system";

/** Where the router sends a request. Users never choose this directly. */
export type RouteTarget = "chat" | "code" | "search";

export interface RouteDecision {
  target: RouteTarget;
  /** Human label shown on the routed reply, e.g. "CoCode". */
  label: string;
  /** Short why-this-route explanation surfaced in the UI. */
  reason: string;
  /** Routing confidence 0–100. Low values mean the signal was weak. */
  confidence?: number;
}

/** Kinds of files the multimodal composer accepts. */
export type AttachmentKind = "image" | "code" | "document";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  /** data: URL — kept for images (inline preview). */
  dataUrl?: string;
  /** decoded text for code / document files, used for analysis previews. */
  text?: string;
}

/** Structured answer for Math & Learning mode — toggled inline, no re-send. */
export interface LearningAnswer {
  answer: string;
  steps: string[];
  concept: string;
}

export interface ChatMessageT {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  /** true while tokens are still streaming into this message */
  streaming?: boolean;
  model?: ChatModel | CodeMode;
  /** files the user attached to this (user) message */
  attachments?: Attachment[];
  /** which agent the router picked for this (assistant) reply */
  route?: RouteDecision;
  /** structured Math/Learning payload — when present, rendered with a toggle */
  learning?: LearningAnswer;
  /** present when the AI provider failed — rendered as an error panel, never a reply */
  error?: AofProviderError;
  /** present when the route failed over to a different provider mid-request */
  failover?: FailoverNotice;
  /** which model actually answered — always present on a successful AI reply */
  activeModel?: ModelNotice;
  /** live web-search sources this reply was grounded on (Universal Search) */
  sources?: SourcesNotice;
  /** live agent activity status from the Chief Agent orchestration system */
  agentStatus?: string;
  /** which AI agents contributed to this response */
  agentsUsed?: string[];
  /** quality score 0-100 from the review gate */
  qualityScore?: number;
  /** detected task categories */
  categories?: string[];
  /** real (or, in demo mode, estimated) token usage for this (assistant) reply */
  usage?: UsageNotice;
}

export interface Conversation {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessageT[];
  createdAt: string;
  updatedAt: string;
}

// ── CoCode — conversation-first workflow ──────────────────────────────────────
// CoCode discusses a project (via the Requirements Architect / RAA) and
// builds a structured brief BEFORE any code is generated. Generation (TMAP) only
// runs on an explicit trigger (the Generate Code button or the /gencode command).

/** Where the CoCode workspace is in its lifecycle. */
export type CodePhase = "conversation" | "generating" | "done";

/** Structured project brief, accumulated from the RAA conversation. Mirrors the
 *  RequirementSummary contract in tmap-v2/src/core/raa.ts so it parses identically
 *  whether produced by the live backend, the same-origin LLM route, or the mock. */
export interface ProjectBrief {
  /** clear project name / one-line description */
  project: string;
  /** feature / bug fix / refactor / UI improvement / architecture / … */
  taskType: string;
  /** web app / REST API / CLI / library / … (the summary's "Type" field) */
  appType: string;
  users: string;
  features: string[];
  scope: string[];
  expectedBehavior: string[];
  techStack: string;
  architecture: string;
  files: string[];
  complexity: "Simple" | "Medium" | "Complex" | "";
  openQuestions: string[];
  /** the raw summary block, markers stripped */
  raw: string;
}

export type ProjectStatus = "active" | "building" | "review" | "archived";
export type ProjectType =
  | "web-app"
  | "mobile-app"
  | "api"
  | "game"
  | "automation"
  | "research";

export interface Project {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  status: ProjectStatus;
  pinned: boolean;
  updatedAt: string;
  createdAt: string;
  /** how it was started — which CoCode mode produced it */
  mode?: CodeMode;
}

// ── Titan workflow ────────────────────────────────────────────────────────────
// Titan never writes code first. It walks an enforced gate sequence before any
// generation: Discovery → Clarify → Requirements → Analysis → Plans → Risk →
// Architecture → Approval → Generate.

export type TitanPhaseKey =
  | "discovery"
  | "clarify"
  | "requirements"
  | "analysis"
  | "plans"
  | "risk"
  | "architecture"
  | "approval"
  | "generate";

export interface TitanPhase {
  key: TitanPhaseKey;
  label: string;
  short: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface TitanPlanOption {
  id: "A" | "B" | "C";
  title: string;
  tagline: string;
  pros: string[];
  cons: string[];
  scalability: number; // 0-10
  maintainability: number; // 0-10
  cost: string;
  recommended?: boolean;
}

export interface TitanRisk {
  level: "high" | "med" | "low";
  title: string;
  detail: string;
}
