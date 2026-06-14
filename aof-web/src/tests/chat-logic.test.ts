import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLearningProblem, composeLearningReply } from '../lib/mock.js';

// ── isLearningProblem ─────────────────────────────────────────────────────────

test('detects simple arithmetic', () => {
  assert.equal(isLearningProblem('what is 12 + 8'), true);
  assert.equal(isLearningProblem('3 * 4 = ?'), true);
  assert.equal(isLearningProblem('100 / 5'), true);
});

test('detects multiplication using × symbol', () => {
  assert.equal(isLearningProblem('12 × (3 + 4)'), true);
});

test('detects math verbs: solve, calculate, compute', () => {
  assert.equal(isLearningProblem('solve for x in 2x + 3 = 7'), true);
  assert.equal(isLearningProblem('calculate the area of a circle'), true);
  assert.equal(isLearningProblem('compute the derivative of x^2'), true);
});

test('detects math nouns: equation, fraction, probability', () => {
  assert.equal(isLearningProblem('explain this equation'), true);
  assert.equal(isLearningProblem('how does a fraction work?'), true);
  assert.equal(isLearningProblem('what is probability?'), true);
});

test('detects Thai math keywords', () => {
  assert.equal(isLearningProblem('แก้สมการ 2x = 10'), true);
  assert.equal(isLearningProblem('คำนวณพื้นที่วงกลม'), true);
  assert.equal(isLearningProblem('หาค่า x'), true);
});

test('does NOT flag general chat as a learning problem', () => {
  assert.equal(isLearningProblem('what is the capital of France?'), false);
  assert.equal(isLearningProblem('hello, how are you?'), false);
  assert.equal(isLearningProblem('สวัสดีครับ'), false);
});

// ── composeLearningReply ──────────────────────────────────────────────────────

test('arithmetic expression returns the computed answer', () => {
  const r = composeLearningReply('what is 12 + 8');
  assert.ok(r.answer.includes('20'), `expected "20" in answer, got: ${r.answer}`);
});

test('composeLearningReply returns steps array with at least 3 entries', () => {
  const r = composeLearningReply('3 * 4');
  assert.ok(Array.isArray(r.steps));
  assert.ok(r.steps.length >= 3);
});

test('composeLearningReply returns a non-empty concept', () => {
  const r = composeLearningReply('what is 5 + 5');
  assert.ok(typeof r.concept === 'string');
  assert.ok(r.concept.length > 0);
});

test('Thai input → Thai steps and concept', () => {
  const r = composeLearningReply('คำนวณ 10 + 5');
  assert.ok(r.steps.some((s) => /[ก-๙]/.test(s)), 'steps should contain Thai text');
  assert.ok(/[ก-๙]/.test(r.concept), 'concept should contain Thai text');
});

test('English input → English steps and concept', () => {
  const r = composeLearningReply('solve 2 + 2');
  assert.ok(r.steps.every((s) => !/[ก-๙]/.test(s)), 'steps should be in English');
});

test('non-arithmetic learning problem still returns structured reply', () => {
  const r = composeLearningReply('explain probability');
  assert.ok(typeof r.answer === 'string' && r.answer.length > 0);
  assert.ok(r.steps.length >= 3);
  assert.ok(r.concept.length > 0);
});

test('multiplication without parentheses: 12 × 7 = 84', () => {
  // tryArithmetic does not support parentheses — use a flat expression
  const r = composeLearningReply('12 × 7');
  assert.ok(r.answer.includes('84'), `expected "84" in answer, got: ${r.answer}`);
});
