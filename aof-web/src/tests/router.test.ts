import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest, routeLabel } from '../lib/router.js';
import type { Attachment } from '../lib/types.js';

function att(kind: Attachment['kind'], name = 'file.txt'): Attachment {
  return { id: '1', kind, name, mime: 'text/plain', size: 100 };
}

// ── default → Co.AI ─────────────────────────────────────────────────

test('general question routes to chat', () => {
  const r = routeRequest('What is the capital of France?');
  assert.equal(r.target, 'chat');
  assert.equal(r.label, 'Co.AI');
});

test('greeting routes to chat', () => {
  const r = routeRequest('สวัสดีครับ');
  assert.equal(r.target, 'chat');
});

test('empty-ish question routes to chat (default fallback)', () => {
  const r = routeRequest('tell me something interesting');
  assert.equal(r.target, 'chat');
});

// ── build intents → CoCode ───────────────────────────────────────────

test('explicit code-writing request routes to code', () => {
  const r = routeRequest('write me some code');
  assert.equal(r.target, 'code');
  assert.equal(r.label, 'CoCode');
});

test('debugging a concrete artifact routes to code', () => {
  const r = routeRequest('help me debug this function');
  assert.equal(r.target, 'code');
});

test('build request routes to code', () => {
  const r = routeRequest('build a landing page in React');
  assert.equal(r.target, 'code');
});

test('Thai programming request routes to code', () => {
  const r = routeRequest('เขียนโค้ด python ให้หน่อย');
  assert.equal(r.target, 'code');
});

test('architecture design work routes to code', () => {
  const r = routeRequest('design the architecture for a REST API');
  assert.equal(r.target, 'code');
});

test('Thai build request routes to code', () => {
  const r = routeRequest('สร้างเว็บขายของให้หน่อย');
  assert.equal(r.target, 'code');
});

// ── engineering questions → answered in chat, not deflected ──────────

test('deploy how-to question is answered in chat', () => {
  const r = routeRequest('how do I deploy to Vercel?');
  assert.equal(r.target, 'chat');
});

test('refactor advice question is answered in chat', () => {
  const r = routeRequest('help me refactor a react component for performance');
  assert.equal(r.target, 'chat');
});

test('tech comparison question is answered in chat', () => {
  const r = routeRequest('what is the difference between SQL and NoSQL databases?');
  assert.equal(r.target, 'chat');
});

// ── search keywords → Search Agent ───────────────────────────────────────────

test('search keyword routes to search agent', () => {
  const r = routeRequest('search the web for latest AI news');
  assert.equal(r.target, 'search');
  assert.equal(r.label, 'Search Agent');
});

test('Thai news keyword routes to search', () => {
  const r = routeRequest('ข่าวล่าสุดวันนี้');
  assert.equal(r.target, 'search');
});

test('"latest" keyword routes to search', () => {
  const r = routeRequest('what is the latest version of Node.js');
  assert.equal(r.target, 'search');
});

test('"today\'s" keyword routes to search', () => {
  const r = routeRequest("what is today's exchange rate?");
  assert.equal(r.target, 'search');
});

// ── attachments ───────────────────────────────────────────────────────────────

test('code file attachment always routes to code', () => {
  const r = routeRequest('review this please', [att('code', 'app.ts')]);
  assert.equal(r.target, 'code');
  assert.ok(r.reason.includes('app.ts'));
});

test('code file attachment overrides search keywords', () => {
  const r = routeRequest('search for issues in this', [att('code', 'main.py')]);
  assert.equal(r.target, 'code');
});

test('image attachment without coding ask routes to chat', () => {
  const r = routeRequest('what do you see?', [att('image')]);
  assert.equal(r.target, 'chat');
  assert.ok(r.reason.toLowerCase().includes('image'));
});

test('pdf attachment without coding ask routes to chat', () => {
  const r = routeRequest('summarize this', [att('pdf')]);
  assert.equal(r.target, 'chat');
  assert.ok(r.reason.toLowerCase().includes('pdf'));
});

// ── routeLabel ────────────────────────────────────────────────────────────────

test('routeLabel returns correct labels for all targets', () => {
  assert.equal(routeLabel('chat'), 'Co.AI');
  assert.equal(routeLabel('code'), 'CoCode');
  assert.equal(routeLabel('search'), 'Search Agent');
});

// ── RouteDecision shape ───────────────────────────────────────────────────────

test('every route decision has target, label, and reason', () => {
  const r = routeRequest('hello');
  assert.ok(r.target);
  assert.ok(r.label);
  assert.ok(r.reason);
});
