// ── Domain types shared across the Aof frontend ───────────────────────────────

import type { AofProviderError, FailoverNotice, ModelNotice, SourcesNotice } from "./errors";

/** Top-level products surfaced in the sidebar. Titan is intentionally absent —
 *  it is a mode *inside* Aof Code, never a product on the homepage. */
export type ProductKey = "chat" | "code" | "projects" | "settings";

/** Chat-with-Aof models shown in the chat header selector. */
export type ChatModel = "lite" | "normal";

/** Aof Code modes. `titan` only appears inside the Code workspace. */
export type CodeMode = "lite" | "1.0" | "pro" | "titan";

export type Role = "user" | "assistant" | "system";

/** How verbose the assistant should be. The user picks this; the model that
 *  actually answers is chosen automatically by the router. */
export type ResponseStyle = "short" | "normal" | "detailed";

/** Universal Search mode toggle: AI decides · always off · always search. */
export type SearchMode = "auto" | "off" | "force";

/** Where the router sends a request. Users never choose this directly. */
export type RouteTarget = "chat" | "code" | "search";

export interface RouteDecision {
  target: RouteTarget;
  /** Human label shown on the routed reply, e.g. "Aof Code". */
  label: string;
  /** Short why-this-route explanation surfaced in the UI. */
  reason: string;
  /** Routing confidence 0–100. Low values mean the signal was weak. */
  confidence?: number;
}

/** Kinds of files the multimodal composer accepts. */
export type AttachmentKind = "image" | "pdf" | "code" | "document";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  /** data: URL — only kept for images so they can be previewed inline. */
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
  /** verbosity this (assistant) reply was generated at */
  style?: ResponseStyle;
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
}

export interface Conversation {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessageT[];
  createdAt: string;
  updatedAt: string;
}

// ── Aof Code — conversation-first workflow ────────────────────────────────────
// Aof Code discusses a project (via the Requirements Architect / RAA) and builds
// a structured brief BEFORE any code is generated. Generation (TMAP) only runs on
// an explicit trigger (the Generate Code button or the /gencode command).

/** Where the Aof Code workspace is in its lifecycle. */
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
  /** how it was started — which Aof Code mode produced it */
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
