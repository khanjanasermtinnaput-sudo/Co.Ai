import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessBotRisk } from '../lib/server/bot-protection';

function makeReq(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://example.com/api/test', {
    method,
    headers,
  });
}

describe('assessBotRisk', () => {
  test('clean browser request scores below threshold', () => {
    const risk = assessBotRisk(makeReq({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
      'accept': 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'sec-fetch-site': 'same-origin',
    }));
    assert.ok(risk.score < 80, `expected score < 80, got ${risk.score}`);
    assert.equal(risk.blocked, false);
  });

  test('python-requests UA gets high score', () => {
    const risk = assessBotRisk(makeReq({
      'user-agent': 'python-requests/2.31.0',
    }));
    assert.ok(risk.score >= 70, `expected score >= 70, got ${risk.score}`);
    assert.ok(risk.reasons.includes('bot_user_agent'));
  });

  test('curl UA gets high score', () => {
    const risk = assessBotRisk(makeReq({ 'user-agent': 'curl/8.1.2' }));
    assert.ok(risk.score >= 70);
    assert.ok(risk.reasons.includes('bot_user_agent'));
  });

  test('missing UA scores 60+', () => {
    const risk = assessBotRisk(makeReq({}));
    assert.ok(risk.score >= 60);
    assert.ok(risk.reasons.includes('missing_user_agent'));
  });

  test('missing accept-language adds to score', () => {
    const risk = assessBotRisk(makeReq({
      'user-agent': 'Mozilla/5.0 something',
      'accept': 'application/json',
      'accept-encoding': 'gzip',
    }));
    assert.ok(risk.reasons.includes('missing_accept_language'));
  });

  test('GET requests: missing sec-fetch-site does not count', () => {
    const risk = assessBotRisk(makeReq({
      'user-agent': 'Mozilla/5.0 Chrome',
      'accept': 'text/html',
      'accept-language': 'en',
      'accept-encoding': 'gzip',
    }, 'GET'));
    assert.ok(!risk.reasons.includes('missing_sec_fetch_site_on_post'));
  });

  test('score is capped at 100', () => {
    const risk = assessBotRisk(makeReq({}));
    assert.ok(risk.score <= 100);
  });

  test('blocked flag matches threshold', () => {
    const risk = assessBotRisk(makeReq({ 'user-agent': 'python-requests/2.31.0' }));
    assert.equal(risk.blocked, risk.score >= 80);
  });
});
