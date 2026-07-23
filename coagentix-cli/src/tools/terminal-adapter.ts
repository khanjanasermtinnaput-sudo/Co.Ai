// Tool Execution Engine — terminal adapter. Wraps terminal.ts's EXISTING
// allowlist/blocklist-gated execCommand behind the standard ToolAdapter
// contract. The permission check here is the ToolRegistry's coarse
// "terminal-execute or above" gate; the fine-grained per-command allowlist
// still lives in terminal.ts's isCommandAllowed and runs unchanged — this
// adapter surfaces that decision as status "denied" instead of a generic
// "error" so a caller (or a future admin view) can tell "the tool refused
// this command" apart from "the command ran and failed".

import { randomUUID } from "node:crypto";
import { execCommand, isCommandAllowed } from "../terminal.js";
import type { ToolAdapter, ToolRequest, ToolResponse } from "./types.js";

export const terminalAdapter: ToolAdapter = {
  id: "terminal",
  permission: "terminal-execute",

  async execute(request: ToolRequest): Promise<ToolResponse> {
    const t0 = Date.now();
    const executionId = randomUUID();
    const cmd = request.args.cmd as string | undefined;
    const args = Array.isArray(request.args.args) ? (request.args.args as string[]) : [];
    const cwd = request.workingDirectory ?? (request.args.cwd as string | undefined);

    if (!cmd) {
      return { executionId, toolId: "terminal", status: "error", error: "cmd required", durationMs: Date.now() - t0 };
    }
    if (!cwd) {
      return { executionId, toolId: "terminal", status: "error", error: "workingDirectory (cwd) required", durationMs: Date.now() - t0 };
    }

    const check = isCommandAllowed(cmd, args);
    if (!check.allowed) {
      return {
        executionId, toolId: "terminal", status: "denied",
        error: check.reason, durationMs: Date.now() - t0,
      };
    }

    const result = execCommand(cmd, args, cwd, request.timeoutMs);
    return {
      executionId,
      toolId: "terminal",
      status: result.success ? "success" : "error",
      output: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
      error: result.success ? undefined : result.stderr,
      durationMs: Date.now() - t0,
    };
  },
};
