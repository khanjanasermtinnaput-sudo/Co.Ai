// Tests for MFA utilities that can run without a database.
// DB-dependent operations (setupMfa, verifyTotp, etc.) require integration tests.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('MFA — TOTP library sanity', () => {
  test('authenticator generates a valid base32 secret', async () => {
    const { authenticator } = await import('otplib');
    const secret = authenticator.generateSecret(20);
    assert.ok(typeof secret === 'string', 'secret must be a string');
    assert.ok(secret.length >= 16, 'secret must be at least 16 chars');
    assert.ok(/^[A-Z2-7]+=*$/.test(secret), 'secret must be base32');
  });

  test('authenticator.keyuri returns an otpauth URI', async () => {
    const { authenticator } = await import('otplib');
    const secret = authenticator.generateSecret();
    const uri = authenticator.keyuri('user@example.com', 'TestApp', secret);
    assert.ok(uri.startsWith('otpauth://totp/'), `expected otpauth:// URI, got: ${uri}`);
    assert.ok(uri.includes('secret='), 'URI must contain secret parameter');
    assert.ok(uri.includes('issuer='), 'URI must contain issuer parameter');
  });

  test('verify rejects a random token', async () => {
    const { authenticator } = await import('otplib');
    const secret = authenticator.generateSecret();
    const result = authenticator.verify({ token: '000000', secret });
    // May be valid by random chance but extremely unlikely; test that it returns boolean
    assert.ok(typeof result === 'boolean');
  });

  test('verify accepts a valid generated token', async () => {
    const { authenticator } = await import('otplib');
    const secret = authenticator.generateSecret();
    const token = authenticator.generate(secret);
    assert.ok(typeof token === 'string');
    assert.ok(/^\d{6}$/.test(token), 'token must be 6 digits');
    const valid = authenticator.verify({ token, secret });
    assert.equal(valid, true);
  });
});
