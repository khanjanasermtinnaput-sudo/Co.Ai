import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hashPassword, verifyPassword, encryptSecret, decryptSecret, maskKey } from './crypto.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import {
  createUser, findUserByUsername, setUserKey, deleteUserKey,
  createSession, updateSession, getUserSessions, getSession, getSessionLogs,
  addCost, getUserCost,
  type ProviderKeyName,
} from './db.js';
import { checkLoginRate, recordFailure, recordSuccess } from './rateLimit.js';
import { logger, incRequest, incError, incTmapRun, incTmapError, addTokens, incAgentCall, getMetrics } from './logger.js';
import { bagHasAnyKey, type CredentialBag } from '../config.js';
import { createBlackboard } from '../core/blackboard.js';
import { runTMAP } from '../core/orchestrator.js';
import { runRAA } from '../core/raa.js';
import { currentMode } from '../config.js';
import type { Mode, ChatMessage } from '../types.js';
import { chatWithDARS } from '../dars/run.js';
import { globalHealth } from '../dars/health.js';

const PROVIDERS: ProviderKeyName[] = ['openrouter', 'gemini', 'deepseek', 'qwen', 'llama'];

const app = express();
app.use(cors());
app.use(express.json());

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

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/v1/auth/register', async (req, res) => {
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
});

app.post('/v1/auth/login', async (req, res) => {
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

// ── PLANNING CHAT — RAA (SSE stream) ─────────────────────────────────────────
app.post('/v1/chat', requireAuth, async (req: AuthedRequest, res) => {
  const message = String(req.body?.message ?? '').trim();
  const history: ChatMessage[] = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'message required' });

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

// ── RUN TMAP (SSE stream) ─────────────────────────────────────────────────────
app.post('/v1/run', requireAuth, async (req: AuthedRequest, res) => {
  const task = String(req.body?.task ?? '').trim();
  const mode = (['lite', 'normal', 'pro'].includes(req.body?.mode) ? req.body.mode : currentMode()) as Mode;
  const context = String(req.body?.context ?? '').trim();
  if (!task) return res.status(400).json({ error: 'task required' });

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

  const bb = createBlackboard(task, mode, context);

  // Create session record immediately so it appears in history
  const sessionRec = await createSession(u.id, task, mode);
  // Use the same sessionId as the blackboard for consistency
  bb.sessionId = sessionRec.id;

  incTmapRun();
  logger.info('tmap_start', { sessionId: sessionRec.id, mode, user: u.username, taskLen: task.length });

  try {
    await runTMAP(bb, (role, text, kind = 'status') => send({ role, text, kind }), {
      creds,
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
        logger.info('tmap_done', { sessionId: sessionRec.id, files: result.filesCount, iterations: result.iterations, costUsd: result.costUsd, status: result.status });
        if (result.status === 'error') incTmapError();
      },
      onAgentCall: async (_sid, log) => {
        const { appendAgentLog } = await import('./db.js');
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

// ── HEALTH + METRICS ─────────────────────────────────────────────────────────
app.get('/v1/health', (_req, res) => {
  res.json(globalHealth.snapshot());
});

app.get('/v1/metrics', (_req, res) => {
  res.json(getMetrics());
});

// ── static ────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));

export default app;

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 8787);
  app.listen(PORT, () => console.log(`AOF Code → http://localhost:${PORT}`));
}
