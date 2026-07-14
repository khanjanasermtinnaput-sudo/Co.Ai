// v2 — Tool Execution Engine contract (Master Prompt Part 6.3).
//
// Standard shape every tool adapter speaks, so a DAG tool node, a future admin
// surface, and any new adapter all agree on one request/response contract
// instead of each tool inventing its own shape the way core/sandbox.ts's
// SandboxOptions/SandboxResult already does independently of, say, a
// hypothetical file-write tool's own shape. This is the seam v2/registry.ts's
// `NodeKind = 'tool'` was declared for but had no implementation behind until
// now (see registry.ts, executor dispatch in v2/run.ts's runAgent).

export type PermissionLevel =
  | 'read-only'
  | 'workspace-write'
  | 'repo-write'
  | 'terminal-execute'
  | 'network'
  | 'db-write'
  | 'admin';

export interface ToolRequest {
  toolId: string;
  operation: string;
  args: Record<string, unknown>;
  workingDirectory?: string;
  timeoutMs?: number;
}

export type ToolResultStatus = 'success' | 'error' | 'timeout' | 'denied';

export interface ToolResponse {
  executionId: string;
  toolId: string;
  status: ToolResultStatus;
  output?: unknown;
  error?: string;
  durationMs: number;
  modifiedFiles?: string[];
}

export interface ToolAdapter {
  id: string;
  /** Minimum permission a caller must be granted to invoke this tool at all —
   *  checked by the registry (permissionSatisfied) before execute() runs. */
  permission: PermissionLevel;
  execute(request: ToolRequest, signal: AbortSignal): Promise<ToolResponse>;
}
