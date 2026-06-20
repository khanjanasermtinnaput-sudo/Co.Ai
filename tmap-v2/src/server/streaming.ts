// Streaming architecture — backpressure-aware SSE connection registry,
// fan-out broadcasting, heartbeat keepalives, and graceful shutdown.

import type { Response } from 'express';
import { logger } from './logger.js';

export interface SSEConnection {
  id: string;
  res: Response;
  userId?: string;
  channel?: string;
  connectedAt: string;
  lastHeartbeatAt: string;
}

const _conns = new Map<string, SSEConnection>();
const HEARTBEAT_MS = 25_000;
const MAX_CONNS = Number(process.env.MAX_SSE_CONNECTIONS ?? 1_000);

let _hbTimer: ReturnType<typeof setInterval> | null = null;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerSSE(
  res: Response,
  opts: { id: string; userId?: string; channel?: string },
): SSEConnection {
  if (_conns.size >= MAX_CONNS) {
    logger.warn('sse_max_connections', { current: _conns.size, max: MAX_CONNS });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const conn: SSEConnection = {
    id: opts.id,
    res,
    userId: opts.userId,
    channel: opts.channel,
    connectedAt:      new Date().toISOString(),
    lastHeartbeatAt:  new Date().toISOString(),
  };
  _conns.set(opts.id, conn);
  res.on('close', () => { _conns.delete(opts.id); });
  logger.debug('sse_connected', { id: opts.id, total: _conns.size });
  return conn;
}

export function unregisterSSE(id: string): void { _conns.delete(id); }

// ── SSE write helpers ─────────────────────────────────────────────────────────

export function sseWrite(res: Response, event: string, data: unknown): boolean {
  if (res.writableEnded) return false;
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
    return true;
  } catch { return false; }
}

export function sseDone(res: Response): void {
  if (!res.writableEnded) { res.write('event: done\ndata: {}\n\n'); res.end(); }
}

export function sseError(res: Response, message: string, code?: string): void {
  if (!res.writableEnded) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: message, code })}\n\n`);
    res.end();
  }
}

// ── Fan-out ───────────────────────────────────────────────────────────────────

export function broadcastToChannel(channel: string, event: string, data: unknown): number {
  let sent = 0;
  for (const conn of _conns.values()) {
    if (conn.channel === channel && sseWrite(conn.res, event, data)) sent++;
  }
  return sent;
}

export function broadcastToUser(userId: string, event: string, data: unknown): number {
  let sent = 0;
  for (const conn of _conns.values()) {
    if (conn.userId === userId && sseWrite(conn.res, event, data)) sent++;
  }
  return sent;
}

export function broadcastAll(event: string, data: unknown): number {
  let sent = 0;
  for (const conn of _conns.values()) {
    if (sseWrite(conn.res, event, data)) sent++;
  }
  return sent;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

export function startHeartbeat(): void {
  if (_hbTimer) return;
  _hbTimer = setInterval(() => {
    const now   = new Date().toISOString();
    const stale: string[] = [];
    for (const [id, conn] of _conns.entries()) {
      if (conn.res.writableEnded) { stale.push(id); continue; }
      try { conn.res.write(': heartbeat\n\n'); conn.lastHeartbeatAt = now; }
      catch { stale.push(id); }
    }
    for (const id of stale) _conns.delete(id);
  }, HEARTBEAT_MS);
  _hbTimer.unref?.();
}

export function stopHeartbeat(): void {
  if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
}

export function getConnectionStats(): {
  total: number;
  byChannel: Record<string, number>;
  byUser: Record<string, number>;
} {
  const byChannel: Record<string, number> = {};
  const byUser:    Record<string, number> = {};
  for (const conn of _conns.values()) {
    if (conn.channel) byChannel[conn.channel] = (byChannel[conn.channel] ?? 0) + 1;
    if (conn.userId)  byUser[conn.userId]      = (byUser[conn.userId]      ?? 0) + 1;
  }
  return { total: _conns.size, byChannel, byUser };
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export function shutdownSSE(): void {
  stopHeartbeat();
  for (const conn of _conns.values()) sseError(conn.res, 'Server shutting down', 'SHUTDOWN');
  _conns.clear();
}
