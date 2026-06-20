// Docker-based sandbox — runs untrusted code in an isolated container with:
//   • CPU quota (--cpus 0.5)
//   • Memory limit (--memory 128m, --memory-swap 128m)
//   • Read-only filesystem (--read-only) with a tmpfs for /tmp
//   • No network (--network none)
//   • No capabilities (--cap-drop ALL)
//   • Non-root user (--user nobody)
//   • Timeout enforced by docker run --stop-timeout + a wrapper SIGKILL
//
// This module auto-detects whether Docker is available; if not, it returns a
// result indicating that the Docker sandbox is unavailable and the caller
// should fall back to the Node vm sandbox (core/sandbox.ts).
//
// Language images (configurable via DOCKER_SANDBOX_IMAGE_*):
//   • javascript / typescript  → node:22-alpine  (npx tsx strips TS)
//   • python                   → python:3.12-alpine

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SandboxLanguage, SandboxOptions, SandboxResult } from '../types.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const IMAGE: Record<string, string> = {
  javascript: process.env.DOCKER_SANDBOX_IMAGE_NODE   ?? 'node:22-alpine',
  typescript: process.env.DOCKER_SANDBOX_IMAGE_NODE   ?? 'node:22-alpine',
  python:     process.env.DOCKER_SANDBOX_IMAGE_PYTHON ?? 'python:3.12-alpine',
};

export const DOCKER_DEFAULT_TIMEOUT_MS = 15_000;
export const DOCKER_MAX_TIMEOUT_MS     = 60_000;
export const DOCKER_DEFAULT_MAX_BYTES  = 50_000;
const DOCKER_MAX_MAX_BYTES             = 200_000;
const DOCKER_MAX_INPUT_BYTES           = 100_000;

// ── Docker availability check ─────────────────────────────────────────────────

let _dockerAvailable: boolean | null = null;

export function isDockerAvailable(): boolean {
  if (_dockerAvailable !== null) return _dockerAvailable;
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    timeout: 3_000,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
  });
  _dockerAvailable = result.status === 0 && !result.error;
  return _dockerAvailable;
}

/** Call to reset the cached Docker availability (useful in tests). */
export function resetDockerAvailabilityCache(): void {
  _dockerAvailable = null;
}

// ── Helper: truncate output ───────────────────────────────────────────────────

function truncate(s: string, maxBytes: number): string {
  if (!s) return '';
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  return buf.slice(0, maxBytes).toString('utf8') + '\n[truncated]';
}

// ── Entrypoint command per language ──────────────────────────────────────────

function entryCommand(lang: SandboxLanguage, codeFile: string): string[] {
  switch (lang) {
    case 'javascript':
      return ['node', codeFile];
    case 'typescript':
      // tsx strips types and runs; available in node:22-alpine via npx
      return ['npx', '--yes', 'tsx', codeFile];
    case 'python':
      return ['python3', codeFile];
    default:
      return ['node', codeFile];
  }
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runInDockerSandbox(opts: SandboxOptions): Promise<SandboxResult> {
  const lang = opts.language;

  if (lang === 'bash') {
    return {
      success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false,
      language: lang, error: 'Shell/bash execution is not permitted (security policy)',
    };
  }

  if (!isDockerAvailable()) {
    return {
      success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false,
      language: lang, error: 'Docker is not available on this host',
    };
  }

  const codeBytes = Buffer.byteLength(opts.code ?? '', 'utf8');
  if (codeBytes > DOCKER_MAX_INPUT_BYTES) {
    return {
      success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false,
      language: lang, error: `Code too large: ${codeBytes} bytes (max ${DOCKER_MAX_INPUT_BYTES})`,
    };
  }

  const timeoutMs  = Math.min(opts.timeoutMs ?? DOCKER_DEFAULT_TIMEOUT_MS, DOCKER_MAX_TIMEOUT_MS);
  const maxBytes   = Math.min(opts.maxOutputBytes ?? DOCKER_DEFAULT_MAX_BYTES, DOCKER_MAX_MAX_BYTES);
  const startMs    = Date.now();

  // ── Isolated temp directory ───────────────────────────────────────────────────
  const workDir  = join(tmpdir(), `cgntx-docker-${randomUUID()}`);
  const codeFile = lang === 'typescript' ? 'code.ts' : lang === 'python' ? 'code.py' : 'code.js';
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, codeFile), opts.code ?? '', 'utf8');

  // Write caller-provided input files (path-traversal safe)
  for (const f of opts.files ?? []) {
    if (!f.path || f.path.includes('..') || /^[/\\]/.test(f.path)) continue;
    const target = join(workDir, f.path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, f.content ?? '', 'utf8');
  }

  // Determine image and command. TypeScript in Docker: strip types first
  // (npx tsx needs network which is blocked by --network none), then run with node.
  const image = IMAGE[lang] ?? IMAGE['javascript'];
  let cmd: string[];

  if (lang === 'typescript') {
    // Strip types at the host level before mounting (no network needed inside container)
    const { stripTypes } = await import('./sandbox.js');
    const jsCode = stripTypes(opts.code ?? '');
    const jsCacheFile = codeFile.replace('.ts', '.js');
    writeFileSync(join(workDir, jsCacheFile), jsCode, 'utf8');
    cmd = ['node', `/sandbox/${jsCacheFile}`];
  } else {
    cmd = entryCommand(lang, `/sandbox/${codeFile}`);
  }

  // Store container name so we can kill it on timeout — do NOT regenerate UUID.
  const containerName = `cgntx-sb-${randomUUID().slice(0, 8)}`;

  // ── Docker run arguments (hardened) ──────────────────────────────────────────
  const dockerArgs = [
    'run',
    '--rm',                           // Remove container on exit
    '--network', 'none',              // No network access
    '--read-only',                    // Read-only root FS
    '--tmpfs', '/tmp:size=32m',       // Writable /tmp only
    '--memory', '128m',               // RAM limit
    '--memory-swap', '128m',          // Disable swap (prevents memory balloon)
    '--cpus', '0.5',                  // CPU quota
    '--cap-drop', 'ALL',              // Drop all capabilities
    '--security-opt', 'no-new-privileges',
    '--user', 'nobody',               // Run as nobody (non-root)
    '--stop-timeout', '3',            // Docker SIGKILL grace period
    '-v', `${workDir}:/sandbox:ro`,   // Mount code read-only
    '-w', '/sandbox',
    '--name', containerName,
    image,
    ...cmd,
  ];

  const stopTimeoutMs = timeoutMs + 5_000;  // Give Docker a 5-s grace window

  const result = spawnSync('docker', dockerArgs, {
    timeout:   stopTimeoutMs,
    maxBuffer: maxBytes * 4,
    encoding:  'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    },
  });

  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  const durationMs = Date.now() - startMs;
  const stdout     = truncate(result.stdout ?? '', maxBytes);
  const rawStderr  = [
    result.stderr,
    (result.error as NodeJS.ErrnoException)?.message,
  ].filter(Boolean).join('\n');
  const stderr     = truncate(rawStderr, maxBytes);

  const timedOut =
    result.signal === 'SIGTERM' ||
    (result.error as NodeJS.ErrnoException)?.code === 'ETIMEDOUT' ||
    durationMs >= timeoutMs;

  if (timedOut) {
    // Force-remove the named container (same containerName from above).
    spawnSync('docker', ['kill', containerName], {
      timeout: 3_000,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
    });
  }

  const success = result.status === 0 && !timedOut && !result.error;

  return {
    success,
    stdout,
    stderr,
    durationMs,
    timedOut,
    language: lang,
    error: timedOut
      ? `Execution timed out after ${timeoutMs} ms`
      : !success
        ? (stderr.split('\n').filter(Boolean).pop() ?? 'Execution failed')
        : undefined,
  };
}
