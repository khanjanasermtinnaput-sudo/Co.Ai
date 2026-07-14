// v2 — Tool Execution Engine entrypoint: one global registry, pre-populated
// with every built-in adapter. Callers (v2/run.ts's tool dispatch) import
// globalToolRegistry rather than constructing their own.

import { getTool, listTools, permissionSatisfied, registerTool } from './registry.js';
import { codeExecAdapter } from './code-exec-adapter.js';

registerTool(codeExecAdapter);

export const globalToolRegistry = { getTool, listTools, registerTool, permissionSatisfied };
export type { PermissionLevel, ToolAdapter, ToolRequest, ToolResponse, ToolResultStatus } from './types.js';
