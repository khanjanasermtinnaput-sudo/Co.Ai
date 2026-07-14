// v2 — Result Integrator.
//
// Merges the CodeFile[] output of every completed domain node into one
// coherent file set. Two domain agents can legitimately both touch the same
// path (e.g. backend and database both editing a shared schema file) — when
// that happens this is a real conflict, not just concatenation, so it's
// resolved explicitly (and reported) rather than one silently clobbering the
// other with no record of it happening.

import type { CodeFile } from '../types.js';
import type { ExecGraph } from './dag.js';
import type { EngineeringDomain } from '../core/engineering-classifier.js';

export interface IntegrationConflict {
  path: string;
  domains: string[]; // domain node ids that both produced this path
  resolution: 'kept-last';
}

export interface IntegrationResult {
  files: CodeFile[];
  conflicts: IntegrationConflict[];
}

/** Collect every domain node's file output, in dependency-topological node
 *  insertion order (the order the caller built the graph in — later domains
 *  in that order are assumed to have seen and built on earlier ones' output,
 *  so on a path conflict the later domain's version wins). */
export function integrateResults(graph: ExecGraph, domainOrder: EngineeringDomain[]): IntegrationResult {
  const byPath = new Map<string, { file: CodeFile; domains: string[] }>();
  const conflicts: IntegrationConflict[] = [];

  for (const domain of domainOrder) {
    const node = graph.nodes.get(domain);
    if (!node || node.status !== 'done') continue;
    const files = (node.output as CodeFile[] | undefined) ?? [];
    for (const file of files) {
      const existing = byPath.get(file.path);
      if (existing) {
        existing.domains.push(domain);
        conflicts.push({ path: file.path, domains: [...existing.domains], resolution: 'kept-last' });
        byPath.set(file.path, { file, domains: existing.domains }); // later domain wins
      } else {
        byPath.set(file.path, { file, domains: [domain] });
      }
    }
  }

  return { files: [...byPath.values()].map((v) => v.file), conflicts };
}
