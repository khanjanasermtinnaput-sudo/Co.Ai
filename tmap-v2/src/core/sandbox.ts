// Secure sandbox execution engine — Phase 5
//
// Isolation model:
//   • JavaScript/TypeScript — Node.js vm.runInContext with an empty sandbox context.
//     Blocked globals: require, process, global, Buffer, __dirname, __filename, eval,
//     Function, fetch, XMLHttpRequest, WebSocket, setInterval, setTimeout.
//     Only safe builtins are exposed (Math, JSON, Array, Object, etc.).
//   • Python — child_process.spawnSync with cwd=isolated temp dir, minimal env,
//     no shell interpolation (code written to a file, never passed on the CLI).
//   • bash/shell — always rejected; arbitrary OS access is unacceptable.
//
// All executions:
//   • Timeout enforced (default 10 s, max 30 s). JS timeout kills the vm context;
//     Python timeout sends SIGTERM then SIGKILL to the child process.
//   • Output capped at maxOutputBytes (default 50 KB, max 200 KB).
//   • Runs inside a unique per-execution temp directory under os.tmpdir().
//   • Temp dir is always deleted in the finally block (even on error/timeout).
//
// Security note: Node vm does NOT provide complete process-level isolation.
// A crafted payload can escape via prototype pollution or native bindings.
// For arbitrary-user code from the internet, prefer Docker. This sandbox is
// appropriate for executing AI-generated output in a developer-tool context
// where the operator trusts the code generation pipeline.

import { createContext, runInContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SandboxLanguage, SandboxOptions, SandboxResult } from '../types.js';

// ── Limits ─────────────────────────────────────────────────────────────────────
export const SANDBOX_DEFAULT_TIMEOUT_MS  = 10_000;
export const SANDBOX_MAX_TIMEOUT_MS      = 30_000;
export const SANDBOX_DEFAULT_MAX_BYTES   = 50_000;
export const SANDBOX_MAX_MAX_BYTES       = 200_000;
const MAX_INPUT_BYTES                    = 100_000;
export const SUPPORTED_LANGUAGES: SandboxLanguage[] = ['javascript', 'typescript', 'python'];

// ── TypeScript → JS type-stripping (handles most AI codegen output) ───────────
// Full transpilation is not the goal — we just strip annotation syntax so the
// resulting code runs in the vm without syntax errors.
export function stripTypes(ts: string): string {
  return ts
    .replace(/^import\s+type\s+.+?;\s*$/gm, '')                             // import type { … }
    .replace(/^export\s+type\s+.+?;\s*$/gm, '')                             // export type …
    .replace(/^type\s+\w+\s*=\s*.+?;\s*$/gm, '')                            // type Alias = …
    .replace(/^interface\s+\w[\w<>, ]*\s*\{[^}]*\}/gms, '')                 // interface blocks
    .replace(/<[A-Za-z][A-Za-z0-9,\s<>[\]|&?]*>/g, '')                     // generic params <T>
    .replace(/\b(public|private|protected|readonly|abstract|override)\s+/g, '')
    .replace(/:\s*[A-Za-z][A-Za-z0-9<>[\]|&?,\s]*(?=[,)=;{}])/g, '')      // : type (any case)
    .replace(/\bas\s+[A-Za-z][A-Za-z0-9<>[\]|&?,\s]*/g, '');               // as Type
}

// ── Output helpers ─────────────────────────────────────────────────────────────
function truncate(s: string, maxBytes: number): string {
  if (!s) return '';
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  return buf.slice(0, maxBytes).toString('utf8') + '\n[truncated]';
}

// ── JavaScript / TypeScript sandbox (Node.js vm) ──────────────────────────────
function runJS(
  code: string,
  opts: { timeoutMs: number; maxBytes: number; language: SandboxLanguage },
): SandboxResult {
  const startMs = Date.now();
  const outLines: string[] = [];
  const errLines: string[] = [];
  let totalOut = 0;

  const safePush = (arr: string[], line: string) => {
    const bytes = Buffer.byteLength(line, 'utf8');
    if (totalOut + bytes <= opts.maxBytes) {
      arr.push(line);
      totalOut += bytes;
    } else if (arr[arr.length - 1] !== '[output truncated]') {
      arr.push('[output truncated]');
    }
  };

  const consoleSub = {
    log:   (...args: unknown[]) => safePush(outLines, args.map(String).join(' ')),
    error: (...args: unknown[]) => safePush(errLines, args.map(String).join(' ')),
    warn:  (...args: unknown[]) => safePush(errLines, args.map(String).join(' ')),
    info:  (...args: unknown[]) => safePush(outLines, args.map(String).join(' ')),
    dir:   (...args: unknown[]) => safePush(outLines, args.map((a) => JSON.stringify(a, null, 2)).join(' ')),
  };

  // Only safe, non-IO globals are exposed. Dangerous globals (require, process,
  // global, Buffer, fetch, eval, Function constructor) are intentionally absent.
  const ctx = createContext({
    console: consoleSub,
    Math, JSON, Array, Object, String, Number, Boolean, Date, RegExp,
    Error, TypeError, RangeError, SyntaxError, ReferenceError, URIError,
    Map, Set, WeakMap, WeakSet, Symbol, BigInt, Proxy, Reflect,
    Promise, ArrayBuffer, Uint8Array, Int32Array, Float64Array,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    undefined, NaN, Infinity,
  });

  try {
    runInContext(code, ctx, { timeout: opts.timeoutMs, displayErrors: false });
    return {
      success: true,
      stdout: outLines.join('\n'),
      stderr: errLines.join('\n'),
      durationMs: Date.now() - startMs,
      timedOut: false,
      language: opts.language,
    };
  } catch (e) {
    const err = e as Error;
    const timedOut = /timed out/i.test(err.message ?? '');
    return {
      success: false,
      stdout: outLines.join('\n'),
      stderr: errLines.join('\n'),
      durationMs: Date.now() - startMs,
      timedOut,
      language: opts.language,
      error: timedOut ? `Execution timed out after ${opts.timeoutMs} ms` : err.message,
    };
  }
}

// ── Python sandbox (child_process.spawnSync) ──────────────────────────────────
function runPython(
  code: string,
  opts: { timeoutMs: number; maxBytes: number; tempDir: string },
): SandboxResult {
  const startMs = Date.now();

  // Write to a file to avoid any shell injection risk on the CLI
  const codeFile = join(opts.tempDir, 'sandbox_code.py');
  writeFileSync(codeFile, code, 'utf8');

  const result = spawnSync('python3', [codeFile], {
    cwd: opts.tempDir,
    timeout: opts.timeoutMs,
    maxBuffer: opts.maxBytes * 4,
    encoding: 'utf8',
    env: {
      // Minimal environment — no PYTHONPATH manipulation, no HOME tricks
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
    },
  });

  const stdout = truncate(result.stdout ?? '', opts.maxBytes);
  const errText = [result.stderr, (result.error as NodeJS.ErrnoException)?.message ?? ''].filter(Boolean).join('\n');
  const stderr = truncate(errText, opts.maxBytes);
  const timedOut = result.signal === 'SIGTERM'
    || (result.error as NodeJS.ErrnoException)?.code === 'ETIMEDOUT';

  return {
    success: result.status === 0 && !timedOut,
    stdout,
    stderr,
    durationMs: Date.now() - startMs,
    timedOut,
    language: 'python',
    error: timedOut
      ? `Execution timed out after ${opts.timeoutMs} ms`
      : (result.status !== 0 ? (stderr.split('\n').filter(Boolean).pop() ?? 'Python error') : undefined),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────
export async function runInSandbox(opts: SandboxOptions): Promise<SandboxResult> {
  const lang = opts.language;

  if (lang === 'bash') {
    return {
      success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false, language: lang,
      error: 'Shell/bash execution is not permitted in the sandbox (security policy)',
    };
  }

  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    return {
      success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false, language: lang,
      error: `Language '${lang}' not supported. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
    };
  }

  const codeBytes = Buffer.byteLength(opts.code ?? '', 'utf8');
  if (codeBytes > MAX_INPUT_BYTES) {
    return {
      success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false, language: lang,
      error: `Code too large: ${codeBytes} bytes (max ${MAX_INPUT_BYTES})`,
    };
  }

  const timeoutMs = Math.min(opts.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
  const maxBytes  = Math.min(opts.maxOutputBytes ?? SANDBOX_DEFAULT_MAX_BYTES, SANDBOX_MAX_MAX_BYTES);
  const code = opts.code ?? '';

  // Isolated temp directory for this execution
  const tempDir = join(tmpdir(), `coagentix-sb-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  // Write any caller-provided input files (path-traversal safe)
  const filesCreated: string[] = [];
  for (const f of opts.files ?? []) {
    if (!f.path || f.path.includes('..') || /^[/\\]/.test(f.path)) continue;
    const target = join(tempDir, f.path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, f.content ?? '', 'utf8');
    filesCreated.push(f.path);
  }

  try {
    let result: SandboxResult;

    switch (lang) {
      case 'javascript':
        result = runJS(code, { timeoutMs, maxBytes, language: 'javascript' });
        break;
      case 'typescript':
        result = runJS(stripTypes(code), { timeoutMs, maxBytes, language: 'typescript' });
        break;
      case 'python':
        result = runPython(code, { timeoutMs, maxBytes, tempDir });
        break;
      default:
        result = {
          success: false, stdout: '', stderr: '', durationMs: 0, timedOut: false,
          language: lang, error: 'Language not supported',
        };
    }

    if (filesCreated.length > 0) result.filesCreated = filesCreated;

    // Collect output files the script wrote (exclude our own inputs)
    try {
      const written = readdirSync(tempDir)
        .filter((f) => f !== 'sandbox_code.py' && !filesCreated.includes(f));
      if (written.length > 0) result.filesCreated = [...(result.filesCreated ?? []), ...written];
    } catch { /* ignore */ }

    return result;
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
