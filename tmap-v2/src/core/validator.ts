import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // Quick structural check: parse as text for obvious issues (balanced braces, no bare syntax errors)
  // Full tsc would need a tsconfig; this is a lightweight gate.
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'aof-ts-'));
    // Strip type annotations for a quick JS parse (not perfect but catches obvious issues)
    const stripped = f.content
      .replace(/:\s*\w+(\[\])?(\s*\|[\s\w\[\]|]+)?/g, '')   // simple type annotations
      .replace(/<[^>]+>/g, '')                                 // generics
      .replace(/^(interface|type)\s+\w+[^{]*\{[^}]*\}/gm, '');// type/interface blocks
    const jsFile = join(dir, 'check.mjs');
    writeFileSync(jsFile, stripped, 'utf8');
    execFileSync(process.execPath, ['--check', jsFile], { stdio: 'pipe' });
    return { kind: 'syntax', passed: true, logs: `${f.path}: TS syntax OK (lightweight check)` };
  } catch (e: any) {
    const msg = (e.stderr?.toString() || e.message || '').split('\n').slice(0, 4).join(' ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: possible syntax issue: ${msg}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function checkPython(f: CodeFile): ValidationResult {
  // Use python3 -m py_compile if available
  const python = findPython();
  if (!python) {
    return { kind: 'skipped', passed: true, logs: `${f.path}: python3 not found, skipped` };
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
