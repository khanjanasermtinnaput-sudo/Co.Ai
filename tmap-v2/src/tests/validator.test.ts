import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles } from '../core/validator.js';

describe('validateFiles', () => {
  test('passes valid JS', () => {
    const results = validateFiles([{ path: 'index.js', language: 'javascript', content: 'const x = 1;\nconsole.log(x);\n' }]);
    assert.equal(results.length, 1);
    assert.equal(results[0].passed, true);
    assert.equal(results[0].kind, 'syntax');
  });

  test('fails invalid JS', () => {
    const results = validateFiles([{ path: 'bad.js', language: 'javascript', content: 'const x = {{{;' }]);
    assert.equal(results[0].passed, false);
  });

  test('passes valid JSON', () => {
    const results = validateFiles([{ path: 'pkg.json', language: 'json', content: '{"name":"test"}' }]);
    assert.equal(results[0].passed, true);
  });

  test('fails invalid JSON', () => {
    const results = validateFiles([{ path: 'bad.json', language: 'json', content: '{invalid}' }]);
    assert.equal(results[0].passed, false);
  });

  test('skips unknown language', () => {
    const results = validateFiles([{ path: 'app.rb', language: 'ruby', content: 'puts "hi"' }]);
    assert.equal(results[0].passed, true);
    assert.equal(results[0].kind, 'skipped');
  });

  test('handles multiple files', () => {
    const results = validateFiles([
      { path: 'a.js', language: 'javascript', content: 'const a = 1;' },
      { path: 'b.json', language: 'json', content: '{"b":2}' },
      { path: 'c.py', language: 'python', content: 'x = 1' },
    ]);
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.passed));
  });

  test('passes valid TS with ternary and switch (regression: regex-strip false-fail)', () => {
    const content = [
      'const x: number = 1;',
      "const label: string = x > 0 ? 'pos' : 'neg';",
      'switch (x) {',
      '  case 1:',
      '    console.log(label);',
      '    break;',
      '  default:',
      '    break;',
      '}',
    ].join('\n');
    const results = validateFiles([{ path: 'app.ts', language: 'typescript', content }]);
    assert.equal(results[0].passed, true);
    assert.equal(results[0].kind, 'syntax');
  });

  test('passes valid TS with interface, generics and union types', () => {
    const content = [
      'interface Box<T> { value: T }',
      'type Id = string | number;',
      'function wrap<T>(value: T): Box<T> { return { value }; }',
      'const id: Id = wrap<number>(1).value;',
      'console.log(id);',
    ].join('\n');
    const results = validateFiles([{ path: 'box.ts', language: 'typescript', content }]);
    assert.equal(results[0].passed, true);
  });

  test('fails TS with a real syntax error', () => {
    const results = validateFiles([{ path: 'bad.ts', language: 'typescript', content: 'const x: number = ;' }]);
    assert.equal(results[0].passed, false);
    assert.equal(results[0].kind, 'syntax');
  });
});
