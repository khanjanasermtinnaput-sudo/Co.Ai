import 'dotenv/config';
import './telemetry.js'; // must load before express to patch HTTP instrumentation
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hashPassword, verifyPassword, encryptSecret, decryptSecret, maskKey } from './crypto.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import {
  createUser, findUserByUsername, setUserKey, deleteUserKey,
  createSession, updateSession, getUserSessions, getSession, getSessionLogs,
  addCost, getUserCost, appendAgentLog,
  type ProviderKeyName,
} from './db.js';
import { checkLoginRate, recordFailure, recordSuccess } from './rateLimit.js';
import { logger, incRequest, incError, incTmapRun, incTmapError, addTokens, incAgentCall, getMetrics, incEvaluation, incSandboxRun, incQuotaViolation, incKeyRotation, incKeyValidation, incTeamOperation, incOrgOperation, incBackupCreated, incRestoreRun, incAnalyticsEvent } from './logger.js';
import { runInSandbox, SUPPORTED_LANGUAGES, SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS, SANDBOX_DEFAULT_MAX_BYTES } from '../core/sandbox.js';
import { isDockerAvailable, runInDockerSandbox, DOCKER_DEFAULT_TIMEOUT_MS, DOCKER_MAX_TIMEOUT_MS } from '../core/docker-sandbox.js';
import { checkQuota, checkSandboxQuota, recordUsage, recordSandboxRun, getUsageSummary, DEFAULT_QUOTA } from '../core/usage-tracker.js';
import type { SandboxLanguage, SandboxOptions } from '../types.js';
import {
  listDevKeys, createDevKey, revokeDevKey, authenticateDevKey, hasScope,
  type DevKeyScope,
} from './developer-keys.js';
import {
  listWebhooks, registerWebhook, deleteWebhook, dispatchEvent,
  type WebhookEvent,
} from './webhooks.js';
import { globalRoutingMetrics } from '../core/routing-metrics.js';
import { evaluateOutput } from '../core/eval-framework.js';
import type { Blackboard, CodeFile } from '../types.js';
import { bagHasAnyKey, resolveAllWith, ROLE_PROVIDER, type CredentialBag } from '../config.js';
import { createBlackboard } from '../core/blackboard.js';
import { runTMAP } from '../core/orchestrator.js';
import { runRAA } from '../core/raa.js';
import { runTitan } from '../core/titan.js';
import { runDebugger } from '../core/debugger.js';
import { runAnalyzer } from '../core/analyze.js';
import { loadMemory, memoryToContext, recordSessionMemory, recordDecision, clearMemory } from '../core/memory.js';
import { currentMode } from '../config.js';
import type { Mode, ChatMessage } from '../types.js';
import { runChiefAgent } from '../core/chief-agent.js';
import { chatWithDARS } from '../dars/run.js';
import { globalHealth } from '../dars/health.js';
import { runImagePipeline, processImage, type ImageUnderstanding } from '../core/image-pipeline.js';
import {
  toRecord, storeImageMemory, findImageByHash, listImageMemories,
  searchImageMemories, imageMemoriesToContext, clearImageMemories, purgeExpiredImageMemories,
} from '../core/image-memory.js';
import { handleCliAuth, handleCliStatus } from './cli-auth.js';
import { correlationMiddleware } from './correlation.js';
import { prometheusMiddleware, registry } from './prometheus.js';
import { buildHealthReport } from './health.js';
import { botProtectionMiddleware } from './bot-protection.js';
import { rateLimitMiddleware } from './rate-limit-redis.js';
import { logAuditEvent, AuditAction, getClientIp } from './audit.js';
import { SentryNode } from './telemetry.js';

const PROVIDERS: ProviderKeyName[] = ['openrouter', 'gemini', 'deepseek', 'qwen', 'llama'];

const app = express();

// ── SECURITY HEADERS middleware ───────────────────────────────────────────────
// Hardened response headers (equivalent to helmet defaults) — applied before
// any route so every response inherits them, including error responses.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // Content-Security-Policy: API-only server; no inline scripts/styles needed.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// ── CORS middleware ───────────────────────────────────────────────────────────
// Restrict CORS to known client origins; the wildcard default lets any site
// send requests with a stolen token.
const ALLOWED_ORIGINS = (process.env.COAGENTIX_ALLOWED_ORIGINS ?? process.env.AOF_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / non-browser calls (e.g. server-to-server, curl).
    if (!origin) return cb(null, true);
    // Allow any configured origin, or localhost in development.
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      process.env.NODE_ENV !== 'production' ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) return cb(null, true);
    cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
  credentials: true,
}));
// Image uploads (base64) need a larger limit than ordinary JSON requests; keep
// every other route capped at 1mb to limit memory-exhaustion surface.
const jsonParser = express.json({ limit: '1mb' });
const imageJsonParser = express.json({ limit: process.env.IMAGE_JSON_LIMIT || '14mb' });
app.use((req, res, next) =>
  (req.path === '/v1/image/analyze' ? imageJsonParser : jsonParser)(req, res, next));

// ── CORRELATION IDs ───────────────────────────────────────────────────────────
// Injects X-Correlation-ID / X-Request-ID into AsyncLocalStorage so every log
// line emitted during a request automatically includes them.
app.use(correlationMiddleware());

// ── PROMETHEUS metrics ────────────────────────────────────────────────────────
app.use(prometheusMiddleware());

// ── BOT PROTECTION ────────────────────────────────────────────────────────────
// Score-based UA heuristics; skip health + metrics (server-to-server callers).
app.use(botProtectionMiddleware({ skipPaths: /^\/(v1\/health|v1\/metrics)/ }));

// ── REDIS RATE LIMITING ───────────────────────────────────────────────────────
// Global IP-based sliding window — 120 req/min per IP for all /v1/ routes.
// Auth routes get a tighter 10 req/min limit applied below.
app.use('/v1/', rateLimitMiddleware(120, 60, 'global'));

// ── REQUEST LOGGING middleware ────────────────────────────────────────────────
app.use((req, _res, next) => {
  incRequest();
  logger.info('request', { method: req.method, path: req.path, ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim() });
  next();
});

// ── VALIDATION helpers ─────────────────────────────────────────────────────────
function validUsername(u: unknown): u is string {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{2,32}$/.test(u.trim());
}
function validPin(p: unknown): p is string {
  return typeof p === 'string' && /^\d{4,8}$/.test(String(p).trim());
}

// Max byte lengths for free-text user inputs to prevent memory-exhaustion DoS.
const MAX_TASK    = 10_000;
const MAX_MESSAGE = 10_000;
const MAX_CODE    = 50_000;  // code files are larger, keep a generous limit
const MAX_CONTEXT = 20_000;
const MAX_BRIEF   = 10_000;

function tooLong(value: string, limit: number): boolean {
  return Buffer.byteLength(value, 'utf8') > limit;
}

// Tighter rate limit on auth endpoints (10/min per IP)
app.use('/v1/auth/', rateLimitMiddleware(10, 60, 'auth'));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/v1/auth/register', async (req, res) => {
  try {
    const { username, pin } = req.body ?? {};
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็นตัวอักษร/ตัวเลข 2-32 ตัว' });
    }
    if (!validPin(pin)) {
      return res.status(400).json({ error: 'PIN ต้องเป็นตัวเลข 4-8 หลัก' });
    }
    if (await findUserByUsername(username)) {
      return res.status(409).json({ error: 'ชื่อนี้ถูกใช้แล้ว' });
    }
    const user = await createUser(username.trim(), hashPassword(String(pin).trim()));
    return res.json({ token: signToken(user.id), username: user.username });
  } catch (e) {
    logger.error('register_error', { error: (e as Error).message });
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

app.post('/v1/auth/login', async (req, res) => {
  try {
    const { username, pin } = req.body ?? {};
    const clientIp = String(
      req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown',
    ).split(',')[0].trim();

    const uname = username ? String(username).trim() : '';
    if (uname) {
      const check = checkLoginRate(uname, clientIp);
      if (check.blocked) {
        const mins = Math.ceil(check.retryAfterSec / 60);
        res.setHeader('Retry-After', check.retryAfterSec);
        return res.status(429).json({
          error: `ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ ${mins} นาทีแล้วลองใหม่`,
          retryAfterSec: check.retryAfterSec,
        });
      }
    }

    const user = uname ? await findUserByUsername(uname) : undefined;
    // Always call verifyPassword (even when user not found) to prevent timing
    // side-channel attacks that reveal whether a username exists.
    const DUMMY_HASH = 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128);
    const pinMatch = verifyPassword(String(pin ?? '').trim(), user?.pinHash ?? DUMMY_HASH);
    if (!user || !pinMatch) {
      if (uname) {
        const info = recordFailure(uname, clientIp);
        await logAuditEvent({
          actorId: user?.id ?? null, actorIp: clientIp, action: AuditAction.AUTH_FAILED,
          outcome: 'failure', severity: 'warn',
          metadata: { username: uname, blocked: info.blocked },
          userAgent: req.headers['user-agent'] as string,
        });
        const detail = info.blocked
          ? ` — ลองผิดเกินกำหนด บัญชีถูกล็อก ${Math.ceil(info.retryAfterSec / 60)} นาที`
          : info.remaining > 0
            ? ` (เหลือ ${info.remaining} ครั้ง)`
            : '';
        return res.status(401).json({ error: `ชื่อหรือ PIN ไม่ถูกต้อง${detail}` });
      }
      return res.status(401).json({ error: 'ชื่อหรือ PIN ไม่ถูกต้อง' });
    }

    recordSuccess(uname, clientIp);
    await logAuditEvent({
      actorId: user.id, actorIp: clientIp, action: AuditAction.AUTH_LOGIN,
      outcome: 'success', userAgent: req.headers['user-agent'] as string,
    });
    return res.json({ token: signToken(user.id), username: user.username });
  } catch (e) {
    logger.error('login_error', { error: (e as Error).message });
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// Exchange a still-valid token for a fresh one (sliding session). Keeps the
// short 7-day TTL from forcing a re-login while the user is active.
app.post('/v1/auth/refresh', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  res.json({ token: signToken(u.id), username: u.username });
});

// ── ACCOUNT + KEYS ────────────────────────────────────────────────────────────
app.get('/v1/me', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => [p, u.encryptedKeys[p] ? maskKey(decryptSecret(u.encryptedKeys[p]!)) : null]),
  );
  res.json({ username: u.username, keys });
});

app.put('/v1/me/keys', requireAuth, async (req: AuthedRequest, res) => {
  const { provider, key } = req.body ?? {};
  if (!PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider ต้องเป็นหนึ่งใน ${PROVIDERS.join(', ')}` });
  }
  if (!key || String(key).trim().length < 8) {
    return res.status(400).json({ error: 'key ดูไม่ถูกต้อง' });
  }
  await setUserKey(req.user!.id, provider, encryptSecret(String(key).trim()));
  res.json({ ok: true, provider, masked: maskKey(String(key).trim()) });
});

app.delete('/v1/me/keys/:provider', requireAuth, async (req: AuthedRequest, res) => {
  const provider = req.params.provider as ProviderKeyName;
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'unknown provider' });
  await deleteUserKey(req.user!.id, provider);
  res.json({ ok: true });
});

// ── SESSIONS ─────────────────────────────────────────────────────────────────
app.get('/v1/sessions', requireAuth, async (req: AuthedRequest, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const sessions = await getUserSessions(req.user!.id, limit);
  res.json({ sessions });
});

app.get('/v1/sessions/:id', requireAuth, async (req: AuthedRequest, res) => {
  const session = await getSession(req.params.id);
  if (!session || session.userId !== req.user!.id) {
    return res.status(404).json({ error: 'session not found' });
  }
  const logs = await getSessionLogs(req.params.id);
  res.json({ session, logs });
});

// ── COST TRACKING ─────────────────────────────────────────────────────────────
app.get('/v1/me/cost', requireAuth, async (req: AuthedRequest, res) => {
  const cost = await getUserCost(req.user!.id);
  res.json(cost ?? { userId: req.user!.id, totalCostUsd: 0, totalTokens: 0, sessionCount: 0 });
});

// ── AGENTS — active role → provider/model mapping ────────────────────────────
app.get('/v1/agents', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }
  const resolved = resolveAllWith(creds);
  const healthSnap = globalHealth.snapshot();
  const healthByKey = Object.fromEntries(healthSnap.map((h) => [h.key, h]));
  const agents = Object.entries(resolved).map(([role, r]) => {
    const providerKey = ROLE_PROVIDER[role as keyof typeof ROLE_PROVIDER];
    const h = healthByKey[providerKey];
    return {
      role,
      providerName: r.providerName,
      model: r.model,
      mode: r.mode,
      circuit: h?.circuit ?? 'closed',
      latencyMs: Math.round(h?.ewmaLatencyMs ?? 1500),
    };
  });
  res.json({ agents, darsHealth: healthSnap });
});

// ── PROJECT MEMORY ────────────────────────────────────────────────────────────
app.get('/v1/memory', requireAuth, async (req: AuthedRequest, res) => {
  res.json(await loadMemory(req.user!.id));
});

app.delete('/v1/memory', requireAuth, async (req: AuthedRequest, res) => {
  await clearMemory(req.user!.id);
  res.json({ ok: true });
});

// ── IMAGE UNDERSTANDING (TMAP vision pipeline) ────────────────────────────────
// Upload an image → OCR + vision analysis + summarization → stored as reusable
// memory so future questions are answered without re-reading it. Deduped by hash.
app.post('/v1/image/analyze', requireAuth, async (req: AuthedRequest, res) => {
  const data = String(req.body?.image ?? req.body?.data ?? '');
  const question = String(req.body?.question ?? req.body?.hint ?? '').trim();
  if (!data) return res.status(400).json({ error: 'image (base64 or data URL) required' });
  if (question && tooLong(question, MAX_MESSAGE)) {
    return res.status(413).json({ error: `question too long (max ${MAX_MESSAGE} bytes)` });
  }

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  const steps: string[] = [];
  try {
    // Step 1 (cheap, no tokens): process + hash, then check for a duplicate.
    const processed = processImage({ data });
    const existing = await findImageByHash(u.id, processed.imageHash);
    if (existing) {
      logger.info('image_cache_hit', { user: u.username, hash: processed.imageHash.slice(0, 12) });
      return res.json({ cached: true, memory: existing });
    }

    const textCall = async (messages: ChatMessage[], opts = {}) => {
      const r = await chatWithDARS('planner', messages, opts, {
        creds, health: globalHealth, emit: () => {}, sessionId: 'image-' + u.id,
      });
      return r.text;
    };

    const understanding: ImageUnderstanding = await runImagePipeline({ data }, {
      creds, textCall, userHint: question || undefined,
      onStep: (s) => { steps.push(s); },
    });

    const record = await storeImageMemory(toRecord(u.id, understanding));
    purgeExpiredImageMemories(u.id).catch(() => {}); // opportunistic housekeeping
    logger.info('image_analyzed', { user: u.username, hash: record.imageHash.slice(0, 12), scene: understanding.vision.scene });

    res.json({ cached: false, memory: record, understanding });
  } catch (e) {
    logger.error('image_analyze_error', { error: (e as Error).message, steps });
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/v1/image/memories', requireAuth, async (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  if (q) {
    const ranked = await searchImageMemories(req.user!.id, q, Math.min(limit, 10));
    return res.json({ query: q, results: ranked });
  }
  const memories = await listImageMemories(req.user!.id, limit);
  res.json({ memories });
});

app.delete('/v1/image/memories', requireAuth, async (req: AuthedRequest, res) => {
  await clearImageMemories(req.user!.id);
  res.json({ ok: true });
});

// ── PLANNING CHAT — RAA (SSE stream) ─────────────────────────────────────────
app.post('/v1/chat', requireAuth, async (req: AuthedRequest, res) => {
  const message = String(req.body?.message ?? '').trim();
  const history: ChatMessage[] = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'message required' });
  if (tooLong(message, MAX_MESSAGE)) return res.status(413).json({ error: `message too long (max ${MAX_MESSAGE} bytes)` });

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const emit = (_role: string, text: string, kind = 'status') =>
    send({ role: 'raa', kind, text });

  const call = async (messages: ChatMessage[], opts = {}) => {
    const r = await chatWithDARS('planner', messages, opts, {
      creds, health: globalHealth, emit, sessionId: 'raa-' + u.id,
    });
    return r.text;
  };

  try {
    const result = await runRAA(call, history, message);
    send({ role: 'raa', kind: 'output', text: result.text });
    send({ role: 'raa', kind: 'done', hasSummary: result.hasSummary, summary: result.summary ?? null });
  } catch (e) {
    send({ role: 'raa', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── DEBUG — senior-engineer debugging (SSE stream) ───────────────────────────
app.post('/v1/debug', requireAuth, async (req: AuthedRequest, res) => {
  const error = String(req.body?.error ?? '').trim();
  const code = String(req.body?.code ?? '');
  const context = String(req.body?.context ?? '');
  if (!error) return res.status(400).json({ error: 'error description required' });
  if (tooLong(error, MAX_MESSAGE)) return res.status(413).json({ error: `error description too long (max ${MAX_MESSAGE} bytes)` });
  if (tooLong(code, MAX_CODE)) return res.status(413).json({ error: `code too long (max ${MAX_CODE} bytes)` });
  if (tooLong(context, MAX_CONTEXT)) return res.status(413).json({ error: `context too long (max ${MAX_CONTEXT} bytes)` });

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const emit = (_role: string, text: string, kind = 'status') => send({ role: 'debugger', kind, text });

  const call = async (messages: ChatMessage[], opts = {}) => {
    const r = await chatWithDARS('reviewer', messages, opts, {
      creds, health: globalHealth, emit, sessionId: 'debug-' + u.id,
    });
    return r.text;
  };

  try {
    const result = await runDebugger(call, { error, code, context });
    send({ role: 'debugger', kind: 'output', text: result.raw });
    send({
      role: 'debugger', kind: 'done',
      rootCause: result.rootCause, analysis: result.analysis,
      solution: result.solution, patch: result.patch,
    });
  } catch (e) {
    send({ role: 'debugger', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── ANALYZE — assess a brief before building (SSE stream) ────────────────────
app.post('/v1/analyze', requireAuth, async (req: AuthedRequest, res) => {
  const brief = String(req.body?.brief ?? req.body?.context ?? '').trim();
  if (!brief) return res.status(400).json({ error: 'brief required' });
  if (tooLong(brief, MAX_BRIEF)) return res.status(413).json({ error: `brief too long (max ${MAX_BRIEF} bytes)` });

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const emit = (_role: string, text: string, kind = 'status') => send({ role: 'analyst', kind, text });

  const call = async (messages: ChatMessage[], opts = {}) => {
    const r = await chatWithDARS('planner', messages, opts, {
      creds, health: globalHealth, emit, sessionId: 'analyze-' + u.id,
    });
    return r.text;
  };

  try {
    const result = await runAnalyzer(call, brief);
    send({ role: 'analyst', kind: 'output', text: result.raw });
    send({
      role: 'analyst', kind: 'done',
      feasibility: result.feasibility, risks: result.risks, recommendations: result.recommendations,
    });
  } catch (e) {
    send({ role: 'analyst', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── TITAN MODE — AI System Architect (SSE stream) ────────────────────────────
app.post('/v1/titan', requireAuth, async (req: AuthedRequest, res) => {
  const message = String(req.body?.message ?? '').trim();
  const history: ChatMessage[] = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'message required' });
  if (tooLong(message, MAX_MESSAGE)) return res.status(413).json({ error: `message too long (max ${MAX_MESSAGE} bytes)` });

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const emit = (_role: string, text: string, kind = 'status') =>
    send({ role: 'titan', kind, text });

  const call = async (messages: ChatMessage[], opts = {}) => {
    const r = await chatWithDARS('planner', messages, opts, {
      creds, health: globalHealth, emit, sessionId: 'titan-' + u.id,
    });
    return r.text;
  };

  // Project Memory: Titan stays consistent with past decisions across sessions.
  let memoryContext = '';
  try {
    memoryContext = memoryToContext(await loadMemory(u.id));
    if (memoryContext) emit('titan', 'project memory loaded', 'status');
  } catch { /* memory is best-effort */ }

  try {
    const result = await runTitan(call, history, message, { emit, memoryContext });
    send({ role: 'titan', kind: 'output', text: result.text });
    send({
      role: 'titan', kind: 'done',
      hasPlan: result.hasPlan,
      hasBlueprint: result.hasBlueprint,
      blueprint: result.blueprint ?? null,
      confidence: result.confidence ?? null,
      confidenceBlocked: result.confidenceBlocked ?? false,
      reviewFindings: result.reviewFindings ?? [],
    });
    // Record the approved blueprint as a durable architecture decision.
    if (result.hasBlueprint && result.blueprint?.project) {
      try {
        const bp = result.blueprint;
        await recordDecision(u.id, `Titan blueprint: ${bp.project} — plan ${bp.chosenPlan || '?'}, stack ${bp.techStack || '?'}`);
      } catch { /* memory is best-effort */ }
    }
  } catch (e) {
    send({ role: 'titan', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── RUN TMAP (SSE stream) ─────────────────────────────────────────────────────
app.post('/v1/run', requireAuth, async (req: AuthedRequest, res) => {
  const task = String(req.body?.task ?? '').trim();
  const mode = (['lite', 'normal', 'pro'].includes(req.body?.mode) ? req.body.mode : currentMode()) as Mode;
  const context = String(req.body?.context ?? '').trim();
  const planOnly = req.body?.planOnly === true; // "Create Plan": plan, don't generate
  if (!task) return res.status(400).json({ error: 'task required' });
  if (tooLong(task, MAX_TASK)) return res.status(413).json({ error: `task too long (max ${MAX_TASK} bytes)` });
  if (tooLong(context, MAX_CONTEXT)) return res.status(413).json({ error: `context too long (max ${MAX_CONTEXT} bytes)` });

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  if (!bagHasAnyKey(creds)) {
    send({ role: 'system', kind: 'status', text: 'ยังไม่มี API key — กำลังใช้ mock mode เพิ่ม key ได้ในหน้า Settings' });
  }

  // Project memory: prepend what we know from previous sessions for this user
  let memCtx = '';
  try {
    const mem = await loadMemory(u.id);
    memCtx = memoryToContext(mem);
    if (memCtx) {
      send({ role: 'system', kind: 'status', text: `memory: loaded ${mem.sessions.length} previous session(s)` });
    }
  } catch { /* memory is best-effort */ }

  const fullContext = [context, memCtx].filter(Boolean).join('\n\n');
  const bb = createBlackboard(task, mode, fullContext);

  // Create session record immediately so it appears in history
  const sessionRec = await createSession(u.id, task, mode);
  // Use the same sessionId as the blackboard for consistency
  bb.sessionId = sessionRec.id;

  incTmapRun();
  logger.info('tmap_start', { sessionId: sessionRec.id, mode, user: u.username, taskLen: task.length });

  try {
    await runTMAP(bb, (role, text, kind = 'status') => send({ role, text, kind }), {
      creds,
      planOnly,
      onSessionStart: async () => { /* already created */ },
      onSessionEnd: async (_sid, result) => {
        await updateSession(sessionRec.id, {
          status: result.status,
          filesCount: result.filesCount,
          iterations: result.iterations,
          costUsd: result.costUsd,
          tokensUsed: result.tokensUsed,
          summary: task.slice(0, 120),
        });
        await addCost(u.id, result.tokensUsed, result.costUsd);
        addTokens(result.tokensUsed, result.costUsd);
        // Record into project memory so the next session starts informed.
        // Architecture decisions from the Architect stage become durable memory.
        try {
          const decisions: string[] = [];
          if (bb.architect?.approach) decisions.push(bb.architect.approach);
          for (const r of bb.architect?.risks ?? []) decisions.push(`Avoid: ${r}`);
          await recordSessionMemory(u.id, {
            task: task.slice(0, 160),
            status: result.status,
            files: bb.files.map((f) => f.path).slice(0, 20),
            iterations: result.iterations,
            at: new Date().toISOString(),
          }, {
            techStack: bb.architect?.techStack || bb.contextMeta?.projectType,
            conventions: bb.contextMeta?.conventions,
            decisions,
            failures: bb.failureNotes,
          });
        } catch { /* memory is best-effort */ }
        logger.info('tmap_done', { sessionId: sessionRec.id, files: result.filesCount, iterations: result.iterations, costUsd: result.costUsd, status: result.status });
        if (result.status === 'error') incTmapError();
      },
      onAgentCall: async (_sid, log) => {
        await appendAgentLog({ sessionId: sessionRec.id, ...log });
        incAgentCall(log.role, log.provider);
        logger.debug('agent_call', { role: log.role, provider: log.provider, model: log.model, durationMs: log.durationMs, tokens: log.inputTokens + log.outputTokens });
      },
    });
    send({ role: 'system', kind: 'done', text: 'done', files: bb.files, iterations: bb.iterations, sessionId: sessionRec.id });
  } catch (e) {
    incError();
    incTmapError();
    await updateSession(sessionRec.id, { status: 'error' });
    logger.error('tmap_error', { sessionId: sessionRec.id, error: (e as Error).message });
    send({ role: 'system', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── ORCHESTRATE — Coagentix Universal Chief Agent (SSE stream) ───────────────
app.post('/v1/orchestrate', requireAuth, async (req: AuthedRequest, res) => {
  const message = String(req.body?.message ?? '').trim();
  const history: ChatMessage[] = Array.isArray(req.body?.history) ? req.body.history : [];
  const enableQualityGate = req.body?.qualityGate !== false;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (tooLong(message, MAX_MESSAGE)) return res.status(413).json({ error: `message too long (max ${MAX_MESSAGE} bytes)` });

  const u = req.user!;
  const creds: CredentialBag = {};
  for (const p of PROVIDERS) {
    if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  // Load memory for context continuity
  let memCtx = '';
  try {
    const mem = await loadMemory(u.id);
    memCtx = memoryToContext(mem);
    if (memCtx) send({ role: 'chief', kind: 'status', text: 'memory: loading context from previous sessions' });
  } catch { /* best-effort */ }

  // Image memory: pull in knowledge from images analyzed earlier that are
  // relevant to this message, so we can answer without re-reading them (step 10).
  let imgCtx = '';
  try {
    const ranked = await searchImageMemories(u.id, message, 3);
    imgCtx = imageMemoriesToContext(ranked);
    if (imgCtx) send({ role: 'chief', kind: 'status', text: `image memory: ${ranked.length} relevant image(s)` });
  } catch { /* best-effort */ }

  // Prepend memory to history context if available
  const systemContext = [memCtx, imgCtx].filter(Boolean).join('\n\n');
  const enrichedHistory: ChatMessage[] = systemContext
    ? [{ role: 'system' as const, content: systemContext }, ...history]
    : history;

  try {
    const result = await runChiefAgent(message, {
      creds,
      health: globalHealth,
      emit: (agent, text, kind = 'status') => send({ role: agent, kind, text }),
      sessionId: 'orchestrate-' + u.id,
      history: enrichedHistory,
      enableQualityGate,
    });

    send({
      role: 'chief',
      kind: 'output',
      text: result.response,
    });
    send({
      role: 'chief',
      kind: 'done',
      categories: result.categories,
      agentsUsed: result.agentsUsed,
      qualityScore: result.qualityScore,
      iterations: result.iterations,
    });

    // Record to memory for future sessions
    try {
      await recordSessionMemory(u.id, {
        task: message.slice(0, 160),
        status: 'done',
        files: [],
        iterations: result.iterations,
        at: new Date().toISOString(),
      }, {});
    } catch { /* best-effort */ }
  } catch (e) {
    send({ role: 'chief', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── CLI AUTH ──────────────────────────────────────────────────────────────────
// POST /v1/cli/auth — exchange raw CLI token for a tmap-v2 JWT (Advanced only)
app.post('/v1/cli/auth', async (req, res) => {
  try {
    await handleCliAuth(req, res);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /v1/cli/status — quick auth check used by `coai status`
app.get('/v1/cli/status', requireAuth, async (req: AuthedRequest, res) => {
  await handleCliStatus(req, res);
});

// ── HEALTH + METRICS ─────────────────────────────────────────────────────────

// Full dependency health check (Redis, Supabase, queues, providers)
app.get('/v1/health', async (_req, res) => {
  try {
    const [depHealth, providerHealth] = await Promise.all([
      buildHealthReport(),
      Promise.resolve(globalHealth.snapshot()),
    ]);
    res.json({ ...depHealth, providers: providerHealth });
  } catch (err) {
    res.status(503).json({ status: 'fail', error: (err as Error).message });
  }
});

// In-memory counters (request/error/token stats) — auth required
app.get('/v1/metrics', requireAuth, (_req: AuthedRequest, res) => {
  res.json(getMetrics());
});

// Prometheus text-format metrics endpoint for Grafana/Prometheus scraping.
// Optionally protect with a scrape token via PROMETHEUS_SCRAPE_TOKEN env var.
app.get('/v1/metrics/prometheus', async (req, res) => {
  const scrapeToken = process.env.PROMETHEUS_SCRAPE_TOKEN;
  if (scrapeToken) {
    const authHeader = req.headers.authorization ?? '';
    const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== scrapeToken) {
      res.status(401).set('WWW-Authenticate', 'Bearer realm="metrics"').end();
      return;
    }
  }
  try {
    const metrics = await registry.metrics();
    res.set('Content-Type', registry.contentType).send(metrics);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PHASE 4: AI INTELLIGENCE ENDPOINTS ───────────────────────────────────────

// GET /v1/routing-metrics — adaptive routing performance data (auth required)
app.get('/v1/routing-metrics', requireAuth, (_req: AuthedRequest, res) => {
  res.json(globalRoutingMetrics.snapshot());
});

// POST /v1/evaluate — run the AI evaluation framework on provided output
// Body: { task: string, files?: [{path,language,content}], reviewText?: string, iterations?: number }
app.post('/v1/evaluate', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { task, files, reviewText, iterations } = req.body ?? {};
    if (!task || typeof task !== 'string') {
      return res.status(400).json({ error: 'task (string) required' });
    }
    if (tooLong(task, MAX_TASK)) {
      return res.status(413).json({ error: 'task too long' });
    }

    const u = req.user!;
    // Build CredentialBag from the user's stored (encrypted) keys
    const creds: CredentialBag = {};
    for (const p of PROVIDERS) {
      if (u.encryptedKeys[p]) (creds as Record<string, string>)[p] = decryptSecret(u.encryptedKeys[p]!);
    }
    if (!bagHasAnyKey(creds)) {
      return res.status(402).json({ error: 'No AI API key configured. Add a key in settings.' });
    }

    const evalBb: Blackboard = {
      sessionId: `eval-${Date.now()}`,
      task: String(task).slice(0, MAX_TASK),
      mode: 'normal',
      context: '',
      plan: [], planText: '',
      files: Array.isArray(files) ? (files as CodeFile[]) : [],
      review: [], reviewText: typeof reviewText === 'string' ? reviewText : '',
      validations: [],
      iterations: Number(iterations ?? 1),
      log: [],
    };

    const ctx = { creds, health: globalHealth, emit: () => {}, sessionId: evalBb.sessionId };
    const call = async (messages: import('../types.js').ChatMessage[]) => {
      const r = await chatWithDARS('reviewer', messages, { temperature: 0.1 }, ctx);
      return r.text;
    };

    const report = await evaluateOutput(call, evalBb, {
      includeHallucination: true,
      includeVerification: true,
    });

    incEvaluation();
    logger.info('evaluation_run', { sessionId: evalBb.sessionId, score: report.overallScore, grade: report.grade });
    return res.json(report);
  } catch (e) {
    logger.error('evaluation_error', { error: (e as Error).message });
    return res.status(500).json({ error: 'evaluation failed' });
  }
});

// GET /v1/benchmark/results — returns the last routing metrics snapshot as a
// lightweight benchmark proxy (no real TMAP runs to avoid cost/latency).
app.get('/v1/benchmark/results', requireAuth, (_req: AuthedRequest, res) => {
  const snap = globalRoutingMetrics.snapshot();
  const passRate = snap.metrics.length > 0
    ? Math.round(snap.metrics.filter((m) => m.successRate >= 0.7).length / snap.metrics.length * 100)
    : null;
  res.json({
    routingMetrics: snap.metrics,
    summary: {
      totalObservations: snap.records.length,
      providerCount: snap.metrics.length,
      avgSuccessRate: snap.metrics.length
        ? Math.round(snap.metrics.reduce((s, m) => s + m.successRate, 0) / snap.metrics.length * 100) / 100
        : null,
      passRate,
    },
    ts: snap.ts,
  });
});

// ── PHASE 5: SANDBOX & DEVELOPER PLATFORM ────────────────────────────────────

// GET /v1/sandbox/capabilities — no auth; describes what the sandbox can run
app.get('/v1/sandbox/capabilities', (_req, res) => {
  const dockerAvailable = isDockerAvailable();
  res.json({
    languages: SUPPORTED_LANGUAGES,
    limits: {
      defaultTimeoutMs: SANDBOX_DEFAULT_TIMEOUT_MS,
      maxTimeoutMs: SANDBOX_MAX_TIMEOUT_MS,
      defaultMaxOutputBytes: SANDBOX_DEFAULT_MAX_BYTES,
      maxInputBytes: 100_000,
      maxInputFiles: 20,
      maxTotalFileSizeBytes: 500_000,
    },
    docker: {
      available: dockerAvailable,
      defaultTimeoutMs: dockerAvailable ? DOCKER_DEFAULT_TIMEOUT_MS : null,
      maxTimeoutMs:     dockerAvailable ? DOCKER_MAX_TIMEOUT_MS     : null,
      note: dockerAvailable
        ? 'Pass docker:true in the request body to use full container isolation.'
        : 'Docker is not available on this host.',
    },
    note: 'bash/shell execution is always rejected for security reasons.',
  });
});

// POST /v1/sandbox/run — execute code in the secure sandbox
// Body: { language, code, timeoutMs?, maxOutputBytes?, files? }
app.post('/v1/sandbox/run', requireAuth, async (req: AuthedRequest, res) => {
  const { language, code, timeoutMs, maxOutputBytes, files } = req.body ?? {};

  if (!language || !SUPPORTED_LANGUAGES.includes(language as SandboxLanguage)) {
    return res.status(400).json({
      error: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
    });
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code (string) required' });
  }
  if (Buffer.byteLength(code, 'utf8') > 100_000) {
    return res.status(413).json({ error: 'code too large (max 100 000 bytes)' });
  }

  const u = req.user!;
  const sbQuota = checkSandboxQuota(u.id);
  if (!sbQuota.ok) {
    incQuotaViolation();
    return res.status(429).json({ error: sbQuota.reason });
  }

  // Security: cap input file count and total size
  const rawFiles = Array.isArray(files) ? files : [];
  if (rawFiles.length > 20) {
    return res.status(400).json({ error: 'Too many input files (max 20)' });
  }
  const totalFileBytes = rawFiles.reduce(
    (sum: number, f: { content?: string }) => sum + Buffer.byteLength(f.content ?? '', 'utf8'),
    0,
  );
  if (totalFileBytes > 500_000) {
    return res.status(413).json({ error: 'Total input file size too large (max 500 KB)' });
  }

  // Use Docker sandbox when the caller requests it and Docker is available
  const useDocker = req.body?.docker === true && isDockerAvailable();

  const sbOpts: SandboxOptions = {
    language: language as SandboxLanguage,
    code,
    timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
    maxOutputBytes: typeof maxOutputBytes === 'number' ? maxOutputBytes : undefined,
    files: rawFiles.length > 0 ? rawFiles : undefined,
  };

  const result = useDocker
    ? await runInDockerSandbox(sbOpts)
    : await runInSandbox(sbOpts);

  recordSandboxRun(u.id);
  incSandboxRun(!result.success);

  await logAuditEvent({
    actorId: u.id, actorIp: getClientIp(req as never),
    action: AuditAction.SANDBOX_RUN,
    outcome: result.success ? 'success' : 'failure',
    metadata: { language, durationMs: result.durationMs, docker: useDocker },
  });
  logger.info('sandbox_run', {
    user: u.username, language, success: result.success,
    durationMs: result.durationMs, timedOut: result.timedOut, docker: useDocker,
  });

  return res.json({ ...result, docker: useDocker });
});

// GET /v1/me/usage — detailed usage summary for the authenticated user
app.get('/v1/me/usage', requireAuth, (req: AuthedRequest, res) => {
  const summary = getUsageSummary(req.user!.id);
  res.json(summary);
});

// GET /v1/me/quota — current quota status (are any limits exceeded?)
app.get('/v1/me/quota', requireAuth, (req: AuthedRequest, res) => {
  const status = checkQuota(req.user!.id);
  res.json(status);
});

// POST /v1/me/keys/rotate — re-encrypt a stored key with a fresh IV.
// This does NOT generate a new key at the provider — it just refreshes the
// local ciphertext (useful as part of a key hygiene rotation procedure).
app.post('/v1/me/keys/rotate', requireAuth, async (req: AuthedRequest, res) => {
  const { provider } = req.body ?? {};
  const u = req.user!;
  if (!PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${PROVIDERS.join(', ')}` });
  }
  if (!u.encryptedKeys[provider as ProviderKeyName]) {
    return res.status(404).json({ error: 'No key stored for this provider' });
  }
  try {
    const plain = decryptSecret(u.encryptedKeys[provider as ProviderKeyName]!);
    await setUserKey(u.id, provider as ProviderKeyName, encryptSecret(plain));
    incKeyRotation();
    logger.info('key_rotated', { user: u.username, provider });
    return res.json({ ok: true, provider });
  } catch {
    return res.status(500).json({ error: 'Key rotation failed' });
  }
});

// POST /v1/me/keys/validate — structural validation of a stored or provided key.
// Does NOT make a live API call (avoids latency/cost); checks key format only.
app.post('/v1/me/keys/validate', requireAuth, async (req: AuthedRequest, res) => {
  const { provider, key: rawKey } = req.body ?? {};
  const u = req.user!;
  if (!PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${PROVIDERS.join(', ')}` });
  }

  let plain: string;
  try {
    if (rawKey && typeof rawKey === 'string') {
      plain = rawKey.trim();
    } else if (u.encryptedKeys[provider as ProviderKeyName]) {
      plain = decryptSecret(u.encryptedKeys[provider as ProviderKeyName]!);
    } else {
      return res.status(404).json({ error: 'No key stored for this provider and none provided' });
    }
  } catch {
    incKeyValidation(false);
    return res.status(400).json({ valid: false, error: 'Could not read stored key' });
  }

  // Structural format checks (no live API call)
  const validations: Record<string, (k: string) => boolean> = {
    openrouter: (k) => k.startsWith('sk-or-') && k.length >= 20,
    gemini:     (k) => k.startsWith('AIza') && k.length >= 20,
    deepseek:   (k) => k.startsWith('sk-') && k.length >= 20,
    qwen:       (k) => k.length >= 16,
    llama:      (k) => k.length >= 16,
  };

  const validator = validations[provider] ?? ((k: string) => k.length >= 8);
  const valid = validator(plain);
  incKeyValidation(valid);
  logger.info('key_validated', { user: u.username, provider, valid });
  return res.json({ valid, provider, masked: maskKey(plain) });
});

// ── DEVELOPER KEYS ────────────────────────────────────────────────────────────

// GET /v1/developer/keys — list the caller's developer API keys
app.get('/v1/developer/keys', requireAuth, async (req: AuthedRequest, res) => {
  const keys = await listDevKeys(req.user!.id);
  res.json({ keys });
});

// POST /v1/developer/keys — create a new developer API key
// Body: { name: string, scopes: DevKeyScope[] }
app.post('/v1/developer/keys', requireAuth, async (req: AuthedRequest, res) => {
  const { name, scopes } = req.body ?? {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name (string) required' });
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ error: 'scopes (array) required' });
  }
  try {
    const result = await createDevKey(req.user!.id, name, scopes as DevKeyScope[]);
    await logAuditEvent({
      actorId: req.user!.id, actorIp: getClientIp(req as never),
      action: AuditAction.DEV_KEY_CREATED, outcome: 'success',
      metadata: { keyId: result.key.id, name, scopes },
    });
    incKeyRotation();
    return res.status(201).json(result);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
});

// DELETE /v1/developer/keys/:id — revoke a developer API key
app.delete('/v1/developer/keys/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await revokeDevKey(req.user!.id, req.params.id);
    await logAuditEvent({
      actorId: req.user!.id, actorIp: getClientIp(req as never),
      action: AuditAction.DEV_KEY_REVOKED, outcome: 'success',
      metadata: { keyId: req.params.id },
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(404).json({ error: (e as Error).message });
  }
});

// ── WEBHOOKS ──────────────────────────────────────────────────────────────────

// GET /v1/webhooks — list registered webhooks
app.get('/v1/webhooks', requireAuth, async (req: AuthedRequest, res) => {
  const hooks = await listWebhooks(req.user!.id);
  res.json({ webhooks: hooks });
});

// POST /v1/webhooks — register a webhook
// Body: { url: string, events: WebhookEvent[] }
app.post('/v1/webhooks', requireAuth, async (req: AuthedRequest, res) => {
  const { url, events } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url (string) required' });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events (array) required' });
  }
  try {
    const result = await registerWebhook(req.user!.id, url, events as WebhookEvent[]);
    return res.status(201).json(result);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
});

// DELETE /v1/webhooks/:id — delete a webhook
app.delete('/v1/webhooks/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await deleteWebhook(req.user!.id, req.params.id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(404).json({ error: (e as Error).message });
  }
});

// POST /v1/webhooks/test — send a test event to a registered webhook
app.post('/v1/webhooks/:id/test', requireAuth, async (req: AuthedRequest, res) => {
  const hooks = await listWebhooks(req.user!.id);
  const hook  = hooks.find((h) => h.id === req.params.id);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  await dispatchEvent(req.user!.id, 'sandbox.completed', { test: true, webhookId: hook.id });
  return res.json({ ok: true, message: 'Test event dispatched' });
});

// ── DEVELOPER HEALTH ──────────────────────────────────────────────────────────

// GET /v1/developer/health — extended health dump for developers/integrators
app.get('/v1/developer/health', requireAuth, (_req: AuthedRequest, res) => {
  const health = globalHealth.snapshot();
  const metrics = getMetrics();
  const quota = DEFAULT_QUOTA;
  res.json({
    status: 'ok',
    uptime: metrics.uptimeSec,
    darsHealth: health,
    metrics: {
      requests: metrics.requests,
      tmapRuns: metrics.tmapRuns,
      sandboxRuns: metrics.sandboxRuns,
      evaluationsRun: metrics.evaluationsRun,
    },
    sandbox: {
      supported: SUPPORTED_LANGUAGES,
      defaultTimeoutMs: SANDBOX_DEFAULT_TIMEOUT_MS,
    },
    defaultQuota: quota,
  });
});

// ── PHASE 6: SCALE & ENTERPRISE ──────────────────────────────────────────────

// Lazy-load Phase 6 modules to avoid startup overhead when not used
async function p6teams()   { return import('./teams.js'); }
async function p6orgs()    { return import('./orgs.js'); }
async function p6perms()   { return import('./permissions.js'); }
async function p6backup()  { return import('./backup.js'); }
async function p6restore() { return import('./restore.js'); }
async function p6dr()      { return import('./disaster-recovery.js'); }
async function p6fo()      { return import('./failover.js'); }
async function p6an()      { return import('./analytics.js'); }
async function p6stream()  { return import('./streaming.js'); }
async function p6redis()   { return import('./redis-cluster.js'); }

// ── Teams ──────────────────────────────────────────────────────────────────────

app.get('/v1/teams', requireAuth, async (req: AuthedRequest, res) => {
  const { getUserTeams } = await p6teams();
  const teams = await getUserTeams(req.user!.id);
  incTeamOperation();
  res.json({ teams });
});

app.post('/v1/teams', requireAuth, async (req: AuthedRequest, res) => {
  const { name, orgId, description } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (!orgId || typeof orgId !== 'string') return res.status(400).json({ error: 'orgId required' });
  const { createTeam } = await p6teams();
  const team = await createTeam({ name: String(name).slice(0, 80), orgId, ownerId: req.user!.id, description });
  incTeamOperation();
  return res.status(201).json({ team });
});

app.get('/v1/teams/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { getTeam, getMemberRole } = await p6teams();
  const team = await getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'team not found' });
  const role = await getMemberRole(req.params.id, req.user!.id);
  if (!role) return res.status(403).json({ error: 'not a team member' });
  incTeamOperation();
  return res.json({ team, role });
});

app.patch('/v1/teams/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { updateTeam, assertTeamAccess } = await p6teams();
  await assertTeamAccess(req.params.id, req.user!.id, 'admin');
  const team = await updateTeam(req.params.id, { name: req.body?.name, description: req.body?.description });
  incTeamOperation();
  return team ? res.json({ team }) : res.status(404).json({ error: 'team not found' });
});

app.delete('/v1/teams/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { deleteTeam, assertTeamAccess } = await p6teams();
  await assertTeamAccess(req.params.id, req.user!.id, 'owner');
  await deleteTeam(req.params.id);
  incTeamOperation();
  return res.json({ ok: true });
});

app.get('/v1/teams/:id/members', requireAuth, async (req: AuthedRequest, res) => {
  const { getTeamMembers, getMemberRole } = await p6teams();
  const role = await getMemberRole(req.params.id, req.user!.id);
  if (!role) return res.status(403).json({ error: 'not a team member' });
  const members = await getTeamMembers(req.params.id);
  return res.json({ members });
});

app.post('/v1/teams/:id/members', requireAuth, async (req: AuthedRequest, res) => {
  const { addTeamMember, assertTeamAccess } = await p6teams();
  await assertTeamAccess(req.params.id, req.user!.id, 'admin');
  const { userId, role = 'member' } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const member = await addTeamMember(req.params.id, String(userId), role);
  incTeamOperation();
  return res.status(201).json({ member });
});

app.delete('/v1/teams/:id/members/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const { removeTeamMember, assertTeamAccess } = await p6teams();
  await assertTeamAccess(req.params.id, req.user!.id, 'admin');
  await removeTeamMember(req.params.id, req.params.userId);
  incTeamOperation();
  return res.json({ ok: true });
});

// ── Organizations ──────────────────────────────────────────────────────────────

app.get('/v1/orgs', requireAuth, async (req: AuthedRequest, res) => {
  const { getUserOrgs } = await p6orgs();
  const orgs = await getUserOrgs(req.user!.id);
  incOrgOperation();
  res.json({ orgs });
});

app.post('/v1/orgs', requireAuth, async (req: AuthedRequest, res) => {
  const { name, plan } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  const { createOrg } = await p6orgs();
  const org = await createOrg({ name: String(name).slice(0, 80), ownerId: req.user!.id, plan });
  incOrgOperation();
  return res.status(201).json({ org });
});

app.get('/v1/orgs/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { getOrg, getOrgMemberRole } = await p6orgs();
  const org = await getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'org not found' });
  const role = await getOrgMemberRole(req.params.id, req.user!.id);
  if (!role) return res.status(403).json({ error: 'not an org member' });
  incOrgOperation();
  return res.json({ org, role });
});

app.patch('/v1/orgs/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { updateOrg, getOrgMemberRole } = await p6orgs();
  const role = await getOrgMemberRole(req.params.id, req.user!.id);
  if (!role || role === 'member') return res.status(403).json({ error: 'requires org admin' });
  const org = await updateOrg(req.params.id, { name: req.body?.name, plan: req.body?.plan, ssoEnabled: req.body?.ssoEnabled });
  incOrgOperation();
  return org ? res.json({ org }) : res.status(404).json({ error: 'org not found' });
});

// ── Permissions ────────────────────────────────────────────────────────────────

app.get('/v1/permissions', requireAuth, async (req: AuthedRequest, res) => {
  const { getUserRoles, listPermissions } = await p6perms();
  const roles       = await getUserRoles(req.user!.id);
  const systemRole  = roles.find((r) => r.scope === 'system');
  const permissions = systemRole ? listPermissions(systemRole.role) : {};
  res.json({ roles, permissions });
});

app.get('/v1/permissions/check', requireAuth, async (req: AuthedRequest, res) => {
  const action   = req.query['action']   as string;
  const resource = req.query['resource'] as string;
  const scope    = (req.query['scope'] as string) ?? 'system';
  if (!action || !resource) return res.status(400).json({ error: 'action and resource required' });
  const { can } = await p6perms();
  const allowed = await can(req.user!.id, action as never, resource as never, scope);
  return res.json({ allowed, action, resource, scope });
});

// ── Backup ─────────────────────────────────────────────────────────────────────

app.post('/v1/backup', requireAuth, async (req: AuthedRequest, res) => {
  const { createBackup } = await p6backup();
  const manifest = await createBackup({
    requestedBy: req.user!.id,
    encrypt:     req.body?.encrypt !== false,
    collections: req.body?.collections,
  });
  incBackupCreated();
  return res.status(201).json({ backup: manifest });
});

app.get('/v1/backup', requireAuth, async (_req: AuthedRequest, res) => {
  const { listBackups } = await p6backup();
  res.json({ backups: listBackups() });
});

app.get('/v1/backup/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { getBackup, validateBackup } = await p6backup();
  const manifest = getBackup(req.params.id);
  if (!manifest) return res.status(404).json({ error: 'backup not found' });
  const validation = validateBackup(req.params.id);
  return res.json({ backup: manifest, validation });
});

// ── Restore ────────────────────────────────────────────────────────────────────

app.post('/v1/restore', requireAuth, async (req: AuthedRequest, res) => {
  const { restore, setLastRestore, preRestoreChecks } = await p6restore();
  const { backupId, dryRun = true, collections } = req.body ?? {};
  if (!backupId) return res.status(400).json({ error: 'backupId required' });
  const checks = preRestoreChecks(String(backupId));
  if (!checks.ok) return res.status(422).json({ error: 'Pre-restore checks failed', issues: checks.issues });
  const result = await restore({ backupId: String(backupId), dryRun, collections, requestedBy: req.user!.id });
  setLastRestore(result);
  incRestoreRun();
  return res.json({ restore: result });
});

app.get('/v1/restore/status', requireAuth, async (_req: AuthedRequest, res) => {
  const { getLastRestoreStatus } = await p6restore();
  res.json({ lastRestore: getLastRestoreStatus() });
});

// ── Disaster Recovery ──────────────────────────────────────────────────────────

app.get('/v1/dr/status', requireAuth, async (_req: AuthedRequest, res) => {
  const { getDRStatus } = await p6dr();
  const status = await getDRStatus();
  res.json(status);
});

app.get('/v1/dr/runbook', requireAuth, async (req: AuthedRequest, res) => {
  const { getRunbook } = await p6dr();
  const severity = req.query['severity'] as string | undefined;
  res.json({ runbook: getRunbook(severity as never) });
});

app.get('/v1/dr/incidents', requireAuth, async (req: AuthedRequest, res) => {
  const { listIncidents } = await p6dr();
  const status   = req.query['status']   as string | undefined;
  const severity = req.query['severity'] as string | undefined;
  res.json({ incidents: listIncidents({ status: status as never, severity: severity as never }) });
});

app.post('/v1/dr/incidents', requireAuth, async (req: AuthedRequest, res) => {
  const { title, severity = 'medium', affectedServices = [] } = req.body ?? {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const { createIncident } = await p6dr();
  const incident = createIncident({ title: String(title), severity, affectedServices, openedBy: req.user!.id });
  return res.status(201).json({ incident });
});

app.patch('/v1/dr/incidents/:id', requireAuth, async (req: AuthedRequest, res) => {
  const { updateIncident } = await p6dr();
  const incident = updateIncident(req.params.id, { status: req.body?.status, note: req.body?.note });
  return incident ? res.json({ incident }) : res.status(404).json({ error: 'incident not found' });
});

// ── Failover ───────────────────────────────────────────────────────────────────

app.get('/v1/failover/circuits', requireAuth, async (_req: AuthedRequest, res) => {
  const { listCircuits, getHealthScores } = await p6fo();
  res.json({ circuits: listCircuits(), healthScores: getHealthScores() });
});

app.post('/v1/failover/circuits/:name/reset', requireAuth, async (req: AuthedRequest, res) => {
  const { resetCircuit } = await p6fo();
  resetCircuit(req.params.name);
  return res.json({ ok: true, circuit: req.params.name });
});

// ── Analytics ──────────────────────────────────────────────────────────────────

app.post('/v1/analytics/events', requireAuth, async (req: AuthedRequest, res) => {
  const { eventType, properties = {} } = req.body ?? {};
  if (!eventType) return res.status(400).json({ error: 'eventType required' });
  const { trackEvent } = await p6an();
  await trackEvent({
    eventType: String(eventType).slice(0, 80),
    userId:    req.user!.id,
    properties,
    ts:        new Date().toISOString(),
  });
  incAnalyticsEvent();
  return res.json({ ok: true });
});

app.get('/v1/analytics/summary', requireAuth, async (req: AuthedRequest, res) => {
  const date = (req.query['date'] as string) ?? new Date().toISOString().slice(0, 10);
  const { getDailySummary } = await p6an();
  const summary = await getDailySummary(date);
  res.json({ summary });
});

app.get('/v1/analytics/features', requireAuth, async (req: AuthedRequest, res) => {
  const date = (req.query['date'] as string) ?? new Date().toISOString().slice(0, 10);
  const { getFeatureUsage } = await p6an();
  const features = await getFeatureUsage(date);
  res.json({ date, features });
});

app.get('/v1/analytics/mau', requireAuth, async (req: AuthedRequest, res) => {
  const month = (req.query['month'] as string) ?? new Date().toISOString().slice(0, 7);
  const { getMAU } = await p6an();
  const mau = await getMAU(month);
  res.json({ month, mau });
});

// ── Streaming & infra stats ────────────────────────────────────────────────────

app.get('/v1/streaming/connections', requireAuth, async (_req: AuthedRequest, res) => {
  const { getConnectionStats } = await p6stream();
  res.json(getConnectionStats());
});

app.get('/v1/infra/redis', requireAuth, async (_req: AuthedRequest, res) => {
  const { getRedisMemoryStats } = await p6redis();
  try {
    const stats = await getRedisMemoryStats();
    res.json(stats);
  } catch (e) {
    res.status(503).json({ error: 'Redis unavailable', detail: (e as Error).message });
  }
});

// ── static ────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));

// ── 404 + global error handler ────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Sentry must handle errors before the generic error handler so it captures
// the full exception context (request, user, breadcrumbs).
if (process.env.SENTRY_DSN) {
  app.use(SentryNode.expressErrorHandler());
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('unhandled_error', { error: err.message, stack: err.stack?.split('\n')[1]?.trim() });
  incError();
  res.status(500).json({ error: 'internal server error' });
});

export default app;

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 8787);
  app.listen(PORT, async () => {
    console.log(`Coagentix → http://localhost:${PORT}`);
    // Start BullMQ workers + register scheduled jobs when Redis is configured
    if (process.env.REDIS_URL ?? process.env.REDIS_HOST) {
      const { startWorkers, registerScheduledJobs } = await import('./queue.js');
      startWorkers();
      await registerScheduledJobs();
    }
  });
}
