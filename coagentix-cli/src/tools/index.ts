// Tool Execution Engine entrypoint (CLI side) — one registry, pre-populated
// with every built-in adapter, mirroring tmap-v2/src/v2/tools/index.ts.

import { getTool, listTools, permissionSatisfied, registerTool } from "./registry.js";
import { fsAdapter } from "./fs-adapter.js";
import { gitAdapter } from "./git-adapter.js";
import { terminalAdapter } from "./terminal-adapter.js";

registerTool(fsAdapter);
registerTool(gitAdapter);
registerTool(terminalAdapter);

export const globalToolRegistry = { getTool, listTools, registerTool, permissionSatisfied };
export type { PermissionLevel, ToolAdapter, ToolRequest, ToolResponse, ToolResultStatus } from "./types.js";
