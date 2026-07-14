// v2 — Execution Context Bus.
//
// Shared state that any node may publish to and any node may read from,
// independent of the DAG's dependency edges. Distinct from Agent Working
// Memory (awm.ts, one-per-node/isolated): the bus is the ONE place agents are
// meant to exchange information with each other, rather than reaching into
// another agent's private working memory. Scoped to a single execution
// (created fresh per graph run, discarded with it) — never persisted long-term.

export interface ContextEntry {
  key: string;
  value: unknown;
  fromNodeId: string;
  ts: string;
}

export class ExecutionContextBus {
  private store = new Map<string, ContextEntry>();

  publish(key: string, value: unknown, fromNodeId: string): void {
    this.store.set(key, { key, value, fromNodeId, ts: new Date().toISOString() });
  }

  read(key: string): unknown | undefined {
    return this.store.get(key)?.value;
  }

  readAll(): ContextEntry[] {
    return [...this.store.values()];
  }

  /** Render every published entry as a labelled text block, for folding into a
   *  downstream agent's prompt without it needing to know the bus's shape. */
  toContext(): string {
    const entries = this.readAll();
    if (!entries.length) return '';
    return entries
      .map((e) => `[${e.key} — published by ${e.fromNodeId}]\n${typeof e.value === 'string' ? e.value : JSON.stringify(e.value)}`)
      .join('\n\n');
  }
}
