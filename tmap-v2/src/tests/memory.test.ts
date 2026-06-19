import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the memory layer at a temp dir BEFORE importing the module under test.
// (No SUPABASE_URL in the test env → exercises the file backend.)
const MEM_DIR = mkdtempSync(join(tmpdir(), 'cgntx-mem-'));
process.env.CGNTX_MEMORY_DIR = MEM_DIR;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const {
  loadMemory, recordSessionMemory, recordDecision, memoryToContext, clearMemory,
} = await import('../core/memory.js');

after(() => rmSync(MEM_DIR, { recursive: true, force: true }));

test('loadMemory returns empty memory for unknown key', async () => {
  const mem = await loadMemory('nobody');
  assert.equal(mem.sessions.length, 0);
  assert.equal(memoryToContext(mem), '');
});

test('recordSessionMemory persists and caps at 10 sessions', async () => {
  const key = 'user-1';
  for (let i = 1; i <= 12; i++) {
    await recordSessionMemory(key, {
      task: `task ${i}`, status: 'done', files: [`f${i}.ts`], iterations: 1, at: new Date().toISOString(),
    });
  }
  const mem = await loadMemory(key);
  assert.equal(mem.sessions.length, 10);
  // newest first
  assert.equal(mem.sessions[0].task, 'task 12');
  assert.equal(mem.sessions[9].task, 'task 3');
});

test('recordSessionMemory merges tech stack and conventions', async () => {
  const key = 'user-2';
  await recordSessionMemory(key, {
    task: 'build api', status: 'done', files: ['api.ts'], iterations: 1, at: new Date().toISOString(),
  }, { techStack: 'node-api-ts', conventions: ['indentation: 2 spaces', 'quotes: single'] });
  await recordSessionMemory(key, {
    task: 'add tests', status: 'done', files: ['api.test.ts'], iterations: 1, at: new Date().toISOString(),
  }, { conventions: ['quotes: single', 'semicolons: yes'] });

  const mem = await loadMemory(key);
  assert.equal(mem.techStack, 'node-api-ts');
  assert.equal(mem.conventions.filter((c) => c === 'quotes: single').length, 1);
  assert.ok(mem.conventions.includes('semicolons: yes'));
});

test('memoryToContext renders sessions, decisions and guidance', async () => {
  const key = 'user-3';
  await recordSessionMemory(key, {
    task: 'todo app', status: 'done', files: ['index.html', 'app.js'], iterations: 2, at: new Date().toISOString(),
  });
  await recordDecision(key, 'use vanilla JS, no frameworks');

  const ctx = memoryToContext(await loadMemory(key));
  assert.ok(ctx.includes('## Project Memory'));
  assert.ok(ctx.includes('todo app'));
  assert.ok(ctx.includes('index.html'));
  assert.ok(ctx.includes('use vanilla JS, no frameworks'));
  assert.ok(ctx.includes('Stay consistent'));
});

test('records and renders L4 failure patterns to avoid (deduped)', async () => {
  const key = 'user-fail';
  await recordSessionMemory(key, {
    task: 'build login', status: 'error', files: [], iterations: 2, at: new Date().toISOString(),
  }, {
    failures: [
      'validation: app.ts SyntaxError missing )',
      'validation: app.ts SyntaxError missing )', // duplicate → collapsed
      '[HIGH] auth.ts — no rate limiting',
    ],
  });

  const mem = await loadMemory(key);
  assert.equal(mem.failures.length, 2);
  const ctx = memoryToContext(mem);
  assert.ok(ctx.includes('Known failure patterns to avoid'));
  assert.ok(ctx.includes('no rate limiting'));
});

test('clearMemory removes the record', async () => {
  const key = 'user-4';
  await recordSessionMemory(key, {
    task: 'x', status: 'error', files: [], iterations: 1, at: new Date().toISOString(),
  });
  assert.equal((await loadMemory(key)).sessions.length, 1);
  await clearMemory(key);
  assert.equal((await loadMemory(key)).sessions.length, 0);
});

test('keys are sanitized to filesystem-safe names', async () => {
  const key = '../../etc/passwd';
  const mem = await loadMemory(key);
  assert.match(mem.key, /^[a-zA-Z0-9_-]+$/);
});
