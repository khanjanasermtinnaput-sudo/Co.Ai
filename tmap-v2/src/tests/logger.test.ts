// Tests for the structured logger and in-memory metrics
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

async function captureOutput(fn: () => void | Promise<void>): Promise<{ out: string; err: string }> {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const wOut = (chunk: Buffer | string) => { outChunks.push(Buffer.from(chunk as string)); return true; };
  const wErr = (chunk: Buffer | string) => { errChunks.push(Buffer.from(chunk as string)); return true; };
  Object.assign(process.stdout, { write: wOut });
  Object.assign(process.stderr, { write: wErr });
  try { await fn(); } finally {
    Object.assign(process.stdout, { write: origOut });
    Object.assign(process.stderr, { write: origErr });
  }
  return { out: outChunks.map((b) => b.toString()).join(''), err: errChunks.map((b) => b.toString()).join('') };
}

describe('Logger — structured output', () => {
  test('info writes JSON to stdout', async () => {
    const { logger } = await import('../server/logger.js');
    const { out } = await captureOutput(() => logger.info('hello test', { x: 1 }));
    const parsed = JSON.parse(out.trim());
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'hello test');
    assert.equal(parsed.x, 1);
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(parsed.service, 'coagentix-tmap-v2');
  });

  test('warn writes JSON to stderr', async () => {
    const { logger } = await import('../server/logger.js');
    const { err } = await captureOutput(() => logger.warn('uh oh', { code: 'E001' }));
    const parsed = JSON.parse(err.trim());
    assert.equal(parsed.level, 'warn');
    assert.equal(parsed.code, 'E001');
  });

  test('error writes JSON to stderr', async () => {
    const { logger } = await import('../server/logger.js');
    const { err } = await captureOutput(() => logger.error('boom', { error: 'TestError' }));
    const parsed = JSON.parse(err.trim());
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.error, 'TestError');
  });

  test('child logger inherits bound fields', async () => {
    const { logger } = await import('../server/logger.js');
    const child = logger.child({ component: 'worker', jobId: 'abc123' });
    const { out } = await captureOutput(() => child.info('processing'));
    const parsed = JSON.parse(out.trim());
    assert.equal(parsed.component, 'worker');
    assert.equal(parsed.jobId, 'abc123');
    assert.equal(parsed.msg, 'processing');
  });
});

describe('Logger — in-memory metrics', () => {
  test('incRequest increments counter', async () => {
    const { incRequest, getMetrics } = await import('../server/logger.js');
    const before = getMetrics().requests;
    incRequest();
    assert.equal(getMetrics().requests, before + 1);
  });

  test('addTokens accumulates correctly', async () => {
    const { addTokens, getMetrics } = await import('../server/logger.js');
    const before = getMetrics().totalTokens;
    addTokens(100, 0.001);
    addTokens(200, 0.002);
    assert.equal(getMetrics().totalTokens, before + 300);
  });

  test('getMetrics includes uptimeSec >= 0', async () => {
    const { getMetrics } = await import('../server/logger.js');
    const m = getMetrics();
    assert.ok(m.uptimeSec >= 0);
  });
});
