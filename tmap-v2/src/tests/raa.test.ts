import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRAA } from '../core/raa.js';
import type { ChatMessage } from '../types.js';

const SUMMARY_REPLY = [
  'ขอบคุณที่อธิบายครับ เข้าใจแล้ว',
  '===REQUIREMENT SUMMARY===',
  'Project: Todo Web App',
  'Task Type: feature',
  'Type: web app',
  'Users: end customers',
  'Features:',
  '- Add task',
  '- Delete task',
  '- Mark task as done',
  'Confirmed Scope:',
  '- src/App.tsx',
  '- src/components/TaskList.tsx',
  'Expected Behavior:',
  '- User adds task → appears in list immediately',
  '- User clicks delete → task removed from list',
  'Tech Stack: React + TypeScript',
  'Architecture: SPA',
  'Files to Create:',
  '- src/App.tsx — main app component',
  '- src/components/TaskList.tsx — task list UI',
  'Complexity: Simple',
  'Open Questions:',
  '- None',
  '===END SUMMARY===',
  '✅ พร้อมแล้ว — พิมพ์ /gencode เพื่อเริ่มสร้างโค้ด หรือบอกถ้าต้องการแก้ไข Requirement',
].join('\n');

const SUMMARY_WITH_OPEN_Q = SUMMARY_REPLY
  .replace('- None', '- ต้องการ login หรือเปล่า?\n- ต้องรองรับ offline ไหม?')
  .replace('===END SUMMARY===', '===END SUMMARY===');

const CLARIFY_REPLY =
  'ก่อนสรุป Requirement ขอถามเพิ่ม 2 ข้อครับ:\n' +
  '1) ต้องการ login/auth หรือเปล่า?\n' +
  '2) ข้อมูล task เก็บที่ไหน — localStorage หรือ server?';

// ── runRAA detects summary ─────────────────────────────────────────────────────

test('runRAA returns hasSummary=true when model outputs a complete summary', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'ทำ web app todo list');
  assert.equal(r.hasSummary, true);
  assert.ok(r.summary !== undefined);
});

test('runRAA returns hasSummary=false when model is still clarifying', async () => {
  const call = async () => CLARIFY_REPLY;
  const r = await runRAA(call, [], 'ทำอะไรสักอย่าง');
  assert.equal(r.hasSummary, false);
  assert.equal(r.summary, undefined);
});

test('runRAA includes the raw text in the result regardless of summary presence', async () => {
  const call = async () => CLARIFY_REPLY;
  const r = await runRAA(call, [], 'ทำเว็บ');
  assert.ok(r.text.includes('ถาม'));
});

// ── summary parser ─────────────────────────────────────────────────────────────

test('summary parser extracts project name', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'สร้าง todo');
  assert.equal(r.summary?.project, 'Todo Web App');
});

test('summary parser extracts taskType and complexity', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'สร้าง todo');
  assert.equal(r.summary?.taskType, 'feature');
  assert.equal(r.summary?.complexity, 'Simple');
});

test('summary parser extracts features list', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'todo');
  assert.ok(r.summary?.features.includes('Add task'));
  assert.ok(r.summary?.features.includes('Delete task'));
  assert.ok(r.summary?.features.includes('Mark task as done'));
});

test('summary parser extracts tech stack and architecture', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'todo');
  assert.equal(r.summary?.techStack, 'React + TypeScript');
  assert.equal(r.summary?.architecture, 'SPA');
});

test('summary parser filters out "None" from open questions', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'todo');
  assert.deepEqual(r.summary?.openQuestions, []);
});

test('summary parser keeps real open questions', async () => {
  const call = async () => SUMMARY_WITH_OPEN_Q;
  const r = await runRAA(call, [], 'todo');
  assert.ok((r.summary?.openQuestions.length ?? 0) >= 1);
  assert.ok(r.summary?.openQuestions.some((q) => q.includes('login')));
});

test('summary parser extracts files to create', async () => {
  const call = async () => SUMMARY_REPLY;
  const r = await runRAA(call, [], 'todo');
  assert.ok(r.summary?.files.some((f) => f.includes('App.tsx')));
});

// ── history passing ────────────────────────────────────────────────────────────

test('runRAA passes history and new message to the model (correct message count)', async () => {
  let seen: ChatMessage[] = [];
  const call = async (msgs: ChatMessage[]) => { seen = msgs; return CLARIFY_REPLY; };
  const history: ChatMessage[] = [
    { role: 'user', content: 'ทำ todo app' },
    { role: 'assistant', content: 'ต้องการ auth ไหมครับ?' },
  ];
  await runRAA(call, history, 'ไม่ต้องการ auth');
  // system + 2 history + new user = 4
  assert.equal(seen.length, 4);
  assert.equal(seen[0].role, 'system');
  assert.equal(seen[seen.length - 1].content, 'ไม่ต้องการ auth');
  assert.equal(seen[seen.length - 1].role, 'user');
});

test('runRAA works with empty history (system + user = 2 messages)', async () => {
  let seen: ChatMessage[] = [];
  const call = async (msgs: ChatMessage[]) => { seen = msgs; return CLARIFY_REPLY; };
  await runRAA(call, [], 'ขอ todo app');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].role, 'system');
  assert.equal(seen[1].role, 'user');
});

test('runRAA caps history at last 20 turns', async () => {
  let seen: ChatMessage[] = [];
  const call = async (msgs: ChatMessage[]) => { seen = msgs; return CLARIFY_REPLY; };
  const longHistory: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i}`,
  }));
  await runRAA(call, longHistory, 'สรุปได้เลย');
  // system + 20 history + user = 22
  assert.equal(seen.length, 22);
});
