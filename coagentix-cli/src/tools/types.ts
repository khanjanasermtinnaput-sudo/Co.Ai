// Tool Execution Engine contract (Master Prompt Part 6.3) — CLI side.
//
// Identical shape to tmap-v2's src/v2/tools/types.ts. Duplicated rather than
// imported: this CLI and the tmap-v2 server are separate deployable packages
// (no shared workspace/node_modules), the same reason PROVIDERS/config already
// exist independently in both. Keep the two files in sync by hand if the
// contract changes — it is intentionally small and stable.

export type PermissionLevel =
  | "read-only"
  | "workspace-write"
  | "repo-write"
  | "terminal-execute"
  | "network"
  | "db-write"
  | "admin";

export interface ToolRequest {
  toolId: string;
  operation: string;
  args: Record<string, unknown>;
  workingDirectory?: string;
  timeoutMs?: number;
}

export type ToolResultStatus = "success" | "error" | "timeout" | "denied";

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
  permission: PermissionLevel;
  execute(request: ToolRequest, signal: AbortSignal): Promise<ToolResponse>;
}
