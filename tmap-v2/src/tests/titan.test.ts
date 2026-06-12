import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTitan, parseBlueprint, parseConfidence, blueprintToBuild } from '../core/titan.js';
import type { ChatMessage } from '../types.js';

const PLAN_REPLY = [
  'นี่คือแผนครับ',
  '===TITAN PLAN===',
  '# Deep Analysis',
  '- ระบบต้อง scale ได้',
  '# Plans',
  '## Plan A — Fastest',
  '# Planning Score',
  'Overall Confidence: 91%',
  '===END PLAN===',
  'APPROVAL REQUIRED',
  '1. Approve and Generate Code',
].join('\n');

const LOW_CONFIDENCE_PLAN = PLAN_REPLY.replace('Overall Confidence: 91%', 'Overall Confidence: 70%');

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
  const r = await runTitan(call, [], 'สร้างเว็บ todo', { selfReview: false });
  assert.equal(r.hasPlan, true);
  assert.equal(r.hasBlueprint, false);
  assert.equal(r.blueprint, undefined);
  assert.equal(r.confidence, 91);
});

test('runTitan detects an approved blueprint and parses it', async () => {
  const call = async () => BLUEPRINT_REPLY;
  const r = await runTitan(call, [], '1', { selfReview: false });
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
  const call = async (messages: ChatMessage[]) => {
    seen = messages.length;
    return 'คำถามเพิ่มเติมครับ';
  };
  const history: ChatMessage[] = [
    { role: 'user', content: 'อยากได้เว็บ' },
    { role: 'assistant', content: 'ตอบคำถามก่อนครับ' },
  ];
  const r = await runTitan(call, history, '3, 2, 4');
  assert.equal(seen, 4); // system + 2 history + new user message
  assert.equal(r.hasPlan, false);
});

// ── parseConfidence ───────────────────────────────────────────────────────────
test('parseConfidence reads the Overall Confidence line', () => {
  assert.equal(parseConfidence(PLAN_REPLY), 91);
  assert.equal(parseConfidence('Overall Confidence: 70 %'), 70);
  assert.equal(parseConfidence('no score here'), null);
});

test('parseConfidence uses the LAST occurrence (revised plans)', () => {
  assert.equal(parseConfidence('Overall Confidence: 80%\n...\nOverall Confidence: 93%'), 93);
});

// ── ENFORCED CONFIDENCE CHECK ─────────────────────────────────────────────────
test('a plan below 85% confidence is withheld and replaced by questions', async () => {
  const calls: string[] = [];
  const call = async (messages: ChatMessage[]) => {
    calls.push(messages[messages.length - 1].content);
    if (calls.length === 1) return LOW_CONFIDENCE_PLAN;
    return 'ขอถามเพิ่ม: 1) ผู้ใช้กี่คน? 2) ต้องมี auth ไหม?';
  };
  const r = await runTitan(call, [], 'สร้างเว็บ', { selfReview: false });
  assert.equal(r.confidenceBlocked, true);
  assert.equal(r.hasPlan, false);
  assert.equal(r.confidence, 70);
  assert.ok(!r.text.includes('===TITAN PLAN==='));       // plan physically removed
  assert.match(calls[1], /SYSTEM ENFORCEMENT/);          // enforcement call happened
});

test('a plan at/above 85% confidence is NOT blocked', async () => {
  const call = async () => PLAN_REPLY;
  const r = await runTitan(call, [], 'สร้างเว็บ', { selfReview: false });
  assert.equal(r.confidenceBlocked, undefined);
  assert.equal(r.hasPlan, true);
});

// ── REAL SELF REVIEW LOOP ─────────────────────────────────────────────────────
test('self-review runs 5 passes and applies findings via a revision call', async () => {
  let n = 0;
  const REVISED = PLAN_REPLY.replace('- ระบบต้อง scale ได้', '- ระบบต้อง scale ได้ (เพิ่ม rate limiting แล้ว)');
  const call = async (messages: ChatMessage[]) => {
    n++;
    if (n === 1) return PLAN_REPLY;                       // the plan turn
    const sys = messages[0].content;
    if (/Self-Review engine \(pass: Security\)/.test(sys)) return '- ควรเพิ่ม rate limiting ที่ API';
    if (/Self-Review engine/.test(sys)) return 'OK';      // other 4 passes clean
    return REVISED;                                       // the revision call
  };
  const events: string[] = [];
  const r = await runTitan(call, [], 'สร้างเว็บ', { emit: (_r, t) => events.push(t) });
  assert.equal(n, 7);                                     // 1 plan + 5 passes + 1 revision
  assert.equal(r.hasPlan, true);
  assert.deepEqual(r.reviewFindings, ['[Security] ควรเพิ่ม rate limiting ที่ API']);
  assert.match(r.text, /rate limiting แล้ว/);             // revision applied
  assert.ok(events.some((e) => /self-review pass 3\/5: Security/.test(e)));
});

test('self-review with all passes clean leaves the plan unchanged', async () => {
  let n = 0;
  const call = async () => (++n === 1 ? PLAN_REPLY : 'OK');
  const r = await runTitan(call, [], 'สร้างเว็บ');
  assert.equal(n, 6);                                     // 1 plan + 5 passes, no revision
  assert.equal(r.text, PLAN_REPLY);
  assert.equal(r.reviewFindings, undefined);
});

test('a broken revision (lost markers) keeps the original plan', async () => {
  let n = 0;
  const call = async (messages: ChatMessage[]) => {
    n++;
    if (n === 1) return PLAN_REPLY;
    if (/Self-Review engine/.test(messages[0].content)) return '- finding';
    return 'oops, free text without markers';
  };
  const r = await runTitan(call, [], 'สร้างเว็บ');
  assert.equal(r.hasPlan, true);
  assert.match(r.text, /===TITAN PLAN===/);               // original survived
});

test('a failing review pass is skipped without killing the turn', async () => {
  let n = 0;
  const call = async (messages: ChatMessage[]) => {
    n++;
    if (n === 1) return PLAN_REPLY;
    if (/Self-Review engine/.test(messages[0].content)) throw new Error('provider down');
    return 'unused';
  };
  const r = await runTitan(call, [], 'สร้างเว็บ');
  assert.equal(r.hasPlan, true);
  assert.equal(r.reviewFindings, undefined);
});

// ── PROJECT MEMORY ────────────────────────────────────────────────────────────
test('memoryContext is injected into the system prompt', async () => {
  let sys = '';
  const call = async (messages: ChatMessage[]) => { sys = messages[0].content; return 'ถามต่อครับ'; };
  await runTitan(call, [], 'สวัสดี', { memoryContext: '## Project Memory\nTech stack: Node.js + Express' });
  assert.match(sys, /Project Memory/);
  assert.match(sys, /Tech stack: Node\.js \+ Express/);
  assert.match(sys, /stay consistent with past decisions/);
});

test('blueprint turns skip the self-review loop entirely', async () => {
  let n = 0;
  const call = async () => { n++; return BLUEPRINT_REPLY; };
  const r = await runTitan(call, [], '1');
  assert.equal(n, 1);                                     // exactly one call — no review passes
  assert.equal(r.hasBlueprint, true);
});
