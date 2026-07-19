// v2 — Code-exec ToolAdapter: wraps the EXISTING sandbox (core/sandbox.ts,
// core/docker-sandbox.ts, core/sandbox-policy.ts) behind the standard
// ToolAdapter contract, reusing the exact engine-selection logic the
// /v1/sandbox/run HTTP route already uses (resolveSandboxEngine) — no new
// execution logic, just a standardized front door onto it.
//
// This is deliberately the ONLY tool wired into the v2 DAG engine today: it's
// ephemeral and sandboxed, so a server-side node can safely invoke it. A real
// fs/git/terminal tool needs the user's actual local project, which this
// server-side engine never has access to — the CLI runs those locally where
// the repo is, gated by its own files.ts/git.ts/terminal.ts safety checks
// (coagentix-cli/src/), with no adapter layer in between.

import { randomUUID } from 'node:crypto';
import { runInSandbox, SUPPORTED_LANGUAGES } from '../../core/sandbox.js';
import { runInDockerSandbox, isDockerAvailable } from '../../core/docker-sandbox.js';
import { resolveSandboxEngine } from '../../core/sandbox-policy.js';
import type { SandboxInputFile, SandboxLanguage } from '../../types.js';
import type { ToolAdapter, ToolRequest, ToolResponse } from './types.js';

export const codeExecAdapter: ToolAdapter = {
  id: 'code-exec',
  // Runs in an isolated sandbox rather than the real workspace, but still
  // above read-only since it executes arbitrary code the caller supplied.
  permission: 'workspace-write',

  async execute(request: ToolRequest): Promise<ToolResponse> {
    const t0 = Date.now();
    const executionId = randomUUID();
    const language = request.args.language as SandboxLanguage | undefined;
    const code = request.args.code as string | undefined;

    if (!language || !SUPPORTED_LANGUAGES.includes(language)) {
      return {
        executionId, toolId: 'code-exec', status: 'error',
        error: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
        durationMs: Date.now() - t0,
      };
    }
    if (!code || typeof code !== 'string') {
      return {
        executionId, toolId: 'code-exec', status: 'error',
        error: 'code (string) required', durationMs: Date.now() - t0,
      };
    }

    const decision = resolveSandboxEngine({
      dockerRequested: request.args.docker === true,
      dockerAvailable: isDockerAvailable(),
    });
    if (decision.engine === 'none') {
      return {
        executionId, toolId: 'code-exec', status: 'denied',
        error: decision.reason, durationMs: Date.now() - t0,
      };
    }

    const opts = {
      language,
      code,
      timeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : undefined,
      files: Array.isArray(request.args.files) ? (request.args.files as SandboxInputFile[]) : undefined,
    };
    const result = decision.engine === 'docker' ? await runInDockerSandbox(opts) : await runInSandbox(opts);

    return {
      executionId,
      toolId: 'code-exec',
      status: result.success ? 'success' : result.timedOut ? 'timeout' : 'error',
      output: { stdout: result.stdout, stderr: result.stderr, filesCreated: result.filesCreated },
      error: result.success ? undefined : (result.error ?? result.stderr),
      durationMs: Date.now() - t0,
    };
  },
};
