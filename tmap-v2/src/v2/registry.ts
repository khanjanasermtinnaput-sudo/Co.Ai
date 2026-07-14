// v2 — Agent capability registry.
//
// IMPORTANT: this is DATA the scorer ranks over, NOT a routing table. There is
// no `if intent === X → agent Y` logic anywhere. Each agent *declares* what it
// can do as a capability vector (0..1 per capability) plus a cost tier and a
// link to its DARS health unit. Selection (see score.ts) is pure cosine
// similarity + weighted scoring over whatever is registered here, so the set of
// agents can be extended at runtime / loaded from telemetry without touching
// any decision logic.

import type { Role } from '../types.js';

export type NodeKind = 'agent' | 'tool' | 'memory' | 'router';

export type Capability =
  | 'plan'
  | 'code'
  | 'review'
  | 'validate'
  | 'research'
  | 'write'
  | 'math'
  | 'vision'
  | 'security'
  | 'refactor'
  | 'test';

export type CapabilityVector = Partial<Record<Capability, number>>; // 0..1 each

export const CAPABILITIES: Capability[] = [
  'plan', 'code', 'review', 'validate', 'research',
  'write', 'math', 'vision', 'security', 'refactor', 'test',
];
const CAP_SET = new Set<Capability>(CAPABILITIES);

// Map the free-form capability words an LLM tends to emit onto our fixed enum,
// so scoring never silently degenerates to 0 (which would route everything to
// the cheapest agent). This is normalization, not routing — no branching on the
// task; it only canonicalises capability keys.
const CAP_SYNONYMS: Record<string, Capability> = {
  typescript: 'code', ts: 'code', javascript: 'code', js: 'code', python: 'code',
  backend: 'code', frontend: 'code', api: 'code', function: 'code', implement: 'code',
  implementation: 'code', coding: 'code', programming: 'code',
  jest: 'test', testing: 'test', unittest: 'test', 'unit-test': 'test', mocha: 'test',
  vitest: 'test', pytest: 'test', qa: 'test', coverage: 'test',
  design: 'plan', architecture: 'plan', planning: 'plan', breakdown: 'plan', spec: 'plan',
  audit: 'review', critique: 'review', codereview: 'review', 'code-review': 'review',
  verify: 'validate', verification: 'validate', lint: 'validate', typecheck: 'validate',
  documentation: 'write', docs: 'write', document: 'write', readme: 'write', writeup: 'write',
  reasoning: 'math', calculation: 'math', compute: 'math', algorithm: 'math',
  image: 'vision', visual: 'vision', ocr: 'vision',
  secure: 'security', vulnerability: 'security', auth: 'security', authentication: 'security',
  refactoring: 'refactor', cleanup: 'refactor', optimize: 'refactor', optimization: 'refactor',
  search: 'research', investigate: 'research', analysis: 'research',
};

/** Canonicalise a raw capability map onto the enum: lowercases keys, maps
 *  synonyms, drops unknowns, clamps weights to 0..1. Returns {} if nothing maps. */
export function normalizeCapabilities(raw: Record<string, unknown> | undefined | null): CapabilityVector {
  const out: CapabilityVector = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase().trim();
    const cap = CAP_SET.has(key as Capability) ? (key as Capability) : CAP_SYNONYMS[key];
    if (!cap) continue;
    const num = typeof v === 'number' ? v : Number(v);
    const w = Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : 0.6;
    out[cap] = Math.max(out[cap] ?? 0, w);
  }
  return out;
}

export interface AgentDescriptor {
  id: string;
  kind: NodeKind;
  capabilities: CapabilityVector;
  costTier: number;          // 0 cheap .. 1 expensive
  healthKey?: string;        // links to DARS HealthStore (live reliability)
  role?: Role;               // DARS role to execute as (for LLM agents)
  historicalScore?: number;  // telemetry-backed perf; else derived from health
}

// Seed registry. Extensible: push more descriptors or replace from a DB load.
// The `healthKey` values match DARS vendor keys (see dars/select.ts) so the
// scorer reads real success-rate / circuit state for each agent.
const AGENT_REGISTRY: AgentDescriptor[] = [
  {
    id: 'planner',
    kind: 'agent',
    role: 'planner',
    healthKey: 'gemini',
    costTier: 0.5,
    capabilities: { plan: 0.95, research: 0.6, write: 0.6 },
  },
  {
    id: 'coder',
    kind: 'agent',
    role: 'coder',
    healthKey: 'deepseek',
    costTier: 0.3,
    capabilities: { code: 0.95, refactor: 0.85, test: 0.7 },
  },
  {
    id: 'reviewer',
    kind: 'agent',
    role: 'reviewer',
    healthKey: 'qwen',
    costTier: 0.4,
    capabilities: { review: 0.9, security: 0.75, validate: 0.7 },
  },
  {
    id: 'validator',
    kind: 'agent',
    role: 'validator',
    healthKey: 'llama',
    costTier: 0.1,
    capabilities: { validate: 0.85, test: 0.8 },
  },
  // ── Universal-assistant specialists (ported from the v1 Chief Agent) ──────────
  // These exist so the scorer can SELECT them for research/writing/math/vision
  // work. Their domain-specific behavior (confidence flags, tone detection,
  // verification, structured image specs) is preserved: v2/run.ts dispatches each
  // by id to the real specialist implementation in core/*-agent.ts.
  {
    id: 'research',
    kind: 'agent',
    role: 'planner',
    healthKey: 'gemini',
    costTier: 0.5,
    capabilities: { research: 0.95, write: 0.5 },
  },
  {
    id: 'writing',
    kind: 'agent',
    role: 'planner',
    healthKey: 'gemini',
    costTier: 0.4,
    capabilities: { write: 0.95, research: 0.4 },
  },
  {
    id: 'math',
    kind: 'agent',
    role: 'reviewer',
    healthKey: 'qwen',
    costTier: 0.4,
    capabilities: { math: 0.95, validate: 0.5 },
  },
  {
    id: 'vision',
    kind: 'agent',
    role: 'planner',
    healthKey: 'gemini',
    costTier: 0.5,
    capabilities: { vision: 0.95 },
  },
  // ── Tool Execution Engine (Master Prompt 6.3) ─────────────────────────────────
  // The first (and, today, only) `kind: 'tool'` candidate the scorer can pick —
  // activating the NodeKind='tool' slot this registry declared but never
  // populated. No `role`/`healthKey`: it doesn't go through DARS at all (see
  // score.ts's `agent.healthKey ? ... : <neutral default>` guards), and its
  // costTier is near-zero since it spends no LLM tokens. Dispatched in
  // v2/run.ts's runAgent via v2/tools/index.ts's globalToolRegistry, wrapping
  // the existing sandbox (core/sandbox.ts) rather than a new execution path.
  {
    id: 'code-exec',
    kind: 'tool',
    costTier: 0.05,
    capabilities: { test: 0.7, validate: 0.65, code: 0.3 },
  },
];

// ── Ypertatos Normal/High domain agents ─────────────────────────────────────
// Engineering-domain-scoped Coder variants. Deliberately kept OUT of
// AGENT_REGISTRY/listAgents(): the capability vocabulary (CAPABILITIES above)
// has no per-domain dimension, so if these were scored alongside the generic
// agents they'd sometimes outrank 'coder'/'writing'/etc. on ordinary,
// non-Ypertatos requests (a domain agent's `code`/`write` weight can tie or
// beat the generic one) — which silently changes RAA's routing for every
// caller, not just Ypertatos. These are assigned directly by domain
// (core/engineering-classifier.ts → v2/domain-graph.ts), never through
// rankAgents(); getAgent() still resolves them (for role/health lookups) via
// its own registry, kept separate from the scored one.
const DOMAIN_AGENT_REGISTRY: AgentDescriptor[] = [
  {
    id: 'backend-agent',
    kind: 'agent',
    role: 'coder',
    healthKey: 'deepseek',
    costTier: 0.3,
    capabilities: { code: 0.9, security: 0.5, refactor: 0.6 },
  },
  {
    id: 'frontend-agent',
    kind: 'agent',
    role: 'coder',
    healthKey: 'deepseek',
    costTier: 0.3,
    capabilities: { code: 0.9, refactor: 0.6 },
  },
  {
    id: 'database-agent',
    kind: 'agent',
    role: 'coder',
    healthKey: 'deepseek',
    costTier: 0.3,
    capabilities: { code: 0.85, validate: 0.4 },
  },
  {
    id: 'testing-agent',
    kind: 'agent',
    role: 'coder',
    healthKey: 'deepseek',
    costTier: 0.25,
    capabilities: { test: 0.95, code: 0.6, validate: 0.5 },
  },
  {
    id: 'documentation-agent',
    kind: 'agent',
    role: 'coder',
    healthKey: 'gemini',
    costTier: 0.2,
    capabilities: { write: 0.9, code: 0.3 },
  },
  {
    id: 'infrastructure-agent',
    kind: 'agent',
    role: 'coder',
    healthKey: 'deepseek',
    costTier: 0.3,
    capabilities: { code: 0.7, security: 0.4, refactor: 0.4 },
  },
];

/** All GENERAL-PURPOSE, score-eligible agents. Callers must NOT pre-filter by
 *  keyword — pass the whole list to the scorer and let scores decide. Domain
 *  agents (DOMAIN_AGENT_REGISTRY) are intentionally excluded — see above. */
export function listAgents(): AgentDescriptor[] {
  return AGENT_REGISTRY;
}

export function getAgent(id: string): AgentDescriptor | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id) ?? DOMAIN_AGENT_REGISTRY.find((a) => a.id === id);
}

/** Register / override an agent at runtime (e.g. from telemetry or a plugin). */
export function registerAgent(desc: AgentDescriptor): void {
  const i = AGENT_REGISTRY.findIndex((a) => a.id === desc.id);
  if (i >= 0) AGENT_REGISTRY[i] = desc;
  else AGENT_REGISTRY.push(desc);
}
