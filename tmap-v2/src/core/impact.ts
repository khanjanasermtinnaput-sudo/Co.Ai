// Impact Analysis Engine — pre-flight "what breaks if I touch this?" check.
//
// Uses the dependency graph from the Context Engine. For every file the Architect
// plans to MODIFY, it walks the importer chain to find which other files depend
// on it (transitively), and flags risk based on how many dependents exist and
// whether they are themselves core modules. Runs before code generation so the
// user/pipeline sees breakage risk up-front. Zero API cost.

import type { DependencyGraph } from './context-engine.js';
import type { ImpactReport, ImpactRisk } from '../types.js';

export interface ImpactInput {
  graph?: DependencyGraph;
  modifyFiles: string[];   // files the Architect intends to change
  knownFiles?: Set<string>;
}

/** Transitive importers of a file (who depends on it, directly or indirectly). */
export function transitiveImporters(graph: DependencyGraph, file: string, max = 50): string[] {
  const seen = new Set<string>();
  const stack = [...(graph.importers[file] ?? [])];
  while (stack.length && seen.size < max) {
    const cur = stack.pop()!;
    if (seen.has(cur) || cur === file) continue;
    seen.add(cur);
    for (const up of graph.importers[cur] ?? []) {
      if (!seen.has(up)) stack.push(up);
    }
  }
  return [...seen];
}

export function analyzeImpact(input: ImpactInput): ImpactReport {
  const { graph, modifyFiles } = input;

  if (!graph || !modifyFiles.length || !Object.keys(graph.importers).length) {
    return {
      risks: [],
      affectedFiles: [],
      summary: modifyFiles.length
        ? 'No dependency graph available — impact analysis skipped (likely a fresh project).'
        : 'No existing files to modify — new code only, nothing to break.',
      skipped: true,
    };
  }

  const risks: ImpactRisk[] = [];
  const affected = new Set<string>();

  for (const file of modifyFiles) {
    const dependents = transitiveImporters(graph, file);
    for (const d of dependents) affected.add(d);

    let level: ImpactRisk['level'] = 'low';
    if (dependents.length >= 5) level = 'high';
    else if (dependents.length >= 2) level = 'med';

    const reason = dependents.length
      ? `${dependents.length} file(s) depend on ${file}; changing its exports/signatures may break them.`
      : `${file} has no known dependents — safe to change in isolation.`;

    risks.push({ file, level, reason, affects: dependents.slice(0, 12) });
  }

  // Sort highest risk first
  const order = { high: 0, med: 1, low: 2 };
  risks.sort((a, b) => order[a.level] - order[b.level]);

  return {
    risks,
    affectedFiles: [...affected],
    summary: buildSummary(risks, affected.size),
  };
}

function buildSummary(risks: ImpactRisk[], affectedCount: number): string {
  const high = risks.filter((r) => r.level === 'high').length;
  const med = risks.filter((r) => r.level === 'med').length;
  if (!risks.length) return 'No files to modify — no impact.';
  const parts = [`${risks.length} file(s) to modify, ${affectedCount} dependent file(s) affected.`];
  if (high) parts.push(`${high} HIGH-risk change(s) — review carefully.`);
  if (med) parts.push(`${med} medium-risk change(s).`);
  if (!high && !med) parts.push('All changes low-risk.');
  return parts.join(' ');
}

/** Render the report as a context block to warn the Coder before it edits. */
export function impactToContext(report: ImpactReport): string {
  if (report.skipped || !report.risks.length) return '';
  const lines: string[] = ['## Impact Analysis (be careful editing these)'];
  for (const r of report.risks.filter((x) => x.level !== 'low')) {
    lines.push(`- [${r.level.toUpperCase()}] ${r.file}: ${r.reason}`);
    if (r.affects.length) lines.push(`  affects: ${r.affects.join(', ')}`);
  }
  lines.push('Keep public exports/signatures of these files backward-compatible unless the task requires otherwise.');
  return lines.join('\n');
}
