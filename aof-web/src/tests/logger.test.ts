// Tests for the aof-web structured logger
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Logger — structured output', () => {
  test('info outputs JSON with required fields', async () => {
    const { logger } = await import('../lib/server/logger.js');
    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg: string) => lines.push(msg);
    logger.info('test message', { route: '/api/test' });
    console.log = orig;

    assert.ok(lines.length > 0, 'no output captured');
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level,   'info');
    assert.equal(parsed.msg,     'test message');
    assert.equal(parsed.service, 'coagentix-web');
    assert.match(parsed.ts,      /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(parsed.route,   '/api/test');
  });

  test('error outputs to console.error', async () => {
    const { logger } = await import('../lib/server/logger.js');
    const lines: string[] = [];
    const orig = console.error;
    console.error = (msg: string) => lines.push(msg);
    logger.error('something broke', { code: 500 });
    console.error = orig;

    assert.ok(lines.length > 0);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.code,  500);
  });

  test('child logger inherits bindings', async () => {
    const { logger } = await import('../lib/server/logger.js');
    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg: string) => lines.push(msg);
    const child = logger.child({ userId: 'u123', path: '/api/chat' });
    child.info('request handled');
    console.log = orig;

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.userId, 'u123');
    assert.equal(parsed.path,   '/api/chat');
  });

  test('requestLogger binds correlationId from request header', async () => {
    const { requestLogger } = await import('../lib/server/logger.js');
    const req = new Request('http://localhost/api/test', {
      headers: { 'x-correlation-id': 'test-corr-id' },
    });
    const log = requestLogger(req);

    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg: string) => lines.push(msg);
    log.info('handling');
    console.log = orig;

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.correlationId, 'test-corr-id');
  });
});

describe('Correlation helpers', () => {
  test('getCorrelationId reads X-Correlation-ID header', async () => {
    const { getCorrelationId } = await import('../lib/server/correlation.js');
    const req = new Request('http://localhost/', {
      headers: { 'x-correlation-id': 'abc-123' },
    });
    assert.equal(getCorrelationId(req), 'abc-123');
  });

  test('getCorrelationId generates UUID when header is absent', async () => {
    const { getCorrelationId } = await import('../lib/server/correlation.js');
    const req = new Request('http://localhost/');
    const id = getCorrelationId(req);
    assert.match(id, /^[0-9a-f-]{36}$/);
  });

  test('correlationHeaders returns an object with X-Correlation-ID', async () => {
    const { correlationHeaders } = await import('../lib/server/correlation.js');
    const headers = correlationHeaders('my-corr-id');
    assert.equal(headers['X-Correlation-ID'], 'my-corr-id');
    assert.ok(typeof headers['X-Request-ID'] === 'string');
  });
});
