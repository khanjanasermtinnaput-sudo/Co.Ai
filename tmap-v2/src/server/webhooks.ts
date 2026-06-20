// Webhook notification system — lets integrators subscribe to Coagentix events
// and receive HTTP POST deliveries with HMAC-SHA256 signatures.
//
// Security:
//   • Webhook URLs must be HTTPS to prevent interception on delivery.
//   • Each delivery is signed: X-Coagentix-Signature: sha256=HEX
//     Receivers verify: HMAC-SHA256(rawBody, webhookSecret) === signature.
//   • Secret is stored AES-256-GCM encrypted (same scheme as provider keys).
//     The prefix (first 14 chars) is stored in plain for display only.
//   • Retry: up to 3 attempts with exponential back-off (5 s, 25 s, 125 s).
//   • Delivery timeout: 10 s per attempt.
//   • SSRF: only https:// URLs on non-private IP ranges are accepted.
//     Re-checked at delivery time to prevent DNS rebinding attacks.

import { randomBytes, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';
import { encryptSecret, decryptSecret } from './crypto.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'sandbox.completed'
  | 'sandbox.failed'
  | 'session.completed'
  | 'quota.exceeded'
  | 'key.rotated'
  | '*';

export interface Webhook {
  id:              string;
  userId:          string;
  url:             string;
  events:          WebhookEvent[];
  encryptedSecret: string;  // AES-256-GCM ciphertext — never expose the raw secret
  prefix:          string;  // First 14 chars for display (whsec_XXXXXXX)
  active:          boolean;
  createdAt:       string;
  lastDelivery?:   string | null;
  failureCount:    number;
}

export interface RegisterWebhookResult {
  webhook: Webhook;
  secret:  string;  // Raw secret — shown ONCE, never stored in plain
}

export interface WebhookDeliveryPayload {
  webhookId:       string;
  url:             string;
  encryptedSecret: string;
  event:           WebhookEvent;
  body:            Record<string, unknown>;
  attempt?:        number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_WEBHOOKS_PER_USER = 20;
const MAX_RETRIES           = 3;
const RETRY_BASE_MS         = 5_000;
const DELIVERY_TIMEOUT_MS   = 10_000;
const VALID_EVENTS = new Set<WebhookEvent>([
  'sandbox.completed', 'sandbox.failed', 'session.completed',
  'quota.exceeded', 'key.rotated', '*',
]);

// Private IP ranges — SSRF protection (checked at registration AND delivery)
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|fd[0-9a-f]{2}:)/i;
const LOOPBACK_HOSTNAME_RE = /^(localhost|0\.0\.0\.0)$/i;

// ── Storage ───────────────────────────────────────────────────────────────────

const WEBHOOKS_DIR = process.env.WEBHOOKS_DIR
  ?? (process.env.VERCEL ? '/tmp/coagentix-webhooks' : join(process.cwd(), '.aof-server', 'webhooks'));
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function webhooksFile(userId: string): string {
  return join(WEBHOOKS_DIR, `${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function loadWebhooks(userId: string): Webhook[] {
  const path = webhooksFile(userId);
  if (!existsSync(path)) return [];
  try {
    const hooks = JSON.parse(readFileSync(path, 'utf8')) as Webhook[];
    // Guard: only return hooks that belong to this userId
    return hooks.filter((h) => h.userId === userId);
  } catch { return []; }
}

function saveWebhooks(userId: string, hooks: Webhook[]): void {
  const path = webhooksFile(userId);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(hooks, null, 2), { encoding: 'utf8', mode: 0o600 });
}

// ── URL validation (SSRF protection — applied at both registration and delivery) ─

export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error('Invalid webhook URL'); }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }

  if (LOOPBACK_HOSTNAME_RE.test(parsed.hostname)) {
    throw new Error('Webhook URL hostname resolves to a private IP range');
  }

  if (PRIVATE_IP_RE.test(parsed.hostname)) {
    throw new Error('Webhook URL hostname resolves to a private IP range');
  }
}

// ── HMAC signing ──────────────────────────────────────────────────────────────

function signPayload(body: string, rawSecret: string): string {
  return 'sha256=' + createHmac('sha256', rawSecret).update(body, 'utf8').digest('hex');
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listWebhooks(userId: string): Promise<Webhook[]> {
  // Strip encryptedSecret before returning — callers never need it
  return loadWebhooks(userId)
    .filter((h) => h.active)
    .map((h) => ({ ...h, encryptedSecret: '[redacted]' }));
}

export async function registerWebhook(
  userId: string,
  url: string,
  events: WebhookEvent[],
): Promise<RegisterWebhookResult> {
  validateWebhookUrl(url);

  const validEvents = events.filter((e) => VALID_EVENTS.has(e));
  if (validEvents.length === 0) {
    throw new Error(`No valid events. Allowed: ${[...VALID_EVENTS].join(', ')}`);
  }

  const existing = loadWebhooks(userId).filter((h) => h.active);
  if (existing.length >= MAX_WEBHOOKS_PER_USER) {
    throw new Error(`Maximum ${MAX_WEBHOOKS_PER_USER} webhooks per user`);
  }

  const secret          = 'whsec_' + randomBytes(32).toString('base64url');
  const encryptedSecret = encryptSecret(secret);

  const webhook: Webhook = {
    id:              randomUUID(),
    userId,
    url,
    events:          validEvents,
    encryptedSecret,
    prefix:          secret.slice(0, 14),
    active:          true,
    createdAt:       new Date().toISOString(),
    lastDelivery:    null,
    failureCount:    0,
  };

  const hooks = loadWebhooks(userId);
  hooks.push(webhook);
  saveWebhooks(userId, hooks);

  logger.info('webhook_registered', { userId, webhookId: webhook.id, url, events: validEvents });
  // Return the public view (redacted) plus the raw secret shown once
  return { webhook: { ...webhook, encryptedSecret: '[redacted]' }, secret };
}

export async function deleteWebhook(userId: string, webhookId: string): Promise<void> {
  const hooks = loadWebhooks(userId);
  const idx   = hooks.findIndex((h) => h.id === webhookId && h.userId === userId);
  if (idx === -1) throw new Error('Webhook not found');
  hooks[idx].active = false;
  saveWebhooks(userId, hooks);
  logger.info('webhook_deleted', { userId, webhookId });
}

/** Deliver a webhook event with retry.  Called by the queue worker. */
export async function deliverWebhook(payload: WebhookDeliveryPayload): Promise<void> {
  const { webhookId, url, encryptedSecret, event, body } = payload;
  const attempt = payload.attempt ?? 1;

  // Re-validate URL at delivery time to prevent DNS rebinding attacks.
  try { validateWebhookUrl(url); }
  catch (e) {
    logger.error('webhook_delivery_ssrf_blocked', { webhookId, url, error: (e as Error).message });
    return;
  }

  // Decrypt the raw secret for signing
  let rawSecret: string;
  try { rawSecret = decryptSecret(encryptedSecret); }
  catch (e) {
    logger.error('webhook_delivery_decrypt_failed', { webhookId, error: (e as Error).message });
    return;
  }

  const bodyStr  = JSON.stringify({ event, ts: new Date().toISOString(), data: body });
  const signature = signPayload(bodyStr, rawSecret);

  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Coagentix-Signature':  signature,
        'X-Coagentix-Event':      event,
        'X-Coagentix-Webhook-Id': webhookId,
        'User-Agent':             'Coagentix-Webhook/1.0',
      },
      body:   bodyStr,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    logger.info('webhook_delivered', { webhookId, url, event, attempt });
  } catch (e) {
    logger.warn('webhook_delivery_failed', { webhookId, url, event, attempt, error: (e as Error).message });

    if (attempt < MAX_RETRIES) {
      const delayMs = RETRY_BASE_MS * Math.pow(5, attempt - 1);
      const { enqueueJob } = await import('./queue.js');
      await enqueueJob({
        name: 'webhook.deliver',
        data: { ...payload, attempt: attempt + 1 },
        opts: { delay: delayMs },
      });
    } else {
      logger.error('webhook_delivery_exhausted', { webhookId, url, event });
    }
  }
}

/** Dispatch an event to all matching webhooks for a user. */
export async function dispatchEvent(
  userId: string,
  event: WebhookEvent,
  body: Record<string, unknown>,
): Promise<void> {
  const hooks = loadWebhooks(userId).filter(
    (h) => h.active && (h.events.includes('*') || h.events.includes(event)),
  );
  if (hooks.length === 0) return;

  // Reload with unredacted secrets for dispatch
  const rawHooks = loadWebhooks(userId).filter(
    (h) => h.active && (h.events.includes('*') || h.events.includes(event)),
  );

  const { enqueueJob } = await import('./queue.js');
  await Promise.all(
    rawHooks.map((h) =>
      enqueueJob({
        name: 'webhook.deliver',
        data: {
          webhookId:       h.id,
          url:             h.url,
          encryptedSecret: h.encryptedSecret,
          event,
          body,
          attempt:         1,
        },
      }).catch((err: Error) => {
        logger.error('webhook_enqueue_failed', { webhookId: h.id, error: err.message });
      }),
    ),
  );
}
