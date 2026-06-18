// ── Nexora model branding — single source of truth for display names ────────────
// Internal IDs (ChatModel / CodeMode) are never renamed: they drive routing,
// persistence and API contracts. Only the human-facing name is derived here,
// so a future version bump (e.g. Mikros 1.0 → Mikros 1.1) touches one line.

import type { ChatModel, CodeMode } from "./types";

export type ModelTier = "lite" | "normal" | "pro" | "titan";

interface ModelBranding {
  baseName: string;
  /** Empty string means the tier shows no version suffix (e.g. Titan). */
  version: string;
}

const MODEL_BRANDING: Record<ModelTier, ModelBranding> = {
  lite: { baseName: "Mikros", version: "1.0" },
  normal: { baseName: "Kanon", version: "1.0" },
  pro: { baseName: "Ypertatos", version: "1.0" },
  titan: { baseName: "Titan", version: "" },
};

/** CodeMode encodes the "normal" tier as the literal id "1.0". */
export function modelTierFromId(id: ChatModel | CodeMode): ModelTier {
  return id === "1.0" ? "normal" : (id as ModelTier);
}

export function getModelBranding(id: ChatModel | CodeMode): ModelBranding {
  return MODEL_BRANDING[modelTierFromId(id)];
}

/** e.g. "Ypertatos 1.0" — the only string that should ever reach the UI. */
export function getModelDisplayName(id: ChatModel | CodeMode): string {
  const b = getModelBranding(id);
  return b.version ? `${b.baseName} ${b.version}` : b.baseName;
}

export function getModelBaseName(id: ChatModel | CodeMode): string {
  return getModelBranding(id).baseName;
}
