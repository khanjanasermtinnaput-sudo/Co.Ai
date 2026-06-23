// ── Titan workflow content ────────────────────────────────────────────────────
// Titan is the highest mode INSIDE CoCode. Strict contract: think first, build
// later. It never generates code until the user approves a blueprint. This module
// produces the gated, interactive content for the offline experience and mirrors
// the enforced phase order in tmap-v2/src/core/titan.ts.

import { uid } from "./utils";
import type { ClarifyQuestion, TitanPlanOption, TitanRisk } from "./types";

/** Phase 1 — Discovery. Always the same three framing questions, plus smart ones. */
export function discoveryQuestions(prompt: string): ClarifyQuestion[] {
  const base: ClarifyQuestion[] = [
    {
      id: uid("q"),
      question: "What's the primary goal?",
      options: ["Learning", "Portfolio", "Real-world use", "Commercial product", "Startup"],
    },
    {
      id: uid("q"),
      question: "What quality target are we aiming for?",
      options: ["Fastest", "Balanced", "High quality", "Highly scalable", "Enterprise"],
    },
    {
      id: uid("q"),
      question: "What complexity level fits you?",
      options: ["Beginner", "Intermediate", "Advanced", "Professional", "Expert"],
    },
  ];

  const p = prompt.toLowerCase();
  const smart: ClarifyQuestion[] = [];
  if (/(user|account|login|auth|sign)/.test(p) || smart.length < 1) {
    smart.push({
      id: uid("q"),
      question: "Will it need user accounts & authentication?",
      options: ["No accounts", "Email + password", "Social login", "SSO / Enterprise"],
    });
  }
  if (/(data|store|save|database|record)/.test(p) || smart.length < 2) {
    smart.push({
      id: uid("q"),
      question: "How much data will it handle?",
      options: ["Minimal", "Thousands of rows", "Millions of rows", "Real-time streams"],
    });
  }
  return [...base, ...smart];
}

/** Phase 5 — Multi-plan generation (A fastest, B balanced, C best long-term). */
export function planOptions(): TitanPlanOption[] {
  return [
    {
      id: "A",
      title: "Plan A — Fastest",
      tagline: "Ship a working v1 this week",
      pros: ["Minimal moving parts", "Lowest upfront cost", "Quick to demo"],
      cons: ["Harder to scale later", "Limited extensibility"],
      scalability: 5,
      maintainability: 6,
      cost: "$",
    },
    {
      id: "B",
      title: "Plan B — Balanced",
      tagline: "Pragmatic foundation that grows",
      pros: ["Clean separation of concerns", "Good DX", "Room to scale"],
      cons: ["Slightly more setup", "A few more dependencies"],
      scalability: 8,
      maintainability: 9,
      cost: "$$",
      recommended: true,
    },
    {
      id: "C",
      title: "Plan C — Best Long-Term",
      tagline: "Built for scale & teams",
      pros: ["Horizontally scalable", "Strong boundaries", "Enterprise-ready"],
      cons: ["Higher complexity", "More infra to operate"],
      scalability: 10,
      maintainability: 8,
      cost: "$$$",
    },
  ];
}

/** Phase 6 — Risk review (devil's advocate against the chosen plan). */
export function riskReview(): TitanRisk[] {
  return [
    {
      level: "high",
      title: "Scope creep before v1",
      detail: "Lock a thin vertical slice. Everything else goes to the backlog.",
    },
    {
      level: "med",
      title: "Data model lock-in",
      detail: "Keep the schema additive and versioned so early choices aren't costly.",
    },
    {
      level: "med",
      title: "Auth as an afterthought",
      detail: "Decide the auth boundary now even if you stub the provider.",
    },
    {
      level: "low",
      title: "Vendor coupling",
      detail: "Wrap third-party SDKs behind a small interface for easy swaps.",
    },
  ];
}

/** Phase 7 — Architecture sketch (plain text, never code). */
export function architectureSketch(prompt: string): string {
  return `System design for: ${prompt.slice(0, 70)}

  Client (Next.js)  ──►  API layer  ──►  Service modules
        │                   │                  │
        ▼                   ▼                  ▼
   UI state            Auth + RBAC        Domain logic
                            │                  │
                            ▼                  ▼
                       Database  ◄────►  Background jobs

• Modular service boundaries — each domain owns its data.
• Stateless API for easy horizontal scaling.
• Validation + observability baked in from day one.`;
}
