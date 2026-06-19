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
import { logger, incRequest, incError, incTmapRun, incTmapError, addTokens, incAgentCall, getMetrics } from './logger.js';
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
import * as SentryNode from '@sentry/node';

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
    if (!user || !verifyPassword(String(pin ?? '').trim(), user.pinHash)) {
      if (uname) {
        const info = recordFailure(uname, clientIp);
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
