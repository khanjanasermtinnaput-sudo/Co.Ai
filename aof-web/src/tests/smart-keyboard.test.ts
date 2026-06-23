/**
 * Smart Keyboard — unit tests
 *
 * Runner: node:test (Node 18+, matches existing test suite)
 * Run: npx tsx src/tests/smart-keyboard.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { convertEnToTh, convertThToEn, isSafeToConvert } from '../lib/smart-keyboard/converter';
import { detectWrongLayout } from '../lib/smart-keyboard/detector';
import { EN_TO_TH_MAP, TH_TO_EN_MAP } from '../lib/smart-keyboard/keyboard-map';

// ─── convertEnToTh ────────────────────────────────────────────────────────────

describe('convertEnToTh', () => {
  test('spec example: l;ylfu8iy[ → สวัสดีครับ', () => {
    assert.equal(convertEnToTh('l;ylfu8iy['), 'สวัสดีครับ');
  });

  test('spaces are preserved', () => {
    const result = convertEnToTh('l;ylfu8iy[ l;ylfu8iy[');
    assert.equal(result, 'สวัสดีครับ สวัสดีครับ');
  });

  test('unmapped chars pass through unchanged', () => {
    // Newlines, tabs, digits not in map all pass through
    assert.equal(convertEnToTh('\n\t'), '\n\t');
  });

  test('round-trip: English → Thai → English for common chars', () => {
    const input = 'l;ylfu8iy[';
    const thai = convertEnToTh(input);
    const back = convertThToEn(thai);
    assert.equal(back, input);
  });

  test('mapped digits convert correctly', () => {
    assert.equal(convertEnToTh('8'), 'ค');  // ค
    assert.equal(convertEnToTh('9'), 'ต');  // ต
    assert.equal(convertEnToTh('0'), 'จ');  // จ
  });

  test('home row consonants', () => {
    // a→ฟ, s→ห, d→ก, f→ด, l→ส
    assert.equal(convertEnToTh('asdf'), 'ฟหกด');
    assert.equal(convertEnToTh('l'), 'ส');
  });
});

// ─── convertThToEn ────────────────────────────────────────────────────────────

describe('convertThToEn', () => {
  test('สวัสดีครับ → l;ylfu8iy[', () => {
    assert.equal(convertThToEn('สวัสดีครับ'), 'l;ylfu8iy[');
  });

  test('non-Thai chars pass through', () => {
    assert.equal(convertThToEn('hello'), 'hello');
    assert.equal(convertThToEn('123'), '123');
  });

  test('mixed Thai and ASCII', () => {
    const result = convertThToEn('สวัสดี world');
    assert.equal(result, 'l;ylfu world');
  });
});

// ─── isSafeToConvert ─────────────────────────────────────────────────────────

describe('isSafeToConvert', () => {
  test('returns false for empty string', () => {
    assert.equal(isSafeToConvert(''), false);
    assert.equal(isSafeToConvert('   '), false);
  });

  test('spec example: const a = 1; → NOT safe', () => {
    assert.equal(isSafeToConvert('const a = 1;'), false);
  });

  test('spec example: https://google.com/... → NOT safe', () => {
    assert.equal(isSafeToConvert('https://google.com/search?q=test'), false);
  });

  test('http URL → NOT safe', () => {
    assert.equal(isSafeToConvert('http://example.com'), false);
  });

  test('email → NOT safe', () => {
    assert.equal(isSafeToConvert('user@example.com'), false);
  });

  test('inline code backtick → NOT safe', () => {
    assert.equal(isSafeToConvert('use `useState` hook'), false);
  });

  test('JS keywords → NOT safe', () => {
    const unsafe = [
      'function hello()',
      'import React from',
      'export default App',
      'if (x > 0)',
      'return null',
      'const x = 5',
      'let y = 10',
      'async function',
    ];
    for (const text of unsafe) {
      assert.equal(isSafeToConvert(text), false, `Expected unsafe: "${text}"`);
    }
  });

  test('Windows file path → NOT safe', () => {
    assert.equal(isSafeToConvert('C:\\Users\\foo\\file.txt'), false);
  });

  test('Unix path → NOT safe', () => {
    assert.equal(isSafeToConvert('/usr/local/bin/node'), false);
  });

  test('JS operators → NOT safe', () => {
    assert.equal(isSafeToConvert('x => x + 1'), false);
    assert.equal(isSafeToConvert('a === b'), false);
  });

  test('plain Thai text → safe', () => {
    assert.equal(isSafeToConvert('สวัสดีครับ'), true);
  });

  test('plain wrongly-typed English → safe', () => {
    assert.equal(isSafeToConvert('l;ylfu8iy['), true);
  });
});

// ─── detectWrongLayout ───────────────────────────────────────────────────────

describe('detectWrongLayout', () => {
  // ── spec test cases ────────────────────────────────────────────────────────

  test('spec 1: l;ylfu8iy[ → en->th, high confidence', () => {
    const result = detectWrongLayout('l;ylfu8iy[');
    assert.equal(result.type, 'en->th');
    assert.ok(result.confidence >= 80, `Expected >=80, got ${result.confidence}`);
    assert.equal(result.converted, 'สวัสดีครับ');
  });

  test('spec 2: hello world → no conversion (type=none or confidence<50)', () => {
    const result = detectWrongLayout('hello world');
    // "hello world" maps to ้ำสสน ไนพสก — invalid Thai start → low confidence
    const noConversion = result.type === 'none' || result.confidence < 50;
    assert.ok(
      noConversion,
      `Expected no conversion for "hello world", got type=${result.type} confidence=${result.confidence}`
    );
  });

  test('spec 3: const a = 1; → blocked by isSafeToConvert, detectWrongLayout still returns low/none', () => {
    // detectWrongLayout itself doesn't call isSafeToConvert — that gate lives in the context.
    // But "const" contains no Thai-signal chars so confidence should be low.
    const result = detectWrongLayout('const a = 1;');
    const noConversion = result.type === 'none' || result.confidence < 50;
    assert.ok(
      noConversion,
      `Expected no auto-conversion for code text, got ${result.type} @ ${result.confidence}`
    );
  });

  test('spec 4: https://google.com URL → returns none', () => {
    // URLs contain ':' and '/' which do map to Thai chars, but
    // the detect fn sees mixed latin+symbol not matching Thai patterns well.
    // In practice isSafeToConvert blocks this, but detect should also be benign.
    const result = detectWrongLayout('https://google.com/search?q=test');
    // Either none, or very low confidence
    const benign = result.type === 'none' || result.confidence < 50;
    assert.ok(benign, `URL should not auto-convert, got ${result.type}@${result.confidence}`);
  });

  test('spec 5: สวัสดี how are you → no conversion (mixed language)', () => {
    const result = detectWrongLayout('สวัสดี how are you');
    assert.equal(result.type, 'none', 'Mixed Thai+English must never auto-convert');
    assert.equal(result.confidence, 0);
  });

  // ── Additional cases ───────────────────────────────────────────────────────

  test('empty / whitespace → none', () => {
    assert.equal(detectWrongLayout('').type, 'none');
    assert.equal(detectWrongLayout('  ').type, 'none');
  });

  test('single char → none (too short)', () => {
    assert.equal(detectWrongLayout('l').type, 'none');
    assert.equal(detectWrongLayout('ส').type, 'none');
  });

  test('สวัสดีครับ → th->en at low/zero confidence (valid Thai, should NOT auto-flip)', () => {
    const result = detectWrongLayout('สวัสดีครับ');
    // This IS valid Thai, so th->en confidence should be low
    const noAutoConvert = result.confidence < 80;
    assert.ok(
      noAutoConvert,
      `Valid Thai text should not auto-convert to English, confidence=${result.confidence}`
    );
  });

  test('longer Thai-signal string produces high confidence', () => {
    // "adgjs" maps to ฟหเ่ห → mostly consonants, low signal chars → moderate
    // "l;ylfu" maps to สว ัสด → clear consonant+vowel pattern
    const result = detectWrongLayout('l;ylfu');
    assert.equal(result.type, 'en->th');
    assert.ok(result.confidence >= 70, `Expected >=70, got ${result.confidence}`);
  });

  test('pure English sentence → no conversion', () => {
    const result = detectWrongLayout('This is a test message.');
    const safe = result.type === 'none' || result.confidence < 50;
    assert.ok(safe, `Pure English should not convert, got ${result.type}@${result.confidence}`);
  });

  test('signal chars dramatically increase confidence', () => {
    // Multiple ;[]\ in text → high Thai signal
    const withSignal = detectWrongLayout('l;yf[');
    const withoutSignal = detectWrongLayout('lgyfd');
    assert.ok(
      withSignal.confidence > withoutSignal.confidence,
      `Signal chars should boost confidence: ${withSignal.confidence} vs ${withoutSignal.confidence}`
    );
  });
});

// ─── Keyboard map sanity ──────────────────────────────────────────────────────

describe('keyboard-map', () => {
  test('EN_TO_TH_MAP covers all standard QWERTY letter keys', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    for (const ch of letters) {
      assert.ok(ch in EN_TO_TH_MAP, `Missing mapping for '${ch}'`);
    }
  });

  test('TH_TO_EN_MAP is non-empty', () => {
    assert.ok(Object.keys(TH_TO_EN_MAP).length > 0);
  });

  test('TH_TO_EN_MAP values are all single ASCII chars', () => {
    for (const [th, en] of Object.entries(TH_TO_EN_MAP)) {
      assert.equal(en.length, 1, `TH_TO_EN_MAP['${th}'] = '${en}' should be 1 char`);
    }
  });

  test('specific key spot checks', () => {
    assert.equal(EN_TO_TH_MAP['l'], 'ส');
    assert.equal(EN_TO_TH_MAP[';'], 'ว');
    assert.equal(EN_TO_TH_MAP['y'], 'ั');
    assert.equal(EN_TO_TH_MAP['f'], 'ด');
    assert.equal(EN_TO_TH_MAP['u'], 'ี');
    assert.equal(EN_TO_TH_MAP['8'], 'ค');
    assert.equal(EN_TO_TH_MAP['i'], 'ร');
    assert.equal(EN_TO_TH_MAP['['], 'บ');
    assert.equal(EN_TO_TH_MAP['d'], 'ก');
    assert.equal(EN_TO_TH_MAP['g'], 'เ');
  });
});
