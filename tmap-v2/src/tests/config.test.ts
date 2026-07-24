// Configuration Manager (src/config.ts) — currentMode()/mockAllowed() env
// resolution. Both are pure functions of process.env, so we test them
// directly against synthetic env snapshots (save/restore around each test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { currentMode, mockAllowed } from '../config.js';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const keys = ['COAGENTIX_MODE', 'AOF_MODE', 'COAGENTIX_ALLOW_MOCK', 'AOF_ALLOW_MOCK', 'NODE_ENV', 'VERCEL', 'RENDER'];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('invalid: an unrecognized COAGENTIX_MODE value falls back to normal, not thrown or fabricated', () => {
  withEnv({ COAGENTIX_MODE: 'nonsense-mode' }, () => {
    assert.equal(currentMode(), 'normal');
  });
});

test('invalid: an empty-string COAGENTIX_MODE also falls back to normal', () => {
  withEnv({ COAGENTIX_MODE: '' }, () => {
    assert.equal(currentMode(), 'normal');
  });
});

test('normal: each of the three real modes round-trips through currentMode() case-insensitively', () => {
  withEnv({ COAGENTIX_MODE: 'LITE' }, () => assert.equal(currentMode(), 'lite'));
  withEnv({ COAGENTIX_MODE: 'Pro' }, () => assert.equal(currentMode(), 'pro'));
  withEnv({ COAGENTIX_MODE: 'normal' }, () => assert.equal(currentMode(), 'normal'));
});

test('normal: AOF_MODE is the fallback when COAGENTIX_MODE is unset', () => {
  withEnv({ AOF_MODE: 'pro' }, () => assert.equal(currentMode(), 'pro'));
});

test('normal: with no mode env set at all, currentMode() defaults to normal', () => {
  withEnv({}, () => assert.equal(currentMode(), 'normal'));
});

test('invalid: an explicit COAGENTIX_ALLOW_MOCK=0 wins even on a bare dev environment', () => {
  withEnv({ COAGENTIX_ALLOW_MOCK: '0' }, () => {
    assert.equal(mockAllowed(), false);
  });
});

test('security: mock is OFF on a hosting platform (Vercel) even when NODE_ENV was left unset', () => {
  withEnv({ VERCEL: '1' }, () => {
    assert.equal(mockAllowed(), false, 'a forgotten NODE_ENV must never let fabricated mock answers reach real users');
  });
});

test('security: mock is OFF on Render too, and an explicit flag still overrides it', () => {
  withEnv({ RENDER: 'true' }, () => {
    assert.equal(mockAllowed(), false);
  });
  withEnv({ RENDER: 'true', COAGENTIX_ALLOW_MOCK: '1' }, () => {
    assert.equal(mockAllowed(), true, 'explicit flag always wins, even on a hosting platform');
  });
});

test('normal: mock is ON in a bare local/dev environment with no platform marker', () => {
  withEnv({}, () => {
    assert.equal(mockAllowed(), true);
  });
});
