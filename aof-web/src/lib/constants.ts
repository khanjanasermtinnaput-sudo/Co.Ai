import {
  Sparkles,
  MessageSquare,
  Code2,
  FolderKanban,
  GraduationCap,
  Settings,
  Activity,
  type LucideIcon,
} from "lucide-react";
import type {
  ChatModel,
  CodeMode,
  ProductKey,
  TitanPhase,
} from "./types";
import { getModelDisplayName } from "./model-branding";

// ── Sidebar navigation ────────────────────────────────────────────────────────
export interface NavItem {
  key: ProductKey;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

// Deliberately minimal: Home (chat), Code (projects + workspace), Settings.
// Everything else is contextual (Code-area history, command palette) — new
// top-level entries need a real page and a real reason to interrupt this calm.
export const PRIMARY_NAV: NavItem[] = [
  {
    key: "chat",
    label: "Home",
    href: "/",
    icon: MessageSquare,
    description: "Chat with Co.AI",
  },
  {
    key: "code",
    label: "Code",
    href: "/code",
    icon: Code2,
    description: "Projects and the AI development workspace",
  },
  {
    key: "activity",
    label: "Activity",
    href: "/activity",
    icon: Activity,
    description: "Recent chats, projects, and usage",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Account, appearance, keys and billing",
  },
];

// ── Homepage quick-action cards ───────────────────────────────────────────────
// Every card does something real: `href` navigates, `prefill` seeds the
// composer instead (no dead routes). The old self-referential "Co.AI" card
// (home linking to home) was removed.
export interface QuickAction {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
  /** Seed the home composer with this text instead of navigating. */
  prefill?: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "code",
    icon: Code2,
    title: "Build with CoCode",
    description: "Websites, apps, games and software.",
    href: "/code",
  },
  {
    key: "projects",
    icon: FolderKanban,
    title: "Continue a project",
    description: "Pick up where you left off.",
    href: "/projects",
  },
  {
    key: "learn",
    icon: GraduationCap,
    title: "Learn something",
    description: "Research, study and explore ideas.",
    prefill: "Teach me about ",
  },
];

// ── Chat models ───────────────────────────────────────────────────────────────
/** Selector id: a concrete tier, or "auto" — resolved fresh per message by
 *  resolveAutoModel(). Widens ChatModel only for this picker; the API
 *  contract and every other ChatModel use stay exactly "lite" | "normal". */
export type ChatModelSelectorId = ChatModel | "auto";

export interface ChatModelInfo {
  id: ChatModelSelectorId;
  name: string;
  tagline: string;
  description: string;
  badge?: string;
}

export const CHAT_MODELS: ChatModelInfo[] = [
  {
    id: "auto",
    name: "Auto",
    tagline: "Picks for you",
    description: "Reads each message and picks Mikros or Kanon for it.",
    badge: "Recommended",
  },
  {
    id: "lite",
    name: getModelDisplayName("lite"),
    tagline: "Fast & efficient",
    description: "Quick answers for everyday questions.",
  },
  {
    id: "normal",
    name: getModelDisplayName("normal"),
    tagline: "Balanced reasoning",
    description: "Deeper thinking for richer conversations and code.",
  },
];

// ── CoCode modes (Titan lives here only) ─────────────────────────────────────
export interface CodeModeInfo {
  id: CodeMode;
  name: string;
  tagline: string;
  description: string;
  badge?: string;
  titan?: boolean;
  /** Temporarily unavailable — rendered with a padlock and not selectable. */
  locked?: boolean;
}

export const CODE_MODES: CodeModeInfo[] = [
  {
    id: "lite",
    name: getModelDisplayName("lite"),
    tagline: "One-shot",
    description: "Fast generation, no critique loop. Great for snippets.",
  },
  {
    id: "1.0",
    name: getModelDisplayName("1.0"),
    tagline: "Balanced",
    description: "Plan → code → validate with a single review pass.",
    badge: "Default",
  },
  {
    id: "pro",
    name: getModelDisplayName("pro"),
    tagline: "Deep critique",
    description: "Multi-pass self-review loop for production-grade output.",
  },
  {
    id: "titan",
    name: getModelDisplayName("titan"),
    tagline: "Architect mode",
    description:
      "Think first, build later. Discovery, planning & approval gate before any code.",
    badge: "Highest",
    titan: true,
    locked: true,
  },
];

// ── Titan workflow phases (enforced order — see tmap-v2/src/core/titan.ts) ─────
export const TITAN_PHASES: TitanPhase[] = [
  {
    key: "discovery",
    label: "Discovery",
    short: "Discover",
    description: "Understand the real goal before anything else.",
  },
  {
    key: "clarify",
    label: "Clarification",
    short: "Clarify",
    description: "Ask focused questions until intent is clear.",
  },
  {
    key: "requirements",
    label: "Requirements",
    short: "Requirements",
    description: "Gather and lock down what success means.",
  },
  {
    key: "analysis",
    label: "Deep Analysis",
    short: "Analyze",
    description: "Feasibility, performance, security, cost.",
  },
  {
    key: "plans",
    label: "Multi-Plan",
    short: "Plans",
    description: "Generate Plan A / B / C with trade-offs.",
  },
  {
    key: "risk",
    label: "Risk Review",
    short: "Risk",
    description: "Devil's advocate — attack the chosen plan.",
  },
  {
    key: "architecture",
    label: "Architecture",
    short: "Architecture",
    description: "System, modules, data & deployment design.",
  },
  {
    key: "approval",
    label: "Approval Gate",
    short: "Approve",
    description: "Nothing is built without your sign-off.",
  },
  {
    key: "generate",
    label: "Generate Code",
    short: "Generate",
    description: "Hand the approved blueprint to the build pipeline.",
  },
];

export const BRAND = {
  name: "Co.AI",
  tagline: "Many Minds. One Intelligence.",
  welcome: "Co.AI",
  welcomeSub: "Your AI Workspace",
  composerPlaceholder: "Ask anything...",
} as const;

export const Sparkle = Sparkles;
