// v2 — code-exec tool dispatch (Master Prompt 6.3). Sibling of
// core/research-agent.ts / writing-agent.ts / math-agent.ts / vision-agent.ts:
// v2/run.ts's runAgent delegates the 'code-exec' case here, the same way it
// delegates 'research'/'writing'/'math'/'vision' to their dedicated modules,
// so this is independently testable without going through RAA's full
// (LLM-backed, mocked-in-tests) intent/decompose pipeline.

import { globalToolRegistry } from './tools/index.js';
import type { PermissionLevel } from './tools/types.js';
import type { SandboxLanguage } from '../types.js';

// The v2 engine's own tool calls (as opposed to a future, per-caller-scoped
// grant) run at this fixed level — enough for the one tool wired in today
// (code-exec, permission 'workspace-write'). Real enforcement, not a bypass:
// a future tool requiring more (e.g. 'db-write') would still be correctly
// denied here until this grant is deliberately raised.
export const V2_GRANTED_PERMISSION: PermissionLevel = 'workspace-write';

const SANDBOX_LANGUAGE_ALIASES: Record<string, SandboxLanguage> = {
  js: 'javascript', javascript: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  py: 'python', python: 'python',
};

/** Extract the most recent fenced code block from prior node outputs — the
 *  code-exec tool node needs an actual {language, code} payload, not free
 *  text, and a dependency's coder-agent output is where that lives. */
export function extractCodeFence(text: string): { language: SandboxLanguage; code: string } | null {
  const matches = [...text.matchAll(/```(\w+)?\n([\s\S]*?)```/g)];
  if (!matches.length) return null;
  const [, rawLang, code] = matches[matches.length - 1];
  const language = SANDBOX_LANGUAGE_ALIASES[(rawLang ?? '').toLowerCase()] ?? 'javascript';
  return { language, code: code.trim() };
}

export interface CodeExecToolInput {
  nodeId: string;
  /** Free text to search for a fenced code block: normally a dependency
   *  node's output (depText), falling back to the subtask description. */
  sourceText: string;
  emit: (event: object) => void;
  /** The DAG node's own per-attempt AbortSignal (executor.ts's per-node
   *  timeout), threaded through so a node timeout actually cancels the
   *  sandbox run instead of leaving it to finish on a disconnected signal. */
  signal: AbortSignal;
}

/** Runs the code-exec tool node: permission check → extract code → execute →
 *  format. Throws on any failure so the caller's normal retry/fallback/replan
 *  machinery (executor.ts) handles it exactly like an agent node failing. */
export async function runCodeExecTool(input: CodeExecToolInput): Promise<string> {
  const tool = globalToolRegistry.getTool('code-exec');
  if (!tool) throw new Error('code-exec: tool not registered');

  if (!globalToolRegistry.permissionSatisfied(V2_GRANTED_PERMISSION, tool.permission)) {
    input.emit({
      role: 'v2', kind: 'event',
      event: { type: 'permission_denied', nodeId: input.nodeId, toolId: tool.id, permission: tool.permission },
    });
    throw new Error(`code-exec: permission denied (requires ${tool.permission})`);
  }

  const fence = extractCodeFence(input.sourceText);
  if (!fence) throw new Error('code-exec: no fenced code block found in inputs to execute');

  const response = await tool.execute(
    { toolId: 'code-exec', operation: 'run', args: { language: fence.language, code: fence.code } },
    input.signal,
  );
  if (response.status !== 'success') {
    throw new Error(`code-exec ${response.status}: ${response.error ?? 'unknown failure'}`);
  }
  const out = response.output as { stdout: string; stderr: string };
  return `**Execution result** (${fence.language})\n\`\`\`\n${out.stdout}${out.stderr ? `\n--- stderr ---\n${out.stderr}` : ''}\n\`\`\``;
}
