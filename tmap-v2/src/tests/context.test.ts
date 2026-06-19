import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gatherProjectContext } from '../core/context.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'cgntx-ctx-test-'));
}

describe('gatherProjectContext', () => {
  test('detects Node.js project from package.json', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4' },
      scripts: { start: 'node index.js' },
    }));
    const ctx = gatherProjectContext(dir);
    assert.equal(ctx.type, 'node');
    assert.ok(ctx.dependencies.includes('express'));
    assert.ok(ctx.scripts.start);
    rmSync(dir, { recursive: true });
  });

  test('detects Python project from requirements.txt', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'requirements.txt'), 'fastapi\nuvicorn\n');
    const ctx = gatherProjectContext(dir);
    assert.equal(ctx.type, 'python');
    assert.ok(ctx.dependencies.includes('fastapi'));
    rmSync(dir, { recursive: true });
  });

  test('returns unknown for empty directory', () => {
    const dir = tmpDir();
    const ctx = gatherProjectContext(dir);
    assert.equal(ctx.type, 'unknown');
    rmSync(dir, { recursive: true });
  });

  test('scans source files', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;');
    writeFileSync(join(dir, 'app.js'), 'console.log("hi");');
    const ctx = gatherProjectContext(dir);
    assert.ok(ctx.existingFiles.length >= 2);
    rmSync(dir, { recursive: true });
  });

  test('skips node_modules', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'node_modules', 'express'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'express', 'index.js'), 'module.exports={}');
    const ctx = gatherProjectContext(dir);
    assert.ok(!ctx.existingFiles.some((f) => f.includes('node_modules')));
    rmSync(dir, { recursive: true });
  });
});
