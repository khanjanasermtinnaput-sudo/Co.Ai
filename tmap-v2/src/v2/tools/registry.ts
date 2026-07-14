// v2 — Tool Registry: where ToolAdapters are registered and looked up. Sibling
// of the agent registry (../registry.ts) — same "declare, don't route" spirit:
// callers resolve a tool by id and check its declared permission; they never
// hardcode which adapter handles what.

import type { PermissionLevel, ToolAdapter } from './types.js';

const _tools = new Map<string, ToolAdapter>();

export function registerTool(adapter: ToolAdapter): void {
  _tools.set(adapter.id, adapter);
}

export function getTool(id: string): ToolAdapter | undefined {
  return _tools.get(id);
}

export function listTools(): ToolAdapter[] {
  return [..._tools.values()];
}

/** Fixed permission ladder (spec 6.3 "Permission Levels... must be validated
 *  before execution"). Order matters: e.g. terminal-execute implies more
 *  trust than workspace-write, but nothing implies db-write or admin. */
const LADDER: PermissionLevel[] = [
  'read-only', 'workspace-write', 'repo-write', 'terminal-execute', 'network', 'db-write', 'admin',
];

/** True when `granted` meets or exceeds `required` on the ladder. */
export function permissionSatisfied(granted: PermissionLevel, required: PermissionLevel): boolean {
  return LADDER.indexOf(granted) >= LADDER.indexOf(required);
}
