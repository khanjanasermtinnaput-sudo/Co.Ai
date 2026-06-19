import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { type Request, type Response, type NextFunction } from 'express';

// Minimal Express request mock
function makeReq(ua = '', method = 'POST'): Request {
  return {
    method,
    path: '/v1/run',
    headers: {
      'user-agent':       ua,
      'accept':           ua ? 'application/json' : '',
      'accept-language':  ua ? 'en-US' : '',
      'accept-encoding':  ua ? 'gzip' : '',
    },
  } as unknown as Request;
}

describe('assessBotRisk (tmap-v2)', () => {
  test('missing UA scores high', async () => {
    const { assessBotRisk } = await import('../server/bot-protection.js');
    const risk = assessBotRisk(makeReq(''));
    assert.ok(risk.score >= 60, `expected >= 60, got ${risk.score}`);
    assert.ok(risk.reasons.includes('missing_user_agent'));
  });

  test('python-requests UA detected as bot', async () => {
    const { assessBotRisk } = await import('../server/bot-protection.js');
    const risk = assessBotRisk(makeReq('python-requests/2.28.0'));
    assert.ok(risk.score >= 70);
    assert.ok(risk.reasons.includes('bot_user_agent'));
  });

  test('browser UA scores low', async () => {
    const { assessBotRisk } = await import('../server/bot-protection.js');
    const req = {
      method: 'POST',
      path: '/v1/run',
      headers: {
        'user-agent':      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0',
        'accept':          'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
      },
    } as unknown as Request;
    const risk = assessBotRisk(req);
    assert.ok(risk.score < 80);
    assert.equal(risk.blocked, false);
  });

  test('score never exceeds 100', async () => {
    const { assessBotRisk } = await import('../server/bot-protection.js');
    const risk = assessBotRisk(makeReq(''));
    assert.ok(risk.score <= 100);
  });

  test('botProtectionMiddleware calls next for clean request', async () => {
    const { botProtectionMiddleware } = await import('../server/bot-protection.js');
    const middleware = botProtectionMiddleware();
    let nextCalled = false;
    const req = {
      method: 'POST',
      path: '/v1/run',
      headers: {
        'user-agent':      'Mozilla/5.0 Chrome/120',
        'accept':          'application/json',
        'accept-language': 'en',
        'accept-encoding': 'gzip',
      },
    } as unknown as Request;
    const res = {
      setHeader: () => {},
      status: () => ({ json: () => {} }),
    } as unknown as Response;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});
