import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the memory layer at a temp dir BEFORE importing the module under test.
const MEM_DIR = mkdtempSync(join(tmpdir(), 'aof-mem-'));
process.env.AOF_MEMORY_DIR = MEM_DIR;

const {
  loadMemory, recordSessionMemory, recordDecision, memoryToContext, clearMemory,
} = await import('../core/memory.js');

after(() => rmSync(MEM_DIR, { recursive: true, force: true }));

test('loadMemory returns empty memory for unknown key', () => {
  const mem = loadMemory('nobody');
  assert.equal(mem.sessions.length, 0);
  assert.equal(memoryToContext(mem), '');
});

test('recordSessionMemory persists and caps at 10 sessions', () => {
  const key = 'user-1';
  for (let i = 1; i <= 12; i++) {
    recordSessionMemory(key, {
      task: `task ${i}`, status: 'done', files: [`f${i}.ts`], iterations: 1, at: new Date().toISOString(),
    });
  }
  const mem = loadMemory(key);
  assert.equal(mem.sessions.length, 10);
  // newest first
  assert.equal(mem.sessions[0].task, 'task 12');
  assert.equal(mem.sessions[9].task, 'task 3');
});

test('recordSessionMemory merges tech stack and conventions', () => {
  const key = 'user-2';
  recordSessionMemory(key, {
    task: 'build api', status: 'done', files: ['api.ts'], iterations: 1, at: new Date().toISOString(),
  }, { techStack: 'node-api-ts', conventions: ['indentation: 2 spaces', 'quotes: single'] });
  recordSessionMemory(key, {
    task: 'add tests', status: 'done', files: ['api.test.ts'], iterations: 1, at: new Date().toISOString(),
  }, { conventions: ['quotes: single', 'semicolons: yes'] });

  const mem = loadMemory(key);
  assert.equal(mem.techStack, 'node-api-ts');
  assert.equal(mem.conventions.filter((c) => c === 'quotes: single').length, 1);
  assert.ok(mem.conventions.includes('semicolons: yes'));
});

test('memoryToContext renders sessions, decisions and guidance', () => {
  const key = 'user-3';
  recordSessionMemory(key, {
    task: 'todo app', status: 'done', files: ['index.html', 'app.js'], iterations: 2, at: new Date().toISOString(),
  });
  recordDecision(key, 'use vanilla JS, no frameworks');

  const ctx = memoryToContext(loadMemory(key));
  assert.ok(ctx.includes('## Project Memory'));
  assert.ok(ctx.includes('todo app'));
  assert.ok(ctx.includes('index.html'));
  assert.ok(ctx.includes('use vanilla JS, no frameworks'));
  assert.ok(ctx.includes('Stay consistent'));
});

test('clearMemory removes the record', () => {
  const key = 'user-4';
  recordSessionMemory(key, {
    task: 'x', status: 'error', files: [], iterations: 1, at: new Date().toISOString(),
  });
  assert.equal(loadMemory(key).sessions.length, 1);
  clearMemory(key);
  assert.equal(loadMemory(key).sessions.length, 0);
});

test('keys are sanitized to filesystem-safe names', () => {
  const key = '../../etc/passwd';
  const mem = loadMemory(key);
  assert.match(mem.key, /^[a-zA-Z0-9_-]+$/);
});
