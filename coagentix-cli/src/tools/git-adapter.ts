// Tool Execution Engine — git adapter. Wraps git.ts's EXISTING simple-git
// wrappers behind the standard ToolAdapter contract; no new git logic. Note:
// push/pull touch a remote, but the permission ladder still classifies this
// adapter as "repo-write" as a whole (its most dangerous local operation,
// commit) rather than per-operation — a caller invoking push should still
// separately confirm network egress is expected for its use case.

import { randomUUID } from "node:crypto";
import {
  commit, createBranch, getCurrentBranch, getDiff, getGit, getStatus,
  pull, push, stageAll, stageFiles,
} from "../git.js";
import type { ToolAdapter, ToolRequest, ToolResponse } from "./types.js";

function errorResponse(executionId: string, t0: number, error: unknown): ToolResponse {
  return {
    executionId, toolId: "git", status: "error",
    error: error instanceof Error ? error.message : String(error),
    durationMs: Date.now() - t0,
  };
}

export const gitAdapter: ToolAdapter = {
  id: "git",
  permission: "repo-write",

  async execute(request: ToolRequest): Promise<ToolResponse> {
    const t0 = Date.now();
    const executionId = randomUUID();
    const root = request.workingDirectory ?? (request.args.root as string | undefined);
    if (!root) return errorResponse(executionId, t0, "workingDirectory (root) required");
    const git = getGit(root);

    try {
      switch (request.operation) {
        case "status": {
          const status = await getStatus(git);
          return { executionId, toolId: "git", status: "success", output: status, durationMs: Date.now() - t0 };
        }
        case "diff": {
          const diff = await getDiff(git, request.args.staged === true);
          return { executionId, toolId: "git", status: "success", output: { diff }, durationMs: Date.now() - t0 };
        }
        case "currentBranch": {
          const branch = await getCurrentBranch(git);
          return { executionId, toolId: "git", status: "success", output: { branch }, durationMs: Date.now() - t0 };
        }
        case "createBranch": {
          const name = request.args.name as string | undefined;
          if (!name) return errorResponse(executionId, t0, "name required");
          await createBranch(git, name);
          return { executionId, toolId: "git", status: "success", durationMs: Date.now() - t0 };
        }
        case "commit": {
          const message = request.args.message as string | undefined;
          if (!message) return errorResponse(executionId, t0, "message required");
          const paths = Array.isArray(request.args.paths) ? (request.args.paths as string[]) : undefined;
          if (paths?.length) await stageFiles(git, paths);
          else await stageAll(git);
          const hash = await commit(git, message);
          return {
            executionId, toolId: "git", status: "success",
            output: { hash }, modifiedFiles: paths, durationMs: Date.now() - t0,
          };
        }
        case "push": {
          await push(git, (request.args.remote as string | undefined) ?? "origin", request.args.branch as string | undefined);
          return { executionId, toolId: "git", status: "success", durationMs: Date.now() - t0 };
        }
        case "pull": {
          await pull(git, (request.args.remote as string | undefined) ?? "origin");
          return { executionId, toolId: "git", status: "success", durationMs: Date.now() - t0 };
        }
        default:
          return errorResponse(executionId, t0, `unknown git operation "${request.operation}"`);
      }
    } catch (e) {
      return errorResponse(executionId, t0, e);
    }
  },
};
