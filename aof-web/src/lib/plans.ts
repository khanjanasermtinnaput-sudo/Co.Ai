// ── Subscription plans & entitlements ─────────────────────────────────────────
// Single source of truth for the Coagentix pricing tiers (spec: FREE / LITE / PRO /
// ADVANCED + GUEST) and the features each unlocks. checkUserAccess() and the
// pricing UI both read from here so plan rules live in exactly one place.
//
// Enforcement is gated behind a launch switch (entitlementsEnforced): until a
// billing provider is wired and users can actually upgrade, gating stays lenient
// so signed-in users keep full access. Flip NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS=1 to
// enforce per-plan limits once checkout is live.

import { TIER_RANK, type UserTier } from "@/store/auth-store";

export type Feature =
  | "coagentix-api" // use Coagentix's shared provider keys at normal quota (FREE is heavily limited)
  | "projects" // save & manage projects
  | "export" // export HTML / ZIP / source
  | "coagentix-code" // the Coagentix Code build workspace
  | "tmap" // multi-agent TMAP pipeline
  | "raa" // requirements-architect conversation
  | "titan" // Titan architect mode
  | "cli" // CLI access
  | "deploy" // one-click deploy / deployment center
  | "live-preview" // live in-browser project preview
  | "multi-agent" // agent collaboration / advanced orchestration
  | "openrouter" // OpenRouter provider support
  | "github-integration" // GitHub push / repo integration
  | "search-docs" // documentation search source
  | "search-github" // GitHub search source
  | "search-reddit" // Reddit search source
  | "search-research"; // deep research sources

export interface PlanLimits {
  /** Messages/day when using Coagentix's shared keys. Infinity = effectively unlimited. */
  dailyMessages: number;
  /** Max saved projects (0 = cannot save). */
  maxProjects: number;
}

export interface Plan {
  tier: UserTier;
  name: string;
  /** Price per month in THB (0 = free). */
  priceTHB: number;
  tagline: string;
  /** Whether this plan can be purchased (GUEST cannot). */
  purchasable: boolean;
  features: Feature[];
  limits: PlanLimits;
  /**
   * BYOK reward (spec §13): quota multiplier applied when the user supplies their
   * own API key, since it offloads cost from Coagentix's infrastructure. Lower tiers get
   * a bigger boost (FREE 3x → ADVANCED 1.25x).
   */
  byokMultiplier: number;
  /** Marketing bullets for the pricing card. */
  highlights: string[];
}

// Cumulative feature sets — each tier inherits everything below it.
const FREE_FEATURES: Feature[] = [];
const LITE_FEATURES: Feature[] = [
  ...FREE_FEATURES,
  "coagentix-api",
  "projects",
  "export",
  "search-docs",
];
const PRO_FEATURES: Feature[] = [
  ...LITE_FEATURES,
  "coagentix-code",
  "tmap",
  "raa",
  "deploy",
  "live-preview",
  "openrouter",
  "github-integration",
  "search-github",
  "search-reddit",
  "search-research",
];
const ADVANCED_FEATURES: Feature[] = [
  ...PRO_FEATURES,
  "titan",
  "cli",
  "multi-agent",
];

export const PLANS: Record<UserTier, Plan> = {
  GUEST: {
    tier: "GUEST",
    name: "Guest",
    priceTHB: 0,
    tagline: "ลองก่อนได้ ไม่ต้องล็อกอิน",
    purchasable: false,
    features: [],
    limits: { dailyMessages: 3, maxProjects: 0 },
    byokMultiplier: 1,
    highlights: ["ใช้งานได้ 3 ข้อความ", "ไม่ต้อง Login", "หลังจากนั้นล็อกอิน Google"],
  },
  FREE: {
    tier: "FREE",
    name: "Free",
    priceTHB: 0,
    tagline: "เหมาะสำหรับทดลองใช้งาน",
    purchasable: true,
    features: FREE_FEATURES,
    limits: { dailyMessages: 20, maxProjects: 0 },
    byokMultiplier: 3,
    highlights: [
      "Login Google",
      "Web Search (Google)",
      "Bring Your Own Key (Gemini, Llama)",
      "บันทึกประวัติแชตพื้นฐาน",
      "API ของ Coagentix แบบจำกัด",
    ],
  },
  LITE: {
    tier: "LITE",
    name: "Lite",
    priceTHB: 49,
    tagline: "เหมาะสำหรับผู้ใช้ทั่วไป",
    purchasable: true,
    features: LITE_FEATURES,
    limits: { dailyMessages: 200, maxProjects: 10 },
    byokMultiplier: 2,
    highlights: [
      "ทุกอย่างใน Free",
      "Gemini · Llama · DeepSeek · Qwen",
      "ใช้ API ของ Coagentix ได้",
      "Google + Documentation Search",
      "บันทึกโปรเจกต์ · Export HTML/ZIP",
    ],
  },
  PRO: {
    tier: "PRO",
    name: "Pro",
    priceTHB: 149,
    tagline: "เหมาะสำหรับนักพัฒนา",
    purchasable: true,
    features: PRO_FEATURES,
    limits: { dailyMessages: 600, maxProjects: Infinity },
    byokMultiplier: 1.5,
    highlights: [
      "ทุกอย่างใน Lite",
      "CoAgentix Code · TMAP · RAA",
      "OpenRouter + GitHub Integration",
      "Deploy + Live Preview + Workspace",
      "Web Search: GitHub · Reddit · Research",
    ],
  },
  ADVANCED: {
    tier: "ADVANCED",
    name: "Advanced",
    priceTHB: 399,
    tagline: "เหมาะสำหรับ Power Users",
    purchasable: true,
    features: ADVANCED_FEATURES,
    limits: { dailyMessages: Infinity, maxProjects: Infinity },
    byokMultiplier: 1.25,
    highlights: [
      "ทุกอย่างใน Pro",
      "Titan Mode · Multi-Agent · CLI",
      "Early Access + Beta + New Models First",
      "Unlimited Bring Your Own Key",
      "Priority Queue",
    ],
  },
};

/** Plans shown on the pricing page, in display order (excludes GUEST). */
export const PRICING_TIERS: UserTier[] = ["FREE", "LITE", "PRO", "ADVANCED"];

export function planFor(tier: UserTier): Plan {
  return PLANS[tier] ?? PLANS.FREE;
}

/** True when per-plan enforcement is switched on (after billing goes live). */
export function entitlementsEnforced(): boolean {
  return (
    process.env.NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS === "1" ||
    process.env.NEXT_PUBLIC_CGNTX_ENFORCE_PLANS === "1"
  );
}

/**
 * Whether a tier includes a feature. When enforcement is OFF (pre-billing), any
 * signed-in tier (FREE+) is treated as fully entitled so the live app keeps
 * working; guests are always held to their real (empty) feature set.
 */
export function hasFeature(tier: UserTier, feature: Feature): boolean {
  if (PLANS[tier]?.features.includes(feature)) return true;
  if (!entitlementsEnforced() && tier !== "GUEST") return true;
  return false;
}

/** The lowest tier that grants a feature — used to tell users what to upgrade to. */
export function minTierForFeature(feature: Feature): UserTier {
  for (const tier of ["LITE", "PRO", "ADVANCED"] as UserTier[]) {
    if (PLANS[tier].features.includes(feature)) return tier;
  }
  return "ADVANCED";
}

export function tierAtLeast(tier: UserTier, min: UserTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

/** Format a THB price for display, e.g. 49 → "฿49". */
export function formatTHB(price: number): string {
  return price === 0 ? "ฟรี" : `฿${price.toLocaleString("th-TH")}`;
}

/**
 * Effective daily message quota for a tier, with the BYOK bonus (spec §13)
 * applied when the user is on their own API key. Infinity stays Infinity.
 */
export function effectiveDailyMessages(tier: UserTier, usingOwnKey: boolean): number {
  const plan = planFor(tier);
  const base = plan.limits.dailyMessages;
  if (!Number.isFinite(base)) return Infinity;
  return usingOwnKey ? Math.round(base * plan.byokMultiplier) : base;
}

/** BYOK bonus as a percent label, e.g. 3 → "+200%" (3x is +200% over base). */
export function byokBonusLabel(tier: UserTier): string {
  const m = planFor(tier).byokMultiplier;
  if (m <= 1) return "—";
  return `+${Math.round((m - 1) * 100)}%`;
}
