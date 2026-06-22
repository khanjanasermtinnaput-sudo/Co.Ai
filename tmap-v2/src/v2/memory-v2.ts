// v2 — Ranked memory retrieval (Phase 6, 5-factor hybrid scoring).
//
// Ranking formula (weights sum to 1.0):
//   raw = W.importance * dynamicImportance(base, id, freq)   [usage-boosted]
//       + W.recency    * recencyScore(at) * memoryDecay(at)  [two-phase decay]
//       + W.lexical    * lexicalOverlap(query, content)
//       + W.frequency  * frequencyScore(id, freq)            [retrieval count]
//       - conflictPenalty                                    [0 or CONFLICT_PENALTY]
//   score = clamp(raw, 0, 1)
//
// Integration: contextFitFrom(ranked) feeds score.ts → RAA agent selection.
// Usage frequency is persisted via updateUsageFrequency (caller calls saveMemory).

import type { ProjectMemory } from '../core/memory.js';

export interface RankedMemory {
  id: string;
  content: string;
  score: number;
  /** Set on the lower-importance entry when it conflicts with a higher-importance one. */
  conflictsWith?: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RECENCY_HALF_LIFE_DAYS  = 30;
const STALE_THRESHOLD_DAYS    = 90;
const STALE_HALF_LIFE_DAYS    = 45;
const CONFLICT_THRESHOLD      = 0.6; // symmetric Jaccard overlap → conflict
const CONFLICT_PENALTY        = 0.12;

const W = { importance: 0.25, recency: 0.20, lexical: 0.35, frequency: 0.20 };

// ── Scoring components ────────────────────────────────────────────────────────

/** Phase 1 recency: exponential decay from last-touched timestamp (30-day HL). */
export function recencyScore(iso?: string): number {
  if (!iso) return 0.3;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return Math.exp(-Math.max(0, days) / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Phase 2 staleness multiplier: 1.0 for entries under STALE_THRESHOLD_DAYS;
 * additional exponential decay beyond that threshold. Distinct from recencyScore
 * — applies only to ancient entries and is never the sole decay signal.
 */
export function memoryDecay(iso?: string): number {
  if (!iso) return 1.0;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days <= STALE_THRESHOLD_DAYS) return 1.0;
  return Math.exp(-(days - STALE_THRESHOLD_DAYS) / STALE_HALF_LIFE_DAYS);
}

/**
 * Dynamic importance: base category weight boosted by how often this entry has
 * been recalled. Approaches base * 1.3 asymptotically (count >> 3).
 */
export function dynamicImportance(base: number, id: string, freq: Record<string, number>): number {
  const count = freq[id] ?? 0;
  const boost = 0.3 * (1 - Math.exp(-count / 3));
  return Math.min(1.0, base * (1 + boost));
}

/** Normalised usage frequency: 0 at count=0, approaches 1 asymptotically. */
export function frequencyScore(id: string, freq: Record<string, number>): number {
  const count = freq[id] ?? 0;
  return 1 - Math.exp(-count / 5);
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 2);
}

/** Query→entry directional overlap: hit / query-size. Used for ranking. */
function lexicalOverlap(query: string, content: string): number {
  const q = new Set(tokenize(query));
  const c = new Set(tokenize(content));
  if (!q.size || !c.size) return 0;
  let hit = 0;
  for (const t of q) if (c.has(t)) hit++;
  return hit / q.size;
}

/** Symmetric Jaccard overlap between two content strings. Used for conflicts. */
function symmetricOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  const maxSize = Math.max(ta.size, tb.size);
  if (maxSize === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / maxSize;
}

// ── Entry types ───────────────────────────────────────────────────────────────

interface Entry {
  id: string;
  content: string;
  importance: number; // static base weight per category
  at?: string;
}

interface ConflictPair {
  winnerId: string;
  loserId: string;
}

// ── Flatten ProjectMemory → flat Entry list ───────────────────────────────────

function flatten(mem: ProjectMemory): Entry[] {
  const out: Entry[] = [];
  if (mem.techStack) out.push({ id: 'tech', content: `tech stack: ${mem.techStack}`, importance: 0.7 });
  mem.conventions.forEach((c, i) => out.push({ id: `conv-${i}`, content: c, importance: 0.5 }));
  mem.decisions.forEach((d, i) => out.push({ id: `dec-${i}`, content: d, importance: 0.6 }));
  mem.failures.forEach((f, i) => out.push({ id: `fail-${i}`, content: f.problem, importance: 0.65, at: f.at }));
  mem.sessions.forEach((s, i) =>
    out.push({ id: `sess-${i}`, content: `${s.task} → ${s.files.join(', ')}`, importance: 0.4, at: s.at }),
  );
  return out;
}

// ── Conflict resolution ───────────────────────────────────────────────────────

/**
 * Detect conflicting entry pairs: symmetric Jaccard ≥ CONFLICT_THRESHOLD.
 * The entry with lower base importance is the loser and receives CONFLICT_PENALTY.
 */
export function detectConflicts(entries: Entry[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (symmetricOverlap(entries[i].content, entries[j].content) >= CONFLICT_THRESHOLD) {
        const [winner, loser] =
          entries[i].importance >= entries[j].importance
            ? [entries[i], entries[j]]
            : [entries[j], entries[i]];
        pairs.push({ winnerId: winner.id, loserId: loser.id });
      }
    }
  }
  return pairs;
}

// ── Main API ──────────────────────────────────────────────────────────────────

/** Rank memory entries against the query; returns the top `limit`, scored. */
export function rankMemories(query: string, mem: ProjectMemory, limit = 5): RankedMemory[] {
  const freq = mem.usageFrequency ?? {};
  const entries = flatten(mem);
  const conflicts = detectConflicts(entries);

  const loserIds = new Set(conflicts.map((c) => c.loserId));
  const conflictMap = new Map<string, string[]>();
  for (const c of conflicts) {
    const list = conflictMap.get(c.loserId) ?? [];
    list.push(c.winnerId);
    conflictMap.set(c.loserId, list);
  }

  return entries
    .map((e) => {
      const raw =
        W.importance * dynamicImportance(e.importance, e.id, freq) +
        W.recency    * recencyScore(e.at) * memoryDecay(e.at) +
        W.lexical    * lexicalOverlap(query, e.content) +
        W.frequency  * frequencyScore(e.id, freq);

      const penalty = loserIds.has(e.id) ? CONFLICT_PENALTY : 0;
      const score = Math.max(0, Math.min(1, raw - penalty));
      const result: RankedMemory = { id: e.id, content: e.content, score };
      if (conflictMap.has(e.id)) result.conflictsWith = conflictMap.get(e.id);
      return result;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Return an updated frequency map after recalling `ranked` entries (immutable input). */
export function updateUsageFrequency(
  ranked: RankedMemory[],
  freq: Record<string, number>,
): Record<string, number> {
  const updated = { ...freq };
  for (const r of ranked) {
    updated[r.id] = (updated[r.id] ?? 0) + 1;
  }
  return updated;
}

/** A single 0..1 context-fit signal for score.ts.  */
export function contextFitFrom(ranked: RankedMemory[]): number {
  if (!ranked.length) return 0.5;
  const top = ranked[0].score;
  return Math.max(0.3, Math.min(1, 0.4 + 0.6 * top));
}

/** Render ranked memory for prompt injection. */
export function memoriesToContextV2(ranked: RankedMemory[]): string {
  if (!ranked.length) return '';
  return ['## Relevant project memory', ...ranked.map((r) => `- ${r.content}`)].join('\n');
}
