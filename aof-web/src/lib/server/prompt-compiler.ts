// ── Prompt Compiler — Co.AI Master Prompt v1.0 Part 6.6 ──────────────────────
// The one place a turn's `system` prompt is finalized before a provider call.
// It does not invent prompt text — every layer's content still comes from this
// repo's existing single-source-of-truth generators (buildSystem/agentConfig,
// effortSystemAddon, simpleTaskSystemAddon, buildSearchContext,
// userPreferenceSystemAddon, the prestream-dispatch.ts engineering/context
// addons, buildWorkflowSystem). This module owns LAYERING, ORDERING,
// DEDUPLICATION, VALIDATION, CACHING and METADATA around that existing text —
// never a second place that decides what the text SAYS.
//
// Render order intentionally does NOT follow the spec's literal Layer-1..7
// numbering. This repo's real render order (reconstructed from route.ts +
// prestream-dispatch.ts, unchanged by this module) is:
//   system → memory → context (conversation + engineering, merged — see
//   below) → workflow (buildWorkflowSystem's phase-marker protocol, LAST).
// The workflow layer must stay last for two concrete reasons: (a)
// phase-stream.ts needs the model's freshest instruction to be the marker
// protocol, and (b) the protocol's own text ("Any length/depth guidance
// elsewhere in this prompt applies to the FINAL phase only") is
// self-referential and assumes everything else has already been stated
// above it. Reordering to the spec's literal numbering would silently change
// what that sentence refers to.
//
// "context" deliberately merges the spec's Layer 4 (Engineering Context —
// RAA/TMAP/orchestration artifacts) and Layer 6 (Conversation Context — the
// local Context Builder's history digest): prestream-dispatch.ts's regression-
// locked return contract (see its own header — its first test is a
// regression lock against a real shipped bug) accumulates all four of those
// additions into one opaque `system` string, and splitting that return
// contract into separate named pieces would touch a module this repo
// explicitly protects for no behavioral gain. Documented merge, not a fake
// separation.
//
// Provider Awareness (spec): "Only prompt formatting changes" between
// providers. No per-provider prompt formatting exists in this codebase yet —
// `system` text is identical across every provider a turn tries (including
// failover). Compiling once per turn, before provider selection, is
// therefore both correct and cheaper than recompiling per attempt; the
// `provider`/`model` metadata fields below record the primary candidate for
// observability, not a claim that the text was tailored to it.

export type PromptLayerId = "system" | "memory" | "context" | "workflow";

/** This repo's real render order — see header. NOT the spec's numeric order. */
export const PROMPT_LAYER_ORDER: readonly PromptLayerId[] = ["system", "memory", "context", "workflow"];

export interface PromptLayer {
  id: PromptLayerId;
  /** "" (or whitespace-only) is valid — the layer is simply omitted from output. */
  text: string;
}

export interface PromptInputs {
  layers: PromptLayer[];
  /** Tier this turn resolved to ("lite" | "normal" | "pro" | "chat" for
   *  untiered agents) — Prompt Metadata's "Workflow ID". */
  workflowId: string;
  /** Derived from the FINAL workflow stage table, e.g.
   *  "processing+review" or "requirement-analysis+planner+multi-agent+...".
   *  Real, not fabricated — a direct join of stagesFor()'s output. */
  stageId: string;
  /** Primary provider candidate for this turn, for observability only. */
  provider: string;
  /** Primary provider's resolved model id, for observability only. */
  model: string;
}

export interface PromptMetadata {
  promptId: string;
  workflowId: string;
  stageId: string;
  provider: string;
  model: string;
  promptVersion: string;
  compileMs: number;
  estTokens: number;
  /** Fraction of total input characters removed by deduplication, 0..1.
   *  Real, measured from actual removed characters — never a placeholder. */
  optimizationRatio: number;
  cacheHit: boolean;
}

export interface CompiledPromptPackage {
  system: string;
  metadata: PromptMetadata;
}

export const PROMPT_TEMPLATE_VERSION = "1.0.0";

/** Emitted only when validation fails (missing/empty required "system"
 *  layer) — a minimal safe prompt so a malformed compile can still answer
 *  rather than reach a provider with nothing at all. */
const FALLBACK_SYSTEM = "You are CoAI, a helpful AI assistant. Answer the user's message directly and honestly.";

/** char/4 heuristic — mirrors tmap-v2's cost-budget.ts estimateTokens(). No
 *  tokenizer dependency exists in this stack; honest ±30%, not a measurement.
 *  Exported so Token Manager (Part 6.7) can share this one estimator rather
 *  than defining a second. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Drops a layer's text when it is a byte-for-byte (post-trim) duplicate of
 *  an earlier layer's text. In practice this repo's four layers are always
 *  generated from disjoint templates, so this is real, always-on
 *  infrastructure that is currently a no-op — not a fabricated "optimization"
 *  forced to report a nonzero number. */
function dedupLayers(layers: PromptLayer[]): { layers: PromptLayer[]; removedChars: number } {
  const seen = new Set<string>();
  let removedChars = 0;
  const out: PromptLayer[] = [];
  for (const layer of layers) {
    const trimmed = layer.text.trim();
    if (!trimmed) {
      out.push(layer);
      continue;
    }
    if (seen.has(trimmed)) {
      removedChars += layer.text.length;
      out.push({ id: layer.id, text: "" });
      continue;
    }
    seen.add(trimmed);
    out.push(layer);
  }
  return { layers: out, removedChars };
}

function assemble(layers: PromptLayer[]): string {
  return PROMPT_LAYER_ORDER.map((id) => layers.find((l) => l.id === id))
    .filter((l): l is PromptLayer => !!l && l.text.trim().length > 0)
    .map((l) => l.text)
    .join("\n\n");
}

/** "Required Sections" + "Template Integrity" only — Prompt Size / Provider
 *  Limits / Context Budget validation belongs to Token Manager (Part 6.7),
 *  not duplicated here. */
function isValid(inputs: PromptInputs): boolean {
  const hasSystemLayer = inputs.layers.some((l) => l.id === "system" && l.text.trim().length > 0);
  return hasSystemLayer;
}

let promptCounter = 0;
function nextPromptId(): string {
  promptCounter += 1;
  return `pc_${Date.now().toString(36)}_${promptCounter}`;
}

/** FNV-1a-ish 32-bit rolling hash — good enough to key a process-local cache,
 *  not a security primitive. */
function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

interface CacheEntry {
  system: string;
  estTokens: number;
  optimizationRatio: number;
}

/** Keyed on everything that affects output (workflow/stage identity + every
 *  layer's content) so a hit can never violate correctness — see spec's
 *  "Prompt Caching ... Cache must never violate correctness." Provider/model
 *  are deliberately NOT part of the key: they don't affect `system` today
 *  (see header), so keying on them would only fragment the cache. */
const compiledPromptCache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = 200;

function cacheKey(inputs: PromptInputs): string {
  const layerPart = inputs.layers.map((l) => `${l.id}:${l.text.length}:${simpleHash(l.text)}`).join("|");
  return `${inputs.workflowId}::${inputs.stageId}::${layerPart}`;
}

/** Deterministic: identical inputs always compile to an identical `system`
 *  string. Synchronous and pure — makes zero provider calls, so this stage
 *  can never affect Kanon/Mikros/Ypertatos's call-count invariants. */
export function compilePrompt(inputs: PromptInputs): CompiledPromptPackage {
  const start = performance.now();
  const key = cacheKey(inputs);
  const cached = compiledPromptCache.get(key);
  if (cached) {
    return {
      system: cached.system,
      metadata: {
        promptId: nextPromptId(),
        workflowId: inputs.workflowId,
        stageId: inputs.stageId,
        provider: inputs.provider,
        model: inputs.model,
        promptVersion: PROMPT_TEMPLATE_VERSION,
        compileMs: Math.round((performance.now() - start) * 1000) / 1000,
        estTokens: cached.estTokens,
        optimizationRatio: cached.optimizationRatio,
        cacheHit: true,
      },
    };
  }

  const rawChars = inputs.layers.reduce((n, l) => n + l.text.length, 0);
  const { layers: dedupedLayers, removedChars } = dedupLayers(inputs.layers);
  let system = assemble(dedupedLayers);

  // Invalid → fallback template. Never reaches a provider incomplete or empty.
  if (!isValid(inputs) || !system.trim()) {
    system = FALLBACK_SYSTEM;
  }

  const estTokens = estimateTokens(system);
  const optimizationRatio = rawChars > 0 ? Math.round((removedChars / rawChars) * 1000) / 1000 : 0;

  if (compiledPromptCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = compiledPromptCache.keys().next().value;
    if (oldestKey !== undefined) compiledPromptCache.delete(oldestKey);
  }
  compiledPromptCache.set(key, { system, estTokens, optimizationRatio });

  return {
    system,
    metadata: {
      promptId: nextPromptId(),
      workflowId: inputs.workflowId,
      stageId: inputs.stageId,
      provider: inputs.provider,
      model: inputs.model,
      promptVersion: PROMPT_TEMPLATE_VERSION,
      compileMs: Math.round((performance.now() - start) * 1000) / 1000,
      estTokens,
      optimizationRatio,
      cacheHit: false,
    },
  };
}
