// ── Effort levels — single source of truth for the reasoning-effort dial ─────
// Which levels a model offers is a property of its tier, not of the product
// surface (CoChat / CoCode) it is picked from:
//
//   Mikros, Kanon  → Low · Normal · High
//   Ypertatos      → Low · Normal · High · Ultra · Extreme (the full range)
//   Titan          → none (its enforced phase workflow replaces the dial)

import type { ChatModel, CodeMode, EffortLevel } from "./types";
import { modelTierFromId } from "./model-branding";

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  ultra: "Ultra",
  extreme: "Extreme",
};

export function effortLevelsFor(id: ChatModel | CodeMode): EffortLevel[] {
  const tier = modelTierFromId(id);
  if (tier === "titan") return [];
  // Ypertatos reaches into the premium band (Ultra/Extreme) on top of the
  // baseline three, so its slider spans the whole scale.
  if (tier === "pro") return ["low", "normal", "high", "ultra", "extreme"];
  return ["low", "normal", "high"];
}

export function defaultEffortFor(id: ChatModel | CodeMode): EffortLevel {
  return modelTierFromId(id) === "pro" ? "ultra" : "normal";
}

/** Snap a persisted/previous effort onto the target model's own scale, so
 *  switching Kanon@High → Ypertatos never leaves an impossible combination. */
export function clampEffort(id: ChatModel | CodeMode, effort: EffortLevel): EffortLevel {
  return effortLevelsFor(id).includes(effort) ? effort : defaultEffortFor(id);
}

export const EFFORT_LEVELS: EffortLevel[] = ["low", "normal", "high", "ultra", "extreme"];

/** Coerce an untrusted value (request body, persisted state) to a real level. */
export function normalizeEffort(v: unknown): EffortLevel {
  return typeof v === "string" && (EFFORT_LEVELS as string[]).includes(v)
    ? (v as EffortLevel)
    : "normal";
}

// ── Effort policy — how a level maps onto real model behaviour ────────────────
// The dial isn't cosmetic: this policy is consumed on the server (`/api/chat`)
// to size the token budget, temperature and reasoning-depth system prompt, and
// on the client to gate the CoCode RAA→TMAP workflow. One table, both sides.

export interface EffortPolicy {
  /** scales an agent's base token budget, then clamped to [minTokens, maxTokens] */
  tokenScale: number;
  minTokens: number;
  maxTokens: number;
  /** sampling ceiling — higher effort reasons more deterministically. Applied as
   *  a cap (min with the agent's own temperature) so tuned agents never get noisier. */
  temperature: number;
  /** high+ run the RAA→TMAP pipeline as a baseline (CoCode) */
  workflow: boolean;
  /** ultra+ think in more depth / multi-pass */
  deepThink: boolean;
  /** extreme asks clarifying questions and collaborates before doing the work */
  clarifyFirst: boolean;
  /** one-line summary for tooltips / status */
  summary: string;
}

export const EFFORT_POLICY: Record<EffortLevel, EffortPolicy> = {
  low: {
    tokenScale: 0.6, minTokens: 256, maxTokens: 700, temperature: 0.7,
    workflow: false, deepThink: false, clarifyFirst: false,
    summary: "Fast, direct answers with the smallest token footprint.",
  },
  normal: {
    tokenScale: 1.0, minTokens: 512, maxTokens: 1400, temperature: 0.6,
    workflow: false, deepThink: false, clarifyFirst: false,
    summary: "Balanced answers for everyday questions.",
  },
  high: {
    tokenScale: 1.6, minTokens: 1200, maxTokens: 3000, temperature: 0.5,
    workflow: true, deepThink: false, clarifyFirst: false,
    summary: "Considered reasoning that can write real code — RAA+TMAP baseline.",
  },
  ultra: {
    tokenScale: 2.6, minTokens: 2500, maxTokens: 5000, temperature: 0.45,
    workflow: true, deepThink: true, clarifyFirst: false,
    summary: "Deep, multi-step reasoning for complex work — full RAA+TMAP.",
  },
  extreme: {
    tokenScale: 3.5, minTokens: 4000, maxTokens: 8000, temperature: 0.4,
    workflow: true, deepThink: true, clarifyFirst: true,
    summary: "Maximum rigor: clarifies with you first, then runs the full RAA+TMAP plan.",
  },
};

export function effortPolicy(effort: EffortLevel): EffortPolicy {
  return EFFORT_POLICY[effort] ?? EFFORT_POLICY.normal;
}

/** Size a token budget for `effort` from an agent's base allowance. */
export function effortMaxTokens(baseMaxTokens: number, effort: EffortLevel): number {
  const p = effortPolicy(effort);
  return Math.max(p.minTokens, Math.min(p.maxTokens, Math.round(baseMaxTokens * p.tokenScale)));
}

/** Cap a base temperature by the effort policy — effort can only make sampling
 *  more focused, never noisier, so an agent's tuned value is respected. */
export function effortTemperature(baseTemperature: number, effort: EffortLevel): number {
  return Math.min(baseTemperature, effortPolicy(effort).temperature);
}

/** System-prompt addendum that steers answer depth for `effort`. Conversational
 *  agents (plain chat / RAA) may be told to clarify first at extreme; one-shot
 *  generators (code-gen / plan / analyze / debug) never are. */
export function effortSystemAddon(
  effort: EffortLevel,
  opts: { conversational?: boolean } = {},
): string {
  const lines: string[] = [];
  switch (effort) {
    case "low":
      lines.push(
        "EFFORT — LOW: Answer as briefly and directly as possible, ideally in one or two " +
          "sentences. Skip preamble, caveats and restating the question. Use the fewest tokens " +
          "that still answer well.",
      );
      break;
    case "normal":
      lines.push(
        "EFFORT — NORMAL: Give a clear, helpful answer at a natural length for an everyday question.",
      );
      break;
    case "high":
      lines.push(
        "EFFORT — HIGH: Think the problem through carefully before answering. Organise the reply, " +
          "and when the task calls for code, write complete, correct, runnable code.",
      );
      break;
    case "ultra":
      lines.push(
        "EFFORT — ULTRA: Reason deeply and in detail. Work through the problem in structured steps " +
          "internally, weigh edge cases and trade-offs, and produce a thorough, production-grade answer.",
      );
      break;
    case "extreme":
      lines.push(
        "EFFORT — EXTREME: Apply maximum rigor. Plan meticulously, weigh alternatives, and cover " +
          "edge cases, risks and follow-ups.",
      );
      if (opts.conversational) {
        lines.push(
          "Before committing to a solution, ask the user 1–3 focused clarifying questions (offer " +
            "concrete options where useful) and wait for their answers. Collaborate first — do not " +
            "just execute the request.",
        );
      }
      break;
  }
  return lines.join("\n");
}
