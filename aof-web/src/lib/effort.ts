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
