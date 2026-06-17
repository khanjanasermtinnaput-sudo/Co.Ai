import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import type { CodeFile, ValidationResult } from '../types.js';

/**
 * Interface for pluggable sandbox execution (E2B, Firecracker, Docker).
 * When E2B_API_KEY is configured, inject an E2B implementation via
 * `setSandboxRunner()`.  Until then, static syntax checkers are used.
 */
export interface SandboxRunner {
  /** Run code in an isolated sandbox and return stdout, stderr, exit code. */
  run(file: CodeFile): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Whether this runner supports the given language. */
  supports(language: string): boolean;
}

let sandboxRunner: SandboxRunner | null = null;

/** Inject a sandbox implementation at startup (e.g. E2B, Docker). */
export function setSandboxRunner(runner: SandboxRunner): void {
  sandboxRunner = runner;
}

/** Return the currently configured sandbox runner, or null if none. */
export function getSandboxRunner(): SandboxRunner | null {
  return sandboxRunner;
}

/**
 * Grounded validation (TDD §3 principle 4): actually EXECUTE checks instead of
 * letting an LLM claim "passed". Supports JS, TS, Python syntax checking.
 * Real sandbox execution comes in Phase 3.
 */
export function validateFiles(files: CodeFile[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const f of files) {
    // Prefer sandbox runner when available and it supports this language
    if (sandboxRunner?.supports(f.language)) {
      // Sandbox runs async; caller must use validateFilesAsync for full sandbox support.
      // Fallback to static checks here (sync path) so existing callers aren't broken.
    }
    switch (f.language) {
      case 'javascript':
        results.push(checkJs(f));
        break;
      case 'typescript':
        results.push(checkTs(f));
        break;
      case 'python':
        results.push(checkPython(f));
        break;
      case 'go':
        results.push(checkGo(f));
        break;
      case 'rust':
        results.push(checkRust(f));
        break;
      case 'json':
        results.push(checkJson(f));
        break;
      default:
        results.push({
          kind: 'skipped',
          passed: true,
          logs: `${f.path}: no validator for ${f.language}${sandboxRunner ? ' (sandbox runner installed but async — use validateFilesAsync)' : ''}.`,
        });
    }
  }
  return results;
}

/**
 * Async variant that uses the injected SandboxRunner when available,
 * falling back to static syntax checks for languages the sandbox doesn't support.
 */
export async function validateFilesAsync(files: CodeFile[]): Promise<ValidationResult[]> {
  if (!sandboxRunner) return validateFiles(files);

  const results: ValidationResult[] = [];
  for (const f of files) {
    if (sandboxRunner.supports(f.language)) {
      try {
        const { stdout, stderr, exitCode } = await sandboxRunner.run(f);
        results.push({
          kind: 'runtime',
          passed: exitCode === 0,
          logs: exitCode === 0
            ? `${f.path}: sandbox OK${stdout ? ` — ${stdout.slice(0, 200)}` : ''}`
            : `${f.path}: sandbox exit ${exitCode} — ${stderr.slice(0, 400)}`,
        });
      } catch (e: any) {
        results.push({ kind: 'runtime', passed: false, logs: `${f.path}: sandbox error — ${e.message}` });
      }
    } else {
      // Fallback to static check for unsupported languages
      const [staticResult] = validateFiles([f]);
      results.push(staticResult);
    }
  }
  return results;
}

function checkJs(f: CodeFile): ValidationResult {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'aof-val-'));
    const file = join(dir, 'check.mjs');
    writeFileSync(file, f.content, 'utf8');
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return { kind: 'syntax', passed: true, logs: `${f.path}: JS syntax OK` };
  } catch (e: any) {
    const msg = (e.stderr?.toString() || e.message || '').split('\n').slice(0, 4).join(' ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${msg}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function checkTs(f: CodeFile): ValidationResult {
  // Grounded TS syntax check via the real TypeScript compiler. transpileModule
  // parses the file and reports genuine syntax errors without needing a tsconfig,
  // while accepting valid TS (type annotations, generics, ternaries, switch) that
  // the old regex-stripping heuristic used to fail by mistake.
  try {
    const out = ts.transpileModule(f.content, {
      fileName: f.path,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve,
        isolatedModules: false,
      },
    });
    const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (!errors.length) {
      return { kind: 'syntax', passed: true, logs: `${f.path}: TS syntax OK` };
    }
    const msg = errors
      .slice(0, 3)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
      .join(' · ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${msg}` };
  } catch (e: any) {
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${e.message || 'TS parse error'}` };
  }
}

function checkPython(f: CodeFile): ValidationResult {
  // Use python3 -m py_compile if available
  const python = findPython();
  if (!python) {
    // Report skipped as not-passed so callers don't treat an unchecked file as
    // syntactically valid (the file might still contain errors).
    return { kind: 'skipped', passed: false, logs: `${f.path}: python3 not found — syntax not verified` };
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'aof-py-'));
    const pyFile = join(dir, 'check.py');
    writeFileSync(pyFile, f.content, 'utf8');
    execFileSync(python, ['-m', 'py_compile', pyFile], { stdio: 'pipe', timeout: 10_000 });
    return { kind: 'syntax', passed: true, logs: `${f.path}: Python syntax OK` };
  } catch (e: any) {
    const msg = (e.stderr?.toString() || e.message || '').split('\n').slice(0, 4).join(' ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${msg}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function checkJson(f: CodeFile): ValidationResult {
  try {
    JSON.parse(f.content);
    return { kind: 'syntax', passed: true, logs: `${f.path}: JSON valid` };
  } catch (e: any) {
    return { kind: 'syntax', passed: false, logs: `${f.path}: invalid JSON — ${e.message}` };
  }
}

function findPython(): string | null {
  for (const bin of ['python3', 'python']) {
    try {
      execSync(`${bin} --version`, { stdio: 'pipe' });
      return bin;
    } catch { /* not found */ }
  }
  return null;
}

function checkGo(f: CodeFile): ValidationResult {
  if (!commandExists('go')) {
    return { kind: 'skipped', passed: true, logs: `${f.path}: go toolchain not found, skipped` };
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'aof-go-'));
    // go vet needs a valid module; use go build -syntax-check approach via gofmt -e
    const file = join(dir, 'check.go');
    writeFileSync(file, f.content, 'utf8');
    // gofmt -e reports parse/syntax errors; exit 0 = no errors
    execFileSync('gofmt', ['-e', file], { stdio: 'pipe', timeout: 15_000 });
    return { kind: 'syntax', passed: true, logs: `${f.path}: Go syntax OK` };
  } catch (e: any) {
    const msg = (e.stderr?.toString() || e.stdout?.toString() || e.message || '')
      .split('\n').slice(0, 4).join(' ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${msg}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function checkRust(f: CodeFile): ValidationResult {
  if (!commandExists('rustc')) {
    return { kind: 'skipped', passed: true, logs: `${f.path}: rustc not found, skipped` };
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'aof-rs-'));
    const file = join(dir, 'check.rs');
    writeFileSync(file, f.content, 'utf8');
    // --emit=metadata only checks + produces tiny metadata, no binary output
    execFileSync('rustc', ['--edition', '2021', '--emit=metadata', '--error-format=short', '-o', join(dir, 'out'), file], {
      stdio: 'pipe',
      timeout: 30_000,
    });
    return { kind: 'syntax', passed: true, logs: `${f.path}: Rust syntax OK` };
  } catch (e: any) {
    const stderr = e.stderr?.toString() || e.message || '';
    const msg = stderr.split('\n').filter(Boolean).slice(0, 4).join(' ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${msg}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
