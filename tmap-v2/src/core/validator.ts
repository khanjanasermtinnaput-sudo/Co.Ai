import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import type { CodeFile, ValidationResult } from '../types.js';

/**
 * Grounded validation (TDD §3 principle 4): actually EXECUTE checks instead of
 * letting an LLM claim "passed". Supports JS, TS, Python syntax checking.
 * Real sandbox execution comes in Phase 3.
 */
export function validateFiles(files: CodeFile[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const f of files) {
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
          logs: `${f.path}: no validator for ${f.language} (Phase 3 sandbox).`,
        });
    }
  }
  return results;
}

function checkJs(f: CodeFile): ValidationResult {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'cgntx-val-'));
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
    dir = mkdtempSync(join(tmpdir(), 'cgntx-py-'));
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
    dir = mkdtempSync(join(tmpdir(), 'cgntx-go-'));
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
    dir = mkdtempSync(join(tmpdir(), 'cgntx-rs-'));
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
