import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hashPassword, verifyPassword, encryptSecret, decryptSecret, maskKey } from './crypto.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import {
  createUser, findUserByEmail, type ProviderKeyName,
  setUserKey, deleteUserKey,
} from './db.js';
import { resolveAllWith, bagHasAnyKey, type CredentialBag } from '../config.js';
import { createBlackboard } from '../core/blackboard.js';
import { runTMAP } from '../core/orchestrator.js';
import { currentMode } from '../config.js';
import type { Mode } from '../types.js';

const PROVIDERS: ProviderKeyName[] = ['openrouter', 'gemini', 'deepseek', 'qwen', 'llama'];

const app = express();
app.use(cors());
app.use(express.json());

// ── AUTH ────────────────────────────────────────────────────────────────────
app.post('/v1/auth/register', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'email and password (>=6 chars) required' });
  }
  if (findUserByEmail(email)) return res.status(409).json({ error: 'email already registered' });
  const user = createUser(email, hashPassword(password));
  return res.json({ token: signToken(user.id), email: user.email });
});

app.post('/v1/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const user = email ? findUserByEmail(email) : undefined;
  if (!user || !verifyPassword(password ?? '', user.passwordHash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  return res.json({ token: signToken(user.id), email: user.email });
});

// ── ACCOUNT + KEYS (key ผูกกับ account, เข้ารหัสใน DB) ─────────────────────────
app.get('/v1/me', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => [p, u.encryptedKeys[p] ? maskKey(decryptSecret(u.encryptedKeys[p]!)) : null]),
  );
  res.json({ email: u.email, keys });
});

app.put('/v1/me/keys', requireAuth, (req: AuthedRequest, res) => {
  const { provider, key } = req.body ?? {};
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: `provider must be one of ${PROVIDERS.join(', ')}` });
  if (!key || String(key).trim().length < 8) return res.status(400).json({ error: 'key looks invalid' });
  setUserKey(req.user!.id, provider, encryptSecret(String(key).trim()));
  res.json({ ok: true, provider, masked: maskKey(String(key).trim()) });
});

app.delete('/v1/me/keys/:provider', requireAuth, (req: AuthedRequest, res) => {
  const provider = req.params.provider as ProviderKeyName;
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'unknown provider' });
  deleteUserKey(req.user!.id, provider);
  res.json({ ok: true });
});

// ── RUN TMAP using THIS user's stored keys (SSE stream) ───────────────────────
app.post('/v1/run', requireAuth, async (req: AuthedRequest, res) => {
  const task = String(req.body?.task ?? '').trim();
  const mode = (['lite', 'normal', 'pro'].includes(req.body?.mode) ? req.body.mode : currentMode()) as Mode;
  if (!task) return res.status(400).json({ error: 'task required' });

  // build the per-user credential bag by decrypting stored keys
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
    send({ role: 'system', kind: 'status', text: 'no API key on this account — running in mock mode. Add a key in Settings.' });
  }

  const bb = createBlackboard(task, mode);
  const agents = resolveAllWith(creds);

  try {
    await runTMAP(bb, (role, text, kind = 'status') => send({ role, text, kind }), agents);
    send({ role: 'system', kind: 'done', text: 'done', files: bb.files, iterations: bb.iterations });
  } catch (e) {
    send({ role: 'system', kind: 'error', text: (e as Error).message });
  }
  res.end();
});

// ── static web client ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, 'public')));

export default app;

// standalone server (local dev / Render / Docker) — skip when imported by Vercel
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 8787);
  app.listen(PORT, () => {
    console.log(`AOF Code server → http://localhost:${PORT}`);
    console.log(`  POST /v1/auth/register | /v1/auth/login`);
    console.log(`  PUT  /v1/me/keys  (provider,key)   ·   POST /v1/run  (task)`);
  });
}
