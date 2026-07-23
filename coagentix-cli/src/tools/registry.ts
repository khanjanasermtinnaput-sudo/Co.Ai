// Tool Registry — CLI side. Same design as tmap-v2's src/v2/tools/registry.ts.

import type { PermissionLevel, ToolAdapter } from "./types.js";

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

const LADDER: PermissionLevel[] = [
  "read-only", "workspace-write", "repo-write", "terminal-execute", "network", "db-write", "admin",
];

export function permissionSatisfied(granted: PermissionLevel, required: PermissionLevel): boolean {
  return LADDER.indexOf(granted) >= LADDER.indexOf(required);
}
