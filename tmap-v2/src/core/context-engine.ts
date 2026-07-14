// Context Engine v2 — structured project understanding for the TMAP pipeline.
//
// Goes beyond context.ts (flat tech-stack summary) by adding:
//   - full project file tree
//   - import/require dependency graph (ts/js/py)
//   - granular project type detection ('node-express-ts', 'react-ts', ...)
//   - task-relevant file selection (TF scoring, zero LLM calls)
//   - coding convention detection (indent, quotes, semicolons)
//
// Everything here is pure Node — no network, no API cost.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname, basename } from 'node:path';
import { gatherProjectContext, type ProjectContext } from './context.js';
import { buildIndex, rank, type RetrievalIndex } from './retrieval.js';

export interface FileNode {
  path: string;   // project-relative, posix separators
  size: number;
  ext: string;
}

export interface DependencyGraph {
  /** file -> project files it imports */
  imports: Record<string, string[]>;
  /** file -> project files that import it */
  importers: Record<string, string[]>;
}

export interface ProjectContextV2 {
  base: ProjectContext;
  projectType: string;
  tree: FileNode[];
  graph: DependencyGraph;
  relevantFiles: string[];
  conventions: string[];
  summary: string;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.aof', '.aof-server',
  '__pycache__', '.next', 'coverage', 'vendor', 'target', '.venv', 'venv',
]);

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.cs', '.cpp', '.c', '.h', '.vue', '.svelte', '.sql',
  '.html', '.css', '.json', '.md',
]);

// ── file tree ─────────────────────────────────────────────────────────────────

export function readProjectTree(rootDir: string, maxFiles = 400): FileNode[] {
  const out: FileNode[] = [];
  walk(rootDir, rootDir, out, maxFiles, 0);
  return out;
}

function walk(root: string, dir: string, out: FileNode[], max: number, depth: number): void {
  if (depth > 5 || out.length >= max) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (out.length >= max) return;
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      walk(root, full, out, max, depth + 1);
    } else if (SOURCE_EXTS.has(extname(entry))) {
      out.push({
        path: rel(root, full),
        size: st.size,
        ext: extname(entry),
      });
    }
  }
}

function rel(root: string, full: string): string {
  let r = full.startsWith(root) ? full.slice(root.length) : full;
  r = r.replace(/\\/g, '/');
  return r.startsWith('/') ? r.slice(1) : r;
}

// ── dependency graph ──────────────────────────────────────────────────────────

const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js'];

export function buildDependencyGraph(rootDir: string, tree: FileNode[]): DependencyGraph {
  const known = new Set(tree.map((f) => f.path));
  const imports: Record<string, string[]> = {};
  const importers: Record<string, string[]> = {};

  for (const node of tree) {
    if (!JS_EXTS.has(node.ext) && node.ext !== '.py') continue;
    let src: string;
    try { src = readFileSync(join(rootDir, node.path), 'utf8'); } catch { continue; }

    const targets = new Set<string>();
    if (JS_EXTS.has(node.ext)) {
      for (const spec of jsImportSpecs(src)) {
        if (!spec.startsWith('.')) continue; // external package — skip
        const resolved = resolveJsImport(node.path, spec, known);
        if (resolved) targets.add(resolved);
      }
    } else {
      for (const mod of pyImportModules(src)) {
        const resolved = resolvePyImport(node.path, mod, known);
        if (resolved) targets.add(resolved);
      }
    }

    if (targets.size) {
      imports[node.path] = [...targets];
      for (const t of targets) {
        (importers[t] ??= []).push(node.path);
      }
    }
  }
  return { imports, importers };
}

function jsImportSpecs(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1] ?? m[2] ?? m[3]);
  return specs;
}

function resolveJsImport(fromFile: string, spec: string, known: Set<string>): string | null {
  // tsx/ESM convention: import './x.js' may map to './x.ts' on disk
  const bases = [spec, spec.replace(/\.(js|jsx|mjs|cjs)$/, '')];
  const fromDir = dirname(fromFile);
  for (const base of bases) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = normalizePath(join(fromDir, base + suffix));
      if (known.has(candidate)) return candidate;
    }
  }
  return null;
}

function pyImportModules(src: string): string[] {
  const mods: string[] = [];
  const re = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) mods.push(m[1] ?? m[2]);
  return mods;
}

function resolvePyImport(fromFile: string, mod: string, known: Set<string>): string | null {
  const asPath = mod.replace(/\./g, '/');
  const fromDir = dirname(fromFile);
  for (const candidate of [
    normalizePath(join(fromDir, asPath + '.py')),
    normalizePath(asPath + '.py'),
    normalizePath(join(fromDir, asPath, '__init__.py')),
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

// ── project type ──────────────────────────────────────────────────────────────

export function detectProjectType(base: ProjectContext, tree: FileNode[]): string {
  const deps = new Set([...base.dependencies, ...base.devDependencies]);
  const hasTs = deps.has('typescript') || tree.some((f) => f.ext === '.ts' || f.ext === '.tsx');

  if (base.type === 'node') {
    const lang = hasTs ? 'ts' : 'js';
    if (deps.has('next')) return `nextjs-${lang}`;
    if (deps.has('react')) return `react-${lang}`;
    if (deps.has('vue')) return `vue-${lang}`;
    if (deps.has('svelte')) return `svelte-${lang}`;
    if (deps.has('express') || deps.has('fastify') || deps.has('koa')) return `node-api-${lang}`;
    return `node-${lang}`;
  }
  if (base.type === 'python') {
    if (base.dependencies.includes('fastapi')) return 'python-fastapi';
    if (base.dependencies.includes('django')) return 'python-django';
    if (base.dependencies.includes('flask')) return 'python-flask';
    return 'python';
  }
  if (base.type !== 'unknown') return base.type;
  if (tree.some((f) => f.ext === '.html')) return 'static-web';
  return 'unknown';
}

// ── relevance scoring (task -> files) — BM25 via retrieval.ts ──────────────────

export function selectRelevantFiles(
  rootDir: string, task: string, tree: FileNode[], graph: DependencyGraph, k = 8,
  index?: RetrievalIndex,
): string[] {
  if (!task.trim()) return [];
  const idx = index ?? buildIndex(rootDir, tree, graph);
  return rank(idx, task, k).map((r) => r.path);
}

// ── convention detection ──────────────────────────────────────────────────────

export function detectConventions(rootDir: string, tree: FileNode[]): string[] {
  const samples = tree.filter((f) => JS_EXTS.has(f.ext) || f.ext === '.py').slice(0, 12);
  if (!samples.length) return [];

  let tabs = 0, two = 0, four = 0, single = 0, dbl = 0, semi = 0, noSemi = 0;
  for (const f of samples) {
    let src: string;
    try { src = readFileSync(join(rootDir, f.path), 'utf8').slice(0, 6000); } catch { continue; }
    for (const line of src.split('\n').slice(0, 120)) {
      if (line.startsWith('\t')) tabs++;
      else if (line.startsWith('    ')) four++;
      else if (line.startsWith('  ') && !line.startsWith('    ')) two++;
      single += (line.match(/'[^']*'/g) ?? []).length;
      dbl += (line.match(/"[^"]*"/g) ?? []).length;
      const t = line.trim();
      if (/[)\w\]'"`]$/.test(t) && JS_EXTS.has(f.ext)) {
        if (t.endsWith(';')) semi++; else noSemi++;
      }
    }
  }

  const conventions: string[] = [];
  const indent = tabs > two && tabs > four ? 'tabs' : four > two ? '4 spaces' : '2 spaces';
  conventions.push(`indentation: ${indent}`);
  if (single + dbl > 10) conventions.push(`quotes: ${single >= dbl ? 'single' : 'double'}`);
  if (semi + noSemi > 10) conventions.push(`semicolons: ${semi >= noSemi ? 'yes' : 'no'}`);

  if (existsSync(join(rootDir, 'tsconfig.json'))) {
    try {
      const ts = readFileSync(join(rootDir, 'tsconfig.json'), 'utf8');
      if (/"strict"\s*:\s*true/.test(ts)) conventions.push('typescript: strict mode');
      if (/"module"\s*:\s*"(esnext|nodenext|es2022)"/i.test(ts)) conventions.push('modules: ESM');
    } catch { /* ignore */ }
  }
  return conventions;
}

// ── assembly ──────────────────────────────────────────────────────────────────

const MAX_EXCERPT_LINES = 30;
const MAX_EXCERPT_TOTAL = 4500;

// Per-root scan cache so repeated runs in the same server process don't re-walk
// and re-index the whole tree. Short TTL keeps it fresh enough for active editing.
interface ScanCache {
  at: number;
  base: ProjectContext;
  tree: FileNode[];
  graph: DependencyGraph;
  index: RetrievalIndex;
  conventions: string[];
  projectType: string;
}
const SCAN_TTL_MS = 15_000;
const scanCache = new Map<string, ScanCache>();

function getScan(rootDir: string): ScanCache {
  const cached = scanCache.get(rootDir);
  if (cached && Date.now() - cached.at < SCAN_TTL_MS) return cached;

  const base = gatherProjectContext(rootDir);
  const tree = readProjectTree(rootDir);
  const graph = buildDependencyGraph(rootDir, tree);
  const index = buildIndex(rootDir, tree, graph);
  const conventions = detectConventions(rootDir, tree);
  const projectType = detectProjectType(base, tree);

  const scan: ScanCache = { at: Date.now(), base, tree, graph, index, conventions, projectType };
  scanCache.set(rootDir, scan);
  return scan;
}

/** Clear the scan cache (call after writing files to a project root). */
export function invalidateScan(rootDir?: string): void {
  if (rootDir) scanCache.delete(rootDir);
  else scanCache.clear();
}

export function buildContextV2(rootDir = process.cwd(), task = ''): ProjectContextV2 {
  const { base, tree, graph, index, conventions, projectType } = getScan(rootDir);
  const relevantFiles = task ? selectRelevantFiles(rootDir, task, tree, graph, 8, index) : [];

  const summary = buildSummaryV2(rootDir, {
    base, projectType, tree, graph, relevantFiles, conventions, summary: '',
  });

  return { base, projectType, tree, graph, relevantFiles, conventions, summary };
}

function buildSummaryV2(rootDir: string, ctx: ProjectContextV2): string {
  if (ctx.base.type === 'unknown' && !ctx.tree.length) return '';
  const lines: string[] = [];

  if (ctx.base.techStack) lines.push(`Tech Stack: ${ctx.base.techStack}`);
  lines.push(`Project Type: ${ctx.projectType}`);
  if (ctx.base.dependencies.length) {
    lines.push(`Dependencies: ${ctx.base.dependencies.slice(0, 20).join(', ')}`);
  }
  if (ctx.conventions.length) {
    lines.push(`Code Conventions: ${ctx.conventions.join(' · ')}`);
  }

  // dependency hotspots — files the rest of the project leans on
  const hotspots = Object.entries(ctx.graph.importers)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .filter(([, v]) => v.length >= 2);
  if (hotspots.length) {
    lines.push(`Core modules (most imported): ${hotspots.map(([f, v]) => `${f} (${v.length})`).join(', ')}`);
  }

  if (ctx.tree.length) {
    lines.push(`Existing files (${ctx.tree.length}): ${ctx.tree.slice(0, 30).map((f) => f.path).join(', ')}`);
  }

  // excerpts of the most relevant files so agents extend instead of duplicate
  if (ctx.relevantFiles.length) {
    lines.push('', 'Most relevant existing files for this task:');
    let budget = MAX_EXCERPT_TOTAL;
    for (const path of ctx.relevantFiles.slice(0, 4)) {
      if (budget <= 0) break;
      let excerpt = '';
      try {
        excerpt = readFileSync(join(rootDir, path), 'utf8')
          .split('\n').slice(0, MAX_EXCERPT_LINES).join('\n');
      } catch { continue; }
      excerpt = excerpt.slice(0, budget);
      budget -= excerpt.length;
      lines.push(`--- ${path} ---`, excerpt);
    }
    const rest = ctx.relevantFiles.slice(4);
    if (rest.length) lines.push(`Also relevant: ${rest.join(', ')}`);
    lines.push('', 'IMPORTANT: modify/extend these existing files where appropriate instead of creating duplicates.');
  }

  return lines.join('\n');
}

// ── Runtime Context Package — Master Prompt v1.0 Part 6.1 ────────────────────
//
// Everything above builds ONE layer (repository context). This assembles the
// full cross-source package the spec describes: current request, recent
// conversation, repository context, and memory, ranked in priority order and
// budgeted so the total never exceeds a configured character ceiling. This is
// additive — buildContextV2()'s signature and behaviour are unchanged, so
// existing callers (core/orchestrator.ts) are unaffected. Callers that also
// have conversation/memory text (e.g. v2/run.ts) can route through this to
// get the same ranking/budgeting/logging every tier is meant to share.

export type RuntimeContextLayerName = 'current-request' | 'conversation' | 'repository' | 'memory';

export interface RuntimeContextLayer {
  name: RuntimeContextLayerName;
  rawChars: number;
  includedChars: number;
  included: boolean;
}

export interface RuntimeContextPackage {
  text: string;
  layers: RuntimeContextLayer[];
  totalChars: number;
  maxChars: number;
  /** includedChars / rawChars across all layers — 1 means nothing was cut. */
  compressionRatio: number;
  discardedSources: string[];
}

export interface RuntimeContextInput {
  currentRequest: string;
  conversation?: string;
  repository?: string;
  memory?: string;
  maxChars?: number;
}

const DEFAULT_MAX_CONTEXT_CHARS = 60_000;
// Dedup only removes lines long/distinctive enough to be a real repeated
// instruction or message — short lines (`}`, `return x;`) are extremely common
// across unrelated code excerpts and stripping them would corrupt a snippet's
// meaning rather than compress genuine repetition.
const DEDUP_MIN_LINE_LENGTH = 20;

/**
 * Assembles the Runtime Context Package: ranks current request > recent
 * conversation > repository > memory (spec Layers 1/2/5/6), truncates each to
 * whatever budget remains after higher-priority layers, drops a layer
 * entirely once the budget is exhausted, and de-duplicates lines a
 * higher-priority layer already contributed. The current request is never
 * truncated — everything else yields to it.
 */
export function assembleRuntimeContext(input: RuntimeContextInput): RuntimeContextPackage {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const candidates: { name: RuntimeContextLayerName; label: string; raw: string }[] = [
    { name: 'current-request', label: 'Current Request', raw: input.currentRequest ?? '' },
    { name: 'conversation', label: 'Recent Conversation', raw: input.conversation ?? '' },
    { name: 'repository', label: 'Repository Context', raw: input.repository ?? '' },
    { name: 'memory', label: 'Project Memory', raw: input.memory ?? '' },
  ];

  const seenLines = new Set<string>();
  const layers: RuntimeContextLayer[] = [];
  const blocks: string[] = [];
  const discardedSources: string[] = [];
  let remaining = maxChars;

  for (const c of candidates) {
    const rawChars = c.raw.length;
    if (!rawChars) {
      layers.push({ name: c.name, rawChars: 0, includedChars: 0, included: false });
      continue;
    }

    const deduped = c.raw
      .split('\n')
      .filter((line) => {
        const key = line.trim();
        if (key.length < DEDUP_MIN_LINE_LENGTH) return true;
        if (seenLines.has(key)) return false;
        seenLines.add(key);
        return true;
      })
      .join('\n');

    const isCurrentRequest = c.name === 'current-request';
    const budget = isCurrentRequest ? deduped.length : Math.max(0, remaining);
    const truncated = deduped.slice(0, budget);

    if (!truncated) {
      discardedSources.push(c.label);
      layers.push({ name: c.name, rawChars, includedChars: 0, included: false });
      continue;
    }

    // Current Request is exempt from ITS OWN budget check (never truncated),
    // but still counts against what's left for lower-priority layers.
    remaining -= truncated.length;
    layers.push({ name: c.name, rawChars, includedChars: truncated.length, included: true });
    blocks.push(`## ${c.label}\n${truncated}`);
  }

  const totalRaw = layers.reduce((s, l) => s + l.rawChars, 0);
  const totalIncluded = layers.reduce((s, l) => s + l.includedChars, 0);

  return {
    text: blocks.join('\n\n'),
    layers,
    totalChars: totalIncluded,
    maxChars,
    compressionRatio: totalRaw > 0 ? totalIncluded / totalRaw : 1,
    discardedSources,
  };
}

/** Hash a project root path into a short stable key (for memory storage). */
export function projectKey(rootDir: string): string {
  let h = 0;
  for (let i = 0; i < rootDir.length; i++) {
    h = ((h << 5) - h + rootDir.charCodeAt(i)) | 0;
  }
  return basename(rootDir).replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Math.abs(h).toString(36);
}
