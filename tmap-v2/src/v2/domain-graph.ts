// v2 — Domain execution graph for Ypertatos Normal/High.
//
// Builds an ExecGraph directly from the domains classifyEngineering() found,
// instead of going through RAA's LLM-based decompose+score (raa.ts). Two
// reasons: (1) registry.ts's capability vocabulary has no per-domain
// dimension, so the score-based selector cannot actually distinguish
// "backend" from "frontend" work — only a real capability like `code` or
// `test`; deterministic domain→agent assignment is more faithful than hoping
// cosine similarity discovers it by accident. (2) the domains are already
// known (regex-classified, no LLM call) by the time this runs, so there is
// nothing left to "decompose." Dependency ordering is a fixed, sensible
// default — database/frontend/infrastructure can run in parallel, backend
// waits on database when both are present, testing waits on whatever code
// exists, documentation waits on everything. This directly implements the
// spec's "dependency-ordered, parallel only when independent" requirement
// using the existing generic executeGraph() (bounded parallelism, per-node
// retry/fallback) — no new execution engine needed.

import type { CodeFile } from '../types.js';
import type { EngineeringDomain } from '../core/engineering-classifier.js';
import { createGraph, type ExecGraph, type ExecNode, type RetryPolicy } from './dag.js';
import type { AwmHandle } from './awm.js';
import { ExecutionContextBus } from './context-bus.js';

const DOMAIN_AGENT_ID: Record<EngineeringDomain, string> = {
  database: 'database-agent',
  backend: 'backend-agent',
  frontend: 'frontend-agent',
  testing: 'testing-agent',
  documentation: 'documentation-agent',
  infrastructure: 'infrastructure-agent',
};

/** Dependencies each domain waits on, filtered down to only the domains that
 *  are actually present in this run (a domain with no present dependency
 *  becomes a root node — eligible to run in parallel with other roots). */
function dependenciesFor(domain: EngineeringDomain, present: Set<EngineeringDomain>): EngineeringDomain[] {
  switch (domain) {
    case 'backend':
      return present.has('database') ? ['database'] : [];
    case 'testing':
      return (['backend', 'frontend'] as EngineeringDomain[]).filter((d) => present.has(d));
    case 'documentation':
      return [...present].filter((d) => d !== 'documentation');
    case 'database':
    case 'frontend':
    case 'infrastructure':
      return [];
  }
}

export type DomainAgentRunner = (
  domain: EngineeringDomain,
  agentId: string,
  priorFiles: CodeFile[],
  signal: AbortSignal,
  awm: AwmHandle,
  bus: ExecutionContextBus,
) => Promise<CodeFile[]>;

const RETRY: RetryPolicy = { maxRetries: 1, backoffMs: 400 };
const NODE_TIMEOUT_MS = 60_000;

export function buildDomainGraph(
  requestId: string,
  domains: EngineeringDomain[],
  runner: DomainAgentRunner,
  bus: ExecutionContextBus,
): ExecGraph {
  const present = new Set(domains);
  const nodes: ExecNode[] = domains.map((domain): ExecNode => {
    const agentId = DOMAIN_AGENT_ID[domain];
    return {
      id: domain,
      kind: 'agent',
      agentId,
      fallbackAgentIds: ['coder'], // generic Coder as last resort if the domain agent fails
      dependencies: dependenciesFor(domain, present),
      retry: RETRY,
      timeoutMs: NODE_TIMEOUT_MS,
      status: 'pending',
      attempts: 0,
      run: async (input, signal, boundAgentId, awm) => {
        const priorFiles = Object.values(input as Record<string, unknown>).flat() as CodeFile[];
        awm?.note(`starting ${domain} domain work as ${boundAgentId}`);
        const files = await runner(domain, boundAgentId, priorFiles, signal, awm!, bus);
        awm?.setPartial(files.map((f) => f.path));
        awm?.note(`produced ${files.length} file(s)`);
        return files;
      },
    };
  });
  return createGraph(requestId, nodes);
}

/** Pick a sensible parallel-slot count for a domain graph: enough to let every
 *  root-level domain (no dependencies) run concurrently, capped so a single
 *  request can't monopolise every provider slot. */
export function domainGraphMaxParallel(domainCount: number, deep: boolean): number {
  return Math.min(deep ? 5 : 3, Math.max(1, domainCount));
}
