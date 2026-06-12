import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTitan, parseBlueprint, blueprintToBuild } from '../core/titan.js';

const PLAN_REPLY = [
  'นี่คือแผนครับ',
  '===TITAN PLAN===',
  '# Deep Analysis',
  '- ระบบต้อง scale ได้',
  '# Plans',
  '## Plan A — Fastest',
  '===END PLAN===',
  'APPROVAL REQUIRED',
  '1. Approve and Generate Code',
].join('\n');

const BLUEPRINT_REPLY = [
  'อนุมัติแล้ว สร้างพิมพ์เขียวให้ครับ',
  '===TITAN BLUEPRINT===',
  'Project: Todo SaaS API',
  'Goal: Commercial Product + High Quality',
  'Type: REST API',
  'Chosen Plan: B — Balanced',
  'Tech Stack: Node.js + Express + PostgreSQL',
  'Files to Create:',
  '- src/app.js — express bootstrap',
  '===END BLUEPRINT===',
  '✅ Blueprint อนุมัติแล้ว — พิมพ์ /gencode เพื่อส่งให้ TMAP engine สร้างโค้ดตามพิมพ์เขียวนี้',
].join('\n');

test('runTitan detects a plan (approval gate) but no blueprint', async () => {
  const call = async () => PLAN_REPLY;
  const r = await runTitan(call, [], 'สร้างเว็บ todo');
  assert.equal(r.hasPlan, true);
  assert.equal(r.hasBlueprint, false);
  assert.equal(r.blueprint, undefined);
});

test('runTitan detects an approved blueprint and parses it', async () => {
  const call = async () => BLUEPRINT_REPLY;
  const r = await runTitan(call, [], '1');
  assert.equal(r.hasBlueprint, true);
  assert.equal(r.blueprint?.project, 'Todo SaaS API');
  assert.equal(r.blueprint?.chosenPlan, 'B — Balanced');
  assert.equal(r.blueprint?.techStack, 'Node.js + Express + PostgreSQL');
});

test('parseBlueprint extracts the raw block without the markers', () => {
  const bp = parseBlueprint(BLUEPRINT_REPLY);
  assert.ok(bp.raw.startsWith('Project: Todo SaaS API'));
  assert.ok(!bp.raw.includes('===TITAN BLUEPRINT==='));
  assert.ok(bp.raw.includes('Files to Create:'));
});

test('blueprintToBuild produces a TMAP task + context from the blueprint', () => {
  const build = blueprintToBuild(parseBlueprint(BLUEPRINT_REPLY));
  assert.equal(build.task, 'Todo SaaS API');
  assert.match(build.context, /Approved Titan Blueprint/);
  assert.match(build.context, /Tech Stack: Node\.js/);
});

test('blueprintToBuild falls back to a default task name', () => {
  const build = blueprintToBuild({ project: '', chosenPlan: '', techStack: '', raw: 'x' });
  assert.equal(build.task, 'project from Titan blueprint');
});

test('runTitan passes history through to the model call', async () => {
  let seen = 0;
  const call = async (messages: { role: string; content: string }[]) => {
    seen = messages.length;
    return 'คำถามเพิ่มเติมครับ';
  };
  const history = [
    { role: 'user' as const, content: 'อยากได้เว็บ' },
    { role: 'assistant' as const, content: 'ตอบคำถามก่อนครับ' },
  ];
  const r = await runTitan(call, history, '3, 2, 4');
  assert.equal(seen, 4); // system + 2 history + new user message
  assert.equal(r.hasPlan, false);
});
