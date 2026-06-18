import {
  Sparkles,
  MessageSquare,
  Code2,
  FolderKanban,
  GraduationCap,
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

export const PRIMARY_NAV: NavItem[] = [
  {
    key: "chat",
    label: "Nexora Chat",
    href: "/",
    icon: MessageSquare,
    description: "General AI assistant",
  },
  {
    key: "projects",
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
    description: "Manage your work",
  },
  {
    key: "code",
    label: "Nexora Code",
    href: "/code",
    icon: Code2,
    description: "Build software",
  },
];

// ── Homepage quick-action cards ───────────────────────────────────────────────
export interface QuickAction {
  key: string;
  emoji: string;
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  accent: string; // tailwind gradient stops for the icon chip
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "chat",
    emoji: "💬",
    icon: MessageSquare,
    title: "Nexora Chat",
    description: "General AI assistant for everyday tasks.",
    href: "/",
    accent: "from-amber-400/25 to-orange-500/10",
  },
  {
    key: "code",
    emoji: "💻",
    icon: Code2,
    title: "Nexora Code",
    description: "Build websites, apps, games and software.",
    href: "/code",
    accent: "from-sky-400/25 to-blue-500/10",
  },
  {
    key: "projects",
    emoji: "📁",
    icon: FolderKanban,
    title: "Projects",
    description: "Manage and continue your work.",
    href: "/projects",
    accent: "from-violet-400/25 to-fuchsia-500/10",
  },
  {
    key: "learn",
    emoji: "📚",
    icon: GraduationCap,
    title: "Learn",
    description: "Research, study and explore ideas.",
    href: "/?intent=learn",
    accent: "from-emerald-400/25 to-teal-500/10",
  },
];

// ── Chat models ───────────────────────────────────────────────────────────────
export interface ChatModelInfo {
  id: ChatModel;
  name: string;
  tagline: string;
  description: string;
  badge?: string;
}

export const CHAT_MODELS: ChatModelInfo[] = [
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
    description: "Deeper thinking for richer conversations.",
    badge: "Default",
  },
];

// ── Nexora Code modes (Titan lives here only) ───────────────────────────────────
export interface CodeModeInfo {
  id: CodeMode;
  name: string;
  tagline: string;
  description: string;
  badge?: string;
  titan?: boolean;
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
  name: "Nexora",
  tagline: "The professional AI platform",
  welcome: "Welcome to Nexora",
  welcomeSub: "What would you like to do today?",
  composerPlaceholder: "Ask anything or start a project...",
} as const;

export const Sparkle = Sparkles;
