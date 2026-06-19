// Safe terminal execution: allowlist-based command runner

import { spawnSync } from "node:child_process";

// Commands that are always safe to run.
const ALLOWED_COMMANDS = new Set([
  "npm", "npx", "pnpm", "yarn", "bun",
  "python", "python3", "pip", "pip3",
  "git",
  "cargo",
  "go",
  "dotnet",
  "flutter", "dart",
  "node",
  "tsc",
  "eslint", "prettier",
  "jest", "vitest", "mocha",
  "ls", "dir",
  "cat",
  "echo",
]);

// Patterns that must never appear in any argument, regardless of command.
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /format\s+[a-z]:/i,
  /del\s+\/[fqs]/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  /dd\s+if=/i,
  /curl.*\|.*sh/i,
  /wget.*\|.*sh/i,
  /eval\s*\(/i,
  /base64.*decode/i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  /HKEY_LOCAL_MACHINE/i,
  /reg\s+add/i,
  /reg\s+delete/i,
  /net\s+user/i,
  /runas/i,
  /sudo\s+rm/i,
  /chmod\s+777/i,
];

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function isCommandAllowed(cmd: string, args: string[]): { allowed: boolean; reason?: string } {
  const base = cmd.split(/[\\/]/).pop() ?? cmd;

  if (!ALLOWED_COMMANDS.has(base)) {
    return { allowed: false, reason: `Command '${base}' is not in the allowed list` };
  }

  const full = [cmd, ...args].join(" ");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(full)) {
      return { allowed: false, reason: `Blocked pattern detected: ${pattern.source}` };
    }
  }

  return { allowed: true };
}

export function execCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): ExecResult {
  const check = isCommandAllowed(cmd, args);
  if (!check.allowed) {
    return {
      success: false,
      stdout: "",
      stderr: `[coai] Blocked: ${check.reason}`,
      exitCode: 1,
    };
  }

  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: false, // never use shell expansion
  });

  return {
    success: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    exitCode: result.status ?? 1,
  };
}

/** Parse a shell-like command string into [cmd, ...args]. */
export function parseCommand(input: string): [string, string[]] {
  const parts = input.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const [cmd, ...args] = parts.map((p) =>
    p.startsWith('"') || p.startsWith("'") ? p.slice(1, -1) : p,
  );
  return [cmd ?? "", args];
}
