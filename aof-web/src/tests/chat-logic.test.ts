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
  assert.ok(r, 'computable arithmetic must return a reply');
  assert.ok(r.answer.includes('20'), `expected "20" in answer, got: ${r.answer}`);
});

test('composeLearningReply returns steps array with at least 3 entries', () => {
  const r = composeLearningReply('3 * 4');
  assert.ok(r, 'computable arithmetic must return a reply');
  assert.ok(Array.isArray(r.steps));
  assert.ok(r.steps.length >= 3);
});

test('composeLearningReply returns a non-empty concept', () => {
  const r = composeLearningReply('what is 5 + 5');
  assert.ok(r, 'computable arithmetic must return a reply');
  assert.ok(typeof r.concept === 'string');
  assert.ok(r.concept.length > 0);
});

test('Thai input → Thai steps and concept', () => {
  const r = composeLearningReply('คำนวณ 10 + 5');
  assert.ok(r, 'computable arithmetic must return a reply');
  assert.ok(r.steps.some((s) => /[ก-๙]/.test(s)), 'steps should contain Thai text');
  assert.ok(/[ก-๙]/.test(r.concept), 'concept should contain Thai text');
});

test('English input → English steps and concept', () => {
  const r = composeLearningReply('solve 2 + 2');
  assert.ok(r, 'computable arithmetic must return a reply');
  assert.ok(r.steps.every((s) => !/[ก-๙]/.test(s)), 'steps should be in English');
});

// Regression lock: questions the local engine cannot actually solve must return
// null so chat-store falls through to the live model — never a filler template
// that swallows the user's real question (Master Prompt: no fake workflows).
test('non-arithmetic learning problem returns null (falls through to the live model)', () => {
  assert.equal(composeLearningReply('explain probability'), null);
  assert.equal(composeLearningReply('prove that the square root of 2 is irrational'), null);
  assert.equal(composeLearningReply('solve for x in x^2 - 5x + 6 = 0 showing all steps'), null);
});

test('Thai non-arithmetic learning problem returns null', () => {
  assert.equal(composeLearningReply('พิสูจน์ว่ารากที่สองของ 2 เป็นจำนวนอตรรกยะ'), null);
  assert.equal(composeLearningReply('อธิบายความน่าจะเป็นให้หน่อย'), null);
});

// Regression lock: a numeric FRAGMENT of a bigger expression must not be
// computed as if it were the whole question ("x^2 - 5x + 6 = 0" once
// intercepted as "2 - 5 = -3").
test('numeric fragments inside algebra or parentheses return null', () => {
  assert.equal(composeLearningReply('solve x^2 - 5x + 6 = 0'), null);
  assert.equal(composeLearningReply('what is 12 × (3 + 4)?'), null);
});

test('multiplication without parentheses: 12 × 7 = 84', () => {
  // tryArithmetic does not support parentheses — use a flat expression
  const r = composeLearningReply('12 × 7');
  assert.ok(r, 'computable arithmetic must return a reply');
  assert.ok(r.answer.includes('84'), `expected "84" in answer, got: ${r.answer}`);
});
