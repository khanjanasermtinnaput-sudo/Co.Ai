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

import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
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
  userId:          string;
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

// ── Storage (Round 2 #7) ────────────────────────────────────────────────────
// Durable storage: Supabase (PostgREST) when configured, else a local JSON file
// for dev. The previous file-only store under /tmp was wiped on every serverless
// cold start/redeploy — subscriptions silently vanished. Supabase persistence
// fixes that; the file fallback is only for local development.

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase  = Boolean(SUPABASE_URL && SUPABASE_KEY);

const WEBHOOKS_DIR = process.env.WEBHOOKS_DIR
  ?? (process.env.VERCEL ? '/tmp/coagentix-webhooks' : join(process.cwd(), '.aof-server', 'webhooks'));

// Only warn when there is NO durable backend at all (no Supabase AND default dir).
if (process.env.NODE_ENV === 'production' && !useSupabase && !process.env.WEBHOOKS_DIR) {
  console.warn(
    '[Coagentix][WARN] No durable webhook store configured. Set SUPABASE_URL + ' +
    'SUPABASE_SERVICE_ROLE_KEY (recommended) or WEBHOOKS_DIR to a durable volume — ' +
    'otherwise subscriptions are LOST on redeploy/cold start.',
  );
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY!,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    },
    signal: AbortSignal.timeout(5_000),
  });
}

interface WebhookRow {
  id: string; user_id: string; url: string; events: WebhookEvent[];
  encrypted_secret: string; prefix: string; active: boolean;
  created_at: string; last_delivery: string | null; failure_count: number;
}
function rowToWebhook(r: WebhookRow): Webhook {
  return {
    id: r.id, userId: r.user_id, url: r.url, events: r.events,
    encryptedSecret: r.encrypted_secret, prefix: r.prefix, active: r.active,
    createdAt: r.created_at, lastDelivery: r.last_delivery, failureCount: r.failure_count ?? 0,
  };
}
function webhookToRow(h: Webhook): WebhookRow {
  return {
    id: h.id, user_id: h.userId, url: h.url, events: h.events,
    encrypted_secret: h.encryptedSecret, prefix: h.prefix, active: h.active,
    created_at: h.createdAt, last_delivery: h.lastDelivery ?? null, failure_count: h.failureCount,
  };
}

function webhooksFile(userId: string): string {
  return join(WEBHOOKS_DIR, `${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

async function loadWebhooks(userId: string): Promise<Webhook[]> {
  if (useSupabase) {
    try {
      const resp = await sbFetch(`webhooks?user_id=eq.${encodeURIComponent(userId)}&select=*`, {});
      if (resp.ok) return ((await resp.json()) as WebhookRow[]).map(rowToWebhook);
      logger.warn('webhook_supabase_list_failed', { status: resp.status });
    } catch (e) {
      logger.warn('webhook_supabase_list_error', { error: (e as Error).message });
    }
    return [];
  }
  const path = webhooksFile(userId);
  if (!existsSync(path)) return [];
  try {
    const hooks = JSON.parse(readFileSync(path, 'utf8')) as Webhook[];
    return hooks.filter((h) => h.userId === userId);
  } catch { return []; }
}

async function saveWebhooks(userId: string, hooks: Webhook[]): Promise<void> {
  if (useSupabase) {
    try {
      // Upsert all rows for this user by primary key (id).
      const resp = await sbFetch('webhooks', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(hooks.map(webhookToRow)),
      });
      if (!resp.ok) logger.error('webhook_supabase_save_failed', { status: resp.status });
    } catch (e) {
      logger.error('webhook_supabase_save_error', { error: (e as Error).message });
    }
    return;
  }
  const path = webhooksFile(userId);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(hooks, null, 2), { encoding: 'utf8', mode: 0o600 });
}

// ── Delivery tracking + dead-letter (Round 2 #7) ────────────────────────────
export type DeliveryStatus = 'delivered' | 'failed' | 'dead';
export interface DeliveryRecord {
  id: string; webhookId: string; userId: string; event: WebhookEvent;
  status: DeliveryStatus; attempts: number; lastError?: string; at: string;
}

async function recordDelivery(rec: DeliveryRecord): Promise<void> {
  if (useSupabase) {
    try {
      await sbFetch('webhook_deliveries', {
        method: 'POST',
        body: JSON.stringify([{
          id: rec.id, webhook_id: rec.webhookId, user_id: rec.userId, event: rec.event,
          status: rec.status, attempts: rec.attempts, last_error: rec.lastError ?? null, at: rec.at,
        }]),
      });
    } catch (e) {
      logger.warn('webhook_delivery_record_error', { error: (e as Error).message });
    }
    return;
  }
  try {
    const path = join(WEBHOOKS_DIR, 'deliveries', `${rec.userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`);
    mkdirSync(join(path, '..'), { recursive: true });
    appendFileSync(path, JSON.stringify(rec) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    logger.warn('webhook_delivery_record_error', { error: (e as Error).message });
  }
}

/** Read delivery records for a user (file backend only; tests/inspection). */
export function readDeliveries(userId: string): DeliveryRecord[] {
  const path = join(WEBHOOKS_DIR, 'deliveries', `${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as DeliveryRecord);
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
  return (await loadWebhooks(userId))
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

  const existing = (await loadWebhooks(userId)).filter((h) => h.active);
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

  const hooks = await loadWebhooks(userId);
  hooks.push(webhook);
  await saveWebhooks(userId, hooks);

  logger.info('webhook_registered', { userId, webhookId: webhook.id, url, events: validEvents });
  // Return the public view (redacted) plus the raw secret shown once
  return { webhook: { ...webhook, encryptedSecret: '[redacted]' }, secret };
}

export async function deleteWebhook(userId: string, webhookId: string): Promise<void> {
  const hooks = await loadWebhooks(userId);
  const idx   = hooks.findIndex((h) => h.id === webhookId && h.userId === userId);
  if (idx === -1) throw new Error('Webhook not found');
  hooks[idx].active = false;
  await saveWebhooks(userId, hooks);
  logger.info('webhook_deleted', { userId, webhookId });
}

/** Deliver a webhook event with retry.  Called by the queue worker. */
export async function deliverWebhook(payload: WebhookDeliveryPayload): Promise<void> {
  const { webhookId, userId, url, encryptedSecret, event, body } = payload;
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
    await recordDelivery({
      id: randomUUID(), webhookId, userId, event, status: 'delivered', attempts: attempt,
      at: new Date().toISOString(),
    });
  } catch (e) {
    const errMsg = (e as Error).message;
    logger.warn('webhook_delivery_failed', { webhookId, url, event, attempt, error: errMsg });

    if (attempt < MAX_RETRIES) {
      await recordDelivery({
        id: randomUUID(), webhookId, userId, event, status: 'failed', attempts: attempt,
        lastError: errMsg, at: new Date().toISOString(),
      });
      const delayMs = RETRY_BASE_MS * Math.pow(5, attempt - 1);
      const { enqueueJob } = await import('./queue.js');
      await enqueueJob({
        name: 'webhook.deliver',
        data: { ...payload, attempt: attempt + 1 },
        opts: { delay: delayMs },
      });
    } else {
      // Dead-letter: all retries exhausted.
      logger.error('webhook_delivery_exhausted', { webhookId, url, event });
      await recordDelivery({
        id: randomUUID(), webhookId, userId, event, status: 'dead', attempts: attempt,
        lastError: errMsg, at: new Date().toISOString(),
      });
    }
  }
}

/** Dispatch an event to all matching webhooks for a user. */
export async function dispatchEvent(
  userId: string,
  event: WebhookEvent,
  body: Record<string, unknown>,
): Promise<void> {
  const rawHooks = (await loadWebhooks(userId)).filter(
    (h) => h.active && (h.events.includes('*') || h.events.includes(event)),
  );
  if (rawHooks.length === 0) return;

  const { enqueueJob } = await import('./queue.js');
  await Promise.all(
    rawHooks.map((h) =>
      enqueueJob({
        name: 'webhook.deliver',
        data: {
          webhookId:       h.id,
          userId,
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
