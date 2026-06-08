import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hashPassword, verifyPassword, encryptSecret, decryptSecret, maskKey } from './crypto.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import { createUser, findUserByUsername, setUserKey, deleteUserKey, type ProviderKeyName } from './db.js';
import { bagHasAnyKey, type CredentialBag } from '../config.js';
import { createBlackboard } from '../core/blackboard.js';
import { runTMAP } from '../core/orchestrator.js';
import { currentMode } from '../config.js';
import type { Mode } from '../types.js';

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
  const user = username ? await findUserByUsername(String(username)) : undefined;
  if (!user || !verifyPassword(String(pin ?? '').trim(), user.pinHash)) {
    return res.status(401).json({ error: 'ชื่อหรือ PIN ไม่ถูกต้อง' });
  }
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

// ── RUN TMAP (SSE stream) ─────────────────────────────────────────────────────
app.post('/v1/run', requireAuth, async (req: AuthedRequest, res) => {
  const task = String(req.body?.task ?? '').trim();
  const mode = (['lite', 'normal', 'pro'].includes(req.body?.mode) ? req.body.mode : currentMode()) as Mode;
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

  const bb = createBlackboard(task, mode);
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
