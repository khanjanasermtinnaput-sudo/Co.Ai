import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hashPassword, verifyPassword, encryptSecret, decryptSecret, maskKey } from './crypto.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import { createUser, findUserByUsername, setUserKey, deleteUserKey, type ProviderKeyName } from './db.js';
import { checkLoginRate, recordFailure, recordSuccess } from './rateLimit.js';
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

// ── VALIDATION helpers ─────────────────────────────────────────────────────────
function validUsername(u: unknown): u is string {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{2,32}$/.test(u.trim());
}
function validPin(p: unknown): p is string {
  return typeof p === 'string' && /^\d{4,8}$/.test(String(p).trim());
}

// ── AUTH (username + PIN ≤ 8 digits) ──────────────────────────────────────────
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

  // ── rate-limit check (before any DB lookup to avoid timing oracle) ────────
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

  // ── credential check ──────────────────────────────────────────────────────
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

// ── PLANNING CHAT — RAA (SSE stream) ─────────────────────────────────────────
// Stateless: client sends full history each turn so this works on serverless.
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

  // RAA uses its own LLM call via DARS (planner slot — best at reasoning/conversation)
  const call = async (messages: ChatMessage[], opts = {}) => {
    const r = await chatWithDARS('planner', messages, opts, {
      creds,
      health: globalHealth,
      emit,
      sessionId: 'raa-' + u.id,
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
  const context = String(req.body?.context ?? '').trim();   // optional: requirement summary from RAA
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

  const bb = createBlackboard(task, mode, context);    // context = requirement summary
  try {
    await runTMAP(bb, (role, text, kind = 'status') => send({ role, text, kind }), { creds });
    send({ role: 'system', kind: 'done', text: 'done', files: bb.files, iterations: bb.iterations });
  } catch (e) {
    send({ role: 'system', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── static ────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));

export default app;

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 8787);
  app.listen(PORT, () => console.log(`AOF Code → http://localhost:${PORT}`));
}
