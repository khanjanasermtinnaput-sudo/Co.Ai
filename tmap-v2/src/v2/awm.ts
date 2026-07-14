// v2 — Agent Working Memory (AWM).
//
// Ephemeral, per-node runtime memory for the DAG executor. One AWM per
// ExecNode, isolated: a node's AwmHandle closes only over that node's own
// `awm` field, so agents structurally cannot read another node's memory —
// shared state goes through the ExecutionContextBus (context-bus.ts) instead.
// Persisted as part of the node (checkpoint.ts already serializes/restores
// whichever fields live on ExecNode), so it survives retries and process
// restarts the same way `output`/`status` do. Destroyed with the graph when
// the request completes — nothing here is written to long-term memory
// (core/memory.ts) except what a caller explicitly promotes.

import type { ExecNode } from './dag.js';

export interface AgentWorkingMemory {
  currentTask: string;
  progressNotes: string[];
  intermediateAnalysis?: string;
  extractedSymbols?: string[];
  localWarnings?: string[];
  executionStats: { startedAt: string; tokensUsed?: number; costUsd?: number };
  partialResult?: unknown;
}

export function emptyAwm(currentTask: string): AgentWorkingMemory {
  return {
    currentTask,
    progressNotes: [],
    executionStats: { startedAt: new Date().toISOString() },
  };
}

/** Mutable-write handle over one node's AWM. Never exposes other nodes' state. */
export interface AwmHandle {
  note(s: string): void;
  warn(s: string): void;
  setAnalysis(s: string): void;
  setPartial(v: unknown): void;
  addSymbols(symbols: string[]): void;
  addUsage(tokens: number, costUsd: number): void;
  get(): AgentWorkingMemory;
}

/** Get (or lazily create) the AwmHandle for a node — bound to that node's own
 *  `awm` field, which is what checkpoint.ts persists/restores. */
export function awmHandleFor(node: ExecNode): AwmHandle {
  if (!node.awm) node.awm = emptyAwm(node.id);
  const awm = node.awm;
  return {
    note: (s) => { awm.progressNotes.push(s); },
    warn: (s) => { awm.localWarnings = [...(awm.localWarnings ?? []), s]; },
    setAnalysis: (s) => { awm.intermediateAnalysis = s; },
    setPartial: (v) => { awm.partialResult = v; },
    addSymbols: (symbols) => { awm.extractedSymbols = [...(awm.extractedSymbols ?? []), ...symbols]; },
    addUsage: (tokens, costUsd) => {
      awm.executionStats.tokensUsed = (awm.executionStats.tokensUsed ?? 0) + tokens;
      awm.executionStats.costUsd = (awm.executionStats.costUsd ?? 0) + costUsd;
    },
    get: () => awm,
  };
}
