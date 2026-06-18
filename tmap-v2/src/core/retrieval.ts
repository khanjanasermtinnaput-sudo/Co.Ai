// Semantic-ish retrieval (BM25) — ranks project files by relevance to a task.
//
// Upgrade over the old keyword-count scoring in context-engine: BM25 weights
// rare terms higher (IDF) and saturates term frequency, so a file that mentions
// the task's distinctive words ranks above one that just repeats a common word.
//
// Still pure Node, zero API cost. Not true embedding search, but a large step up
// from substring matching and a clean seam to swap in vectors later.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileNode, DependencyGraph } from './context-engine.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'add', 'make', 'create',
  'build', 'new', 'use', 'using', 'file', 'files', 'code', 'app', 'page', 'has',
  'can', 'will', 'should', 'into', 'are', 'was', 'how', 'why', 'what', 'when',
  'function', 'const', 'let', 'var', 'return', 'import', 'export', 'class',
]);

export function tokenize(s: string): string[] {
  return s
    // split camelCase into words BEFORE lowercasing (needs the case boundary)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

interface Doc {
  path: string;
  terms: string[];
  tf: Map<string, number>;
  len: number;
}

export interface RankedFile {
  path: string;
  score: number;
}

export interface RetrievalIndex {
  docs: Doc[];
  df: Map<string, number>;   // document frequency per term
  avgLen: number;
  graph?: DependencyGraph;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const HEAD_CHARS = 4000;

/** Build an in-memory BM25 index over the project files (filename + content head). */
export function buildIndex(rootDir: string, tree: FileNode[], graph?: DependencyGraph): RetrievalIndex {
  const docs: Doc[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const node of tree) {
    let body = '';
    try { body = readFileSync(join(rootDir, node.path), 'utf8').slice(0, HEAD_CHARS); } catch { /* name only */ }
    // weight the path/filename by repeating it — names are strong relevance signals
    const terms = [...tokenize(node.path), ...tokenize(node.path), ...tokenize(body)];
    if (!terms.length) continue;

    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

    docs.push({ path: node.path, terms, tf, len: terms.length });
    totalLen += terms.length;
  }

  return { docs, df, avgLen: docs.length ? totalLen / docs.length : 0, graph };
}

/** Rank files against a query using BM25, with a small dependency-hotspot bonus. */
export function rank(index: RetrievalIndex, query: string, k = 8): RankedFile[] {
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !index.docs.length) return [];

  const N = index.docs.length;
  const idf = new Map<string, number>();
  for (const t of qTerms) {
    const n = index.df.get(t) ?? 0;
    // BM25 idf, floored at a small positive value so common terms still count a bit
    idf.set(t, Math.max(0.05, Math.log(1 + (N - n + 0.5) / (n + 0.5))));
  }

  const ranked: RankedFile[] = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const t of qTerms) {
      const f = doc.tf.get(t);
      if (!f) continue;
      const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (doc.len / (index.avgLen || 1)));
      score += (idf.get(t) ?? 0) * ((f * (BM25_K1 + 1)) / denom);
    }
    if (score <= 0) continue;
    // hotspot bonus: files many others import are more likely to be the right seam
    const importers = index.graph?.importers[doc.path]?.length ?? 0;
    score += Math.min(importers * 0.15, 1.2);
    ranked.push({ path: doc.path, score: Math.round(score * 1000) / 1000 });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, k);
}
