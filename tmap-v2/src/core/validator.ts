import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodeFile, ValidationResult } from '../types.js';

/**
 * Grounded validation (TDD §3 principle 4): actually EXECUTE checks instead of
 * letting an LLM claim "passed". MVP supports JS syntax checking via `node --check`;
 * other languages are honestly reported as skipped (real sandboxing comes in Phase 3).
 */
export function validateFiles(files: CodeFile[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const f of files) {
    if (f.language === 'javascript') {
      results.push(checkJs(f));
    } else {
      results.push({
        kind: 'skipped',
        passed: true,
        logs: `${f.path}: no executable validator for ${f.language} in MVP (Phase 3 sandbox).`,
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
    return { kind: 'syntax', passed: true, logs: `${f.path}: syntax OK` };
  } catch (e: any) {
    const msg = (e.stderr?.toString() || e.message || '').split('\n').slice(0, 4).join(' ');
    return { kind: 'syntax', passed: false, logs: `${f.path}: ${msg}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
