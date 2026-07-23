// Tool Execution Engine — filesystem adapter. Wraps files.ts's EXISTING
// snapshot/apply/read/list functions behind the standard ToolAdapter contract;
// no new file-write logic. Note: this does not itself replace cli.ts's
// applyWithConfirm() pipeline (security gate → patch validation → interactive
// confirm → checkpoint → apply → build validation → auto-rollback) — that
// remains the safe path for CLI commands. This adapter exists so a DAG-style
// tool node (or any other standardized caller) can invoke the same underlying
// file operations through one contract instead of calling files.ts directly.

import { randomUUID } from "node:crypto";
import { applyChanges, fileExists, listDir, readFileContent, type FileChange } from "../files.js";
import type { ToolAdapter, ToolRequest, ToolResponse } from "./types.js";

function errorResponse(executionId: string, t0: number, error: unknown): ToolResponse {
  return {
    executionId, toolId: "fs", status: "error",
    error: error instanceof Error ? error.message : String(error),
    durationMs: Date.now() - t0,
  };
}

export const fsAdapter: ToolAdapter = {
  id: "fs",
  permission: "workspace-write",

  async execute(request: ToolRequest): Promise<ToolResponse> {
    const t0 = Date.now();
    const executionId = randomUUID();
    const root = request.workingDirectory ?? (request.args.root as string | undefined);
    if (!root) return errorResponse(executionId, t0, "workingDirectory (root) required");

    try {
      switch (request.operation) {
        case "apply": {
          const changes = request.args.changes as FileChange[] | undefined;
          if (!Array.isArray(changes) || !changes.length) {
            return errorResponse(executionId, t0, "changes (FileChange[]) required");
          }
          applyChanges(root, changes);
          return {
            executionId, toolId: "fs", status: "success",
            modifiedFiles: changes.map((c) => c.newPath ?? c.path),
            durationMs: Date.now() - t0,
          };
        }
        case "read": {
          const path = request.args.path as string | undefined;
          if (!path) return errorResponse(executionId, t0, "path required");
          const content = readFileContent(root, path);
          return { executionId, toolId: "fs", status: "success", output: { content }, durationMs: Date.now() - t0 };
        }
        case "list": {
          const path = (request.args.path as string | undefined) ?? ".";
          const entries = listDir(root, path);
          return { executionId, toolId: "fs", status: "success", output: { entries }, durationMs: Date.now() - t0 };
        }
        case "exists": {
          const path = request.args.path as string | undefined;
          if (!path) return errorResponse(executionId, t0, "path required");
          const exists = fileExists(root, path);
          return { executionId, toolId: "fs", status: "success", output: { exists }, durationMs: Date.now() - t0 };
        }
        default:
          return errorResponse(executionId, t0, `unknown fs operation "${request.operation}"`);
      }
    } catch (e) {
      return errorResponse(executionId, t0, e);
    }
  },
};
