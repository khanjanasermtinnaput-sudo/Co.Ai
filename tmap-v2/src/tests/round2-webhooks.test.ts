// Round 2 #7 — durable webhook persistence + delivery tracking / DLQ.
//
// Proves subscriptions survive a "reload" (persisted to the backing store, not
// per-process memory) and that delivery outcomes — including dead-letter after
// retry exhaustion — are recorded. Tested against the file backend (no Supabase
// configured); the Supabase path mirrors the proven developer-keys dual-store.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('Round 2 #7 — durable webhooks', () => {
  let dir: string;
  let webhooks: typeof import('../server/webhooks.js');
  let crypto: typeof import('../server/crypto.js');

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cgntx-wh-'));
    process.env.WEBHOOKS_DIR = dir;
    process.env.COAGENTIX_MASTER_KEY = 'round2-webhook-test-master-key!!';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VERCEL;
    webhooks = await import('../server/webhooks.js');
    crypto = await import('../server/crypto.js');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.WEBHOOKS_DIR;
    delete process.env.COAGENTIX_MASTER_KEY;
  });

  test('register persists to the durable store and returns the secret once', async () => {
    const { webhook, secret } = await webhooks.registerWebhook('user-1', 'https://example.com/hook', ['sandbox.completed']);
    assert.ok(secret.startsWith('whsec_'));
    assert.equal(webhook.encryptedSecret, '[redacted]');
    // Persisted to disk (survives a redeploy/cold start when the dir is durable).
    const file = join(dir, 'user-1.json');
    assert.ok(existsSync(file), 'webhook file written');
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].url, 'https://example.com/hook');
    assert.notEqual(onDisk[0].encryptedSecret, secret); // stored encrypted, not raw
  });

  test('list returns active webhooks with the secret redacted', async () => {
    await webhooks.registerWebhook('user-2', 'https://example.com/a', ['*']);
    const list = await webhooks.listWebhooks('user-2');
    assert.equal(list.length, 1);
    assert.equal(list[0].encryptedSecret, '[redacted]');
  });

  test('delete deactivates the webhook (no longer listed)', async () => {
    const { webhook } = await webhooks.registerWebhook('user-3', 'https://example.com/b', ['*']);
    await webhooks.deleteWebhook('user-3', webhook.id);
    const list = await webhooks.listWebhooks('user-3');
    assert.equal(list.length, 0);
  });

  test('SSRF: private/loopback/non-HTTPS URLs are rejected at registration', async () => {
    await assert.rejects(() => webhooks.registerWebhook('u', 'http://example.com', ['*']), /HTTPS/);
    await assert.rejects(() => webhooks.registerWebhook('u', 'https://127.0.0.1/x', ['*']), /private IP/);
    await assert.rejects(() => webhooks.registerWebhook('u', 'https://10.0.0.5/x', ['*']), /private IP/);
    await assert.rejects(() => webhooks.registerWebhook('u', 'https://localhost/x', ['*']), /private IP/);
  });

  test('delivery to an unreachable host after retry exhaustion is dead-lettered', async () => {
    const enc = crypto.encryptSecret('whsec_dummy');
    await webhooks.deliverWebhook({
      webhookId: randomUUID(),
      userId: 'user-dlq',
      url: 'https://nonexistent.invalid/hook',
      encryptedSecret: enc,
      event: 'sandbox.completed',
      body: { x: 1 },
      attempt: 3, // == MAX_RETRIES → goes straight to the dead-letter branch
    });
    const recs = webhooks.readDeliveries('user-dlq');
    assert.ok(recs.some((r) => r.status === 'dead'), 'a dead-letter record was written');
  });

  test('SSRF re-check blocks delivery to a private URL (no record, no fetch)', async () => {
    await webhooks.deliverWebhook({
      webhookId: randomUUID(),
      userId: 'user-ssrf',
      url: 'https://192.168.0.10/hook',
      encryptedSecret: crypto.encryptSecret('whsec_x'),
      event: 'sandbox.completed',
      body: {},
      attempt: 1,
    });
    // Blocked before any delivery attempt → no delivery record.
    assert.equal(webhooks.readDeliveries('user-ssrf').length, 0);
  });
});
