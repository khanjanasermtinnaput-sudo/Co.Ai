// v2 — Ranked memory retrieval (Phase 5, hybrid lexical + signals).
//
// Turns the per-user ProjectMemory into ranked entries and a single contextFit
// signal the scorer consumes. Ranking blends importance, recency-decay and
// lexical overlap with the query. (Usage-frequency + embeddings columns exist
// in the v2 migration and slot into the same formula later.)

import type { ProjectMemory } from '../core/memory.js';

export interface RankedMemory {
  id: string;
  content: string;
  score: number;
}

const HALF_LIFE_DAYS = 30;

function recencyDecay(iso?: string): number {
  if (!iso) return 0.3;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return Math.exp(-Math.max(0, days) / HALF_LIFE_DAYS);
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 2);
}

function lexicalOverlap(query: string, content: string): number {
  const q = new Set(tokenize(query));
  const c = new Set(tokenize(content));
  if (!q.size || !c.size) return 0;
  let hit = 0;
  for (const t of q) if (c.has(t)) hit++;
  return hit / q.size;
}

interface Entry {
  id: string;
  content: string;
  importance: number;
  at?: string;
}

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

const W = { importance: 0.35, recency: 0.25, lexical: 0.4 };

/** Rank memory entries against the query; returns the top `limit`, scored. */
export function rankMemories(query: string, mem: ProjectMemory, limit = 5): RankedMemory[] {
  return flatten(mem)
    .map((e) => ({
      id: e.id,
      content: e.content,
      score:
        W.importance * e.importance +
        W.recency * recencyDecay(e.at) +
        W.lexical * lexicalOverlap(query, e.content),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A single 0..1 context-fit signal for score.ts. Relevant memory pushes it up;
 *  absent/irrelevant memory stays near a neutral baseline. */
export function contextFitFrom(ranked: RankedMemory[]): number {
  if (!ranked.length) return 0.5;
  const top = ranked[0].score; // already 0..~1
  return Math.max(0.3, Math.min(1, 0.4 + 0.6 * top));
}

/** Render ranked memory for prompt injection. */
export function memoriesToContextV2(ranked: RankedMemory[]): string {
  if (!ranked.length) return '';
  return ['## Relevant project memory', ...ranked.map((r) => `- ${r.content}`)].join('\n');
}
