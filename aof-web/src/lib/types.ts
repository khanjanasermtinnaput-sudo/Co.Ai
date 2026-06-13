// ── Domain types shared across the Aof frontend ───────────────────────────────

/** Top-level products surfaced in the sidebar. Titan is intentionally absent —
 *  it is a mode *inside* Aof Code, never a product on the homepage. */
export type ProductKey = "chat" | "code" | "projects" | "settings";

/** Chat-with-Aof models shown in the chat header selector. */
export type ChatModel = "lite" | "normal";

/** Aof Code modes. `titan` only appears inside the Code workspace. */
export type CodeMode = "lite" | "1.0" | "pro" | "titan";

export type Role = "user" | "assistant" | "system";

export interface ChatMessageT {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  /** true while tokens are still streaming into this message */
  streaming?: boolean;
  model?: ChatModel | CodeMode;
}

export interface Conversation {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessageT[];
  createdAt: string;
  updatedAt: string;
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
