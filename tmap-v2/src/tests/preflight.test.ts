// P4/P5 — production startup gate. Redis + durable DB are hard requirements
// (with explicit overrides). assessPreflight is pure, so we test it directly
// against synthetic environment bags (no server boot, no process.exit).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessPreflight } from '../server/preflight.js';

const GOOD_SECRETS = {
  JWT_SECRET: 'x'.repeat(32),
  COAGENTIX_MASTER_KEY: 'y'.repeat(32),
};

test('fully configured production env has no problems', () => {
  const { problems } = assessPreflight({
    ...GOOD_SECRETS,
    SUPABASE_URL: 'https://p.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    REDIS_URL: 'redis://localhost:6379',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(problems, []);
});

test('missing Redis is flagged (P4)', () => {
  const { problems } = assessPreflight({
    ...GOOD_SECRETS,
    SUPABASE_URL: 'https://p.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
  } as NodeJS.ProcessEnv);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /No Redis/);
});

test('missing durable DB is flagged (P5)', () => {
  const { problems } = assessPreflight({
    ...GOOD_SECRETS,
    REDIS_URL: 'redis://localhost:6379',
  } as NodeJS.ProcessEnv);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /durable storage/);
});

test('REDIS_HOST satisfies the Redis requirement', () => {
  const { problems } = assessPreflight({
    ...GOOD_SECRETS,
    SUPABASE_URL: 'https://p.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    REDIS_HOST: 'cache.internal',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(problems, []);
});

test('explicit overrides silence DB + Redis requirements', () => {
  const { problems } = assessPreflight({
    ...GOOD_SECRETS,
    COAGENTIX_ALLOW_EPHEMERAL_DB: '1',
    COAGENTIX_ALLOW_NO_REDIS: 'true',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(problems, []);
});

test('weak/short secrets are flagged', () => {
  const { problems } = assessPreflight({
    JWT_SECRET: 'short',
    SUPABASE_URL: 'https://p.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    REDIS_URL: 'redis://localhost:6379',
  } as NodeJS.ProcessEnv);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /JWT_SECRET/);
  assert.match(problems[0], /COAGENTIX_MASTER_KEY/);
});
